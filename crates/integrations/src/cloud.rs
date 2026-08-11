use std::time::Duration;

use onpeople_types::{AppError, CloudAccountState, ErrorCode, ModelDescriptor, ProviderKind};
use reqwest::{Method, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use url::Url;
use uuid::Uuid;

const DEFAULT_SERVICE_URL: &str = "https://api.aibro.vip";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudCredentials {
    pub access_token: String,
    pub refresh_token: String,
    pub api_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudSession {
    pub account: Value,
    pub group: Option<Value>,
    pub models: Vec<ModelDescriptor>,
    pub credentials: CloudCredentials,
}

#[derive(Clone)]
pub struct CloudClient {
    client: reqwest::Client,
    service_url: Url,
}

impl CloudClient {
    pub fn new(service_url: Option<&str>) -> Result<Self, AppError> {
        let service_url = normalize_service_url(service_url.unwrap_or(DEFAULT_SERVICE_URL))?;
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .user_agent(format!("OnPeople/{}", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(AppError::internal)?;
        Ok(Self {
            client,
            service_url,
        })
    }

    #[must_use]
    pub fn service_url(&self) -> &Url {
        &self.service_url
    }

    pub async fn login(&self, email: &str, password: &str) -> Result<CloudSession, AppError> {
        let response = self
            .request(
                Method::POST,
                "/api/v1/auth/login",
                Some(json!({ "email": email, "password": password })),
                None,
            )
            .await?;
        self.session_from_auth(response).await
    }

    pub async fn send_registration_code(&self, email: &str) -> Result<Value, AppError> {
        self.request(
            Method::POST,
            "/api/v1/auth/verification-code",
            Some(json!({ "email": email })),
            None,
        )
        .await
    }

    pub async fn register(
        &self,
        email: &str,
        password: &str,
        code: &str,
    ) -> Result<CloudSession, AppError> {
        let response = self
            .request(
                Method::POST,
                "/api/v1/auth/register",
                Some(json!({ "email": email, "password": password, "code": code })),
                None,
            )
            .await?;
        self.session_from_auth(response).await
    }

    pub async fn refresh(&self, refresh_token: &str) -> Result<CloudCredentials, AppError> {
        let response = self
            .request(
                Method::POST,
                "/api/v1/auth/refresh",
                Some(json!({ "refreshToken": refresh_token })),
                None,
            )
            .await?;
        Ok(credentials_from(&response))
    }

    pub async fn account_state(
        &self,
        access_token: Option<&str>,
    ) -> Result<CloudAccountState, AppError> {
        let Some(token) = access_token.filter(|token| !token.is_empty()) else {
            return Ok(CloudAccountState {
                signed_in: false,
                service_url: self
                    .service_url
                    .to_string()
                    .trim_end_matches('/')
                    .to_owned(),
                account: None,
                group: None,
                models: Vec::new(),
            });
        };
        let account = self
            .request(Method::GET, "/api/v1/user/profile", None, Some(token))
            .await?;
        let models = match self.ensure_desktop_api_key(token).await {
            Ok((api_key, _)) => self.discover_models(&api_key).await.unwrap_or_default(),
            Err(_) => Vec::new(),
        };
        Ok(CloudAccountState {
            signed_in: true,
            service_url: self
                .service_url
                .to_string()
                .trim_end_matches('/')
                .to_owned(),
            account: Some(account),
            group: None,
            models,
        })
    }

    pub async fn groups(&self, token: &str) -> Result<Vec<Value>, AppError> {
        let value = self
            .request(Method::GET, "/api/v1/groups", None, Some(token))
            .await?;
        Ok(value
            .get("data")
            .or_else(|| value.get("groups"))
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default())
    }

    pub async fn ensure_desktop_api_key(
        &self,
        access_token: &str,
    ) -> Result<(String, Option<Value>), AppError> {
        if access_token.trim().is_empty() {
            return Err(AppError::new(
                ErrorCode::Authentication,
                "请先登录 OnPeople 账号",
            ));
        }
        let mut groups = self
            .request(
                Method::GET,
                "/api/v1/groups/available",
                None,
                Some(access_token),
            )
            .await?
            .as_array()
            .cloned()
            .unwrap_or_default();
        groups.retain(|group| {
            group
                .get("status")
                .and_then(Value::as_str)
                .is_none_or(|status| status == "active")
        });
        groups.sort_by_key(group_priority);
        let group = groups.into_iter().next().ok_or_else(|| {
            AppError::new(
                ErrorCode::Authentication,
                "OnPeople 账号当前没有可用模型分组",
            )
        })?;
        let group_id = group
            .get("id")
            .and_then(Value::as_i64)
            .or_else(|| group.get("id").and_then(Value::as_u64).map(|id| id as i64))
            .ok_or_else(|| AppError::internal("OnPeople 模型分组缺少 ID"))?;
        let keys = self
            .request(
                Method::GET,
                "/api/v1/keys?page=1&page_size=100",
                None,
                Some(access_token),
            )
            .await?;
        let keys = keys
            .get("items")
            .or_else(|| keys.get("data").and_then(|data| data.get("items")))
            .or_else(|| keys.get("keys"))
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let active_key = keys.into_iter().find(|key| {
            key.get("status").and_then(Value::as_str) == Some("active")
                && key
                    .get("group_id")
                    .or_else(|| key.get("groupId"))
                    .and_then(Value::as_i64)
                    == Some(group_id)
                && key
                    .get("key")
                    .and_then(Value::as_str)
                    .is_some_and(|value| !value.trim().is_empty())
        });
        let selected = if let Some(active_key) = active_key {
            active_key
        } else {
            self.request_with_headers(
                Method::POST,
                "/api/v1/keys",
                Some(json!({
                    "name": "OnPeople Desktop",
                    "group_id": group_id,
                })),
                Some(access_token),
                Some(("idempotency-key", Uuid::new_v4().to_string())),
            )
            .await?
        };
        let api_key = selected
            .get("key")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                AppError::new(ErrorCode::Authentication, "OnPeople 未返回可用模型 API Key")
            })?
            .to_owned();
        Ok((api_key, Some(group)))
    }

    pub async fn redeem(&self, token: &str, code: &str) -> Result<Value, AppError> {
        self.request(
            Method::POST,
            "/api/v1/redemption",
            Some(json!({ "code": code })),
            Some(token),
        )
        .await
    }

    pub async fn usage(&self, token: &str, query: &Value) -> Result<Value, AppError> {
        self.request(
            Method::POST,
            "/api/v1/usage/profile",
            Some(query.clone()),
            Some(token),
        )
        .await
    }

    pub async fn discover_models(&self, token: &str) -> Result<Vec<ModelDescriptor>, AppError> {
        let value = self
            .request(Method::GET, "/v1/models", None, Some(token))
            .await?;
        let models = value
            .as_array()
            .or_else(|| value.get("data").and_then(Value::as_array))
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|model| {
                let id = model.get("id")?.as_str()?.to_owned();
                Some(ModelDescriptor {
                    name: model
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or(&id)
                        .to_owned(),
                    vision: model
                        .get("vision")
                        .and_then(Value::as_bool)
                        .unwrap_or_else(|| id.contains("vision") || id.starts_with("gpt-")),
                    reasoning_efforts: vec![
                        "low".to_owned(),
                        "medium".to_owned(),
                        "high".to_owned(),
                    ],
                    id,
                    provider: ProviderKind::Onpeople,
                })
            })
            .collect();
        Ok(models)
    }

    pub async fn generate_thread_title(
        &self,
        api_key: &str,
        model: &str,
        prompt: &str,
    ) -> Result<String, AppError> {
        if api_key.trim().is_empty() {
            return Err(AppError::new(
                ErrorCode::Authentication,
                "请先登录 OnPeople 账号",
            ));
        }
        let prompt = prompt.trim();
        if prompt.is_empty() {
            return Err(AppError::invalid("任务内容不能为空"));
        }
        let url = self
            .service_url
            .join("v1/chat/completions")
            .map_err(AppError::internal)?;
        let response = self
            .client
            .post(url)
            .bearer_auth(api_key)
            .json(&json!({
                "model": model,
                "messages": [
                    {
                        "role": "system",
                        "content": "你负责给任务生成标题。只输出一个简短标题，不要引号、编号、解释或标点结尾；使用用户输入的语言；标题不超过 24 个字。"
                    },
                    {
                        "role": "user",
                        "content": prompt.chars().take(2_000).collect::<String>()
                    }
                ],
                "temperature": 0.2,
                "max_tokens": 32,
                "stream": false
            }))
            .send()
            .await
            .map_err(|error| {
                AppError::new(ErrorCode::Network, "任务标题生成失败")
                    .retryable(error.is_timeout() || error.is_connect())
                    .context("cause", error)
            })?;
        let status = response.status();
        let value: Value = response.json().await.unwrap_or(Value::Null);
        if !status.is_success() {
            let message = value
                .get("error")
                .and_then(|error| error.get("message"))
                .and_then(Value::as_str)
                .or_else(|| value.get("message").and_then(Value::as_str))
                .unwrap_or("任务标题生成失败");
            return Err(AppError::new(
                if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
                    ErrorCode::Authentication
                } else if status == StatusCode::TOO_MANY_REQUESTS {
                    ErrorCode::RateLimited
                } else {
                    ErrorCode::Network
                },
                message,
            )
            .retryable(status == StatusCode::TOO_MANY_REQUESTS || status.is_server_error()));
        }
        let raw = value
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|choices| choices.first())
            .and_then(|choice| choice.get("message"))
            .and_then(|message| message.get("content"))
            .and_then(content_text)
            .or_else(|| {
                value
                    .get("data")
                    .and_then(|data| data.get("choices"))
                    .and_then(Value::as_array)
                    .and_then(|choices| choices.first())
                    .and_then(|choice| choice.get("message"))
                    .and_then(|message| message.get("content"))
                    .and_then(content_text)
            })
            .ok_or_else(|| AppError::new(ErrorCode::Network, "模型没有返回任务标题"))?;
        normalize_thread_title(&raw)
            .ok_or_else(|| AppError::new(ErrorCode::Network, "模型返回的任务标题为空"))
    }

    async fn session_from_auth(&self, response: Value) -> Result<CloudSession, AppError> {
        let mut credentials = credentials_from(&response);
        if credentials.access_token.is_empty() {
            return Err(AppError::new(
                ErrorCode::Authentication,
                "OnPeople 登录响应没有访问令牌",
            ));
        }
        let account = response
            .get("account")
            .or_else(|| response.get("user"))
            .cloned()
            .unwrap_or(Value::Null);
        let (api_key, group) = self
            .ensure_desktop_api_key(&credentials.access_token)
            .await?;
        credentials.api_key = api_key.clone();
        let models = self.discover_models(&api_key).await?;
        Ok(CloudSession {
            account,
            group: group.or_else(|| response.get("group").cloned()),
            models,
            credentials,
        })
    }

    async fn request(
        &self,
        method: Method,
        path: &str,
        body: Option<Value>,
        token: Option<&str>,
    ) -> Result<Value, AppError> {
        self.request_with_headers(method, path, body, token, None)
            .await
    }

    async fn request_with_headers(
        &self,
        method: Method,
        path: &str,
        body: Option<Value>,
        token: Option<&str>,
        extra_header: Option<(&str, String)>,
    ) -> Result<Value, AppError> {
        let url = self
            .service_url
            .join(path.trim_start_matches('/'))
            .map_err(AppError::internal)?;
        let mut request = self.client.request(method, url);
        if let Some(body) = body {
            request = request.json(&body);
        }
        if let Some(token) = token {
            request = request.bearer_auth(token);
        }
        if let Some((name, value)) = extra_header {
            request = request.header(name, value);
        }
        let response = request.send().await.map_err(|error| {
            AppError::new(ErrorCode::Network, "无法连接 OnPeople 服务")
                .retryable(error.is_timeout() || error.is_connect())
                .context("cause", error)
        })?;
        let status = response.status();
        let value: Value = response.json().await.unwrap_or(Value::Null);
        if status.is_success() {
            return Ok(value.get("data").cloned().unwrap_or(value));
        }
        let message = value
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("OnPeople 服务请求失败");
        let code = match status {
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => ErrorCode::Authentication,
            StatusCode::TOO_MANY_REQUESTS => ErrorCode::RateLimited,
            _ if status.is_server_error() => ErrorCode::Network,
            _ => ErrorCode::InvalidRequest,
        };
        Err(AppError::new(code, message)
            .retryable(status == StatusCode::TOO_MANY_REQUESTS || status.is_server_error()))
    }
}

fn credentials_from(value: &Value) -> CloudCredentials {
    let source = value.get("tokens").unwrap_or(value);
    CloudCredentials {
        access_token: source
            .get("accessToken")
            .or_else(|| source.get("access_token"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned(),
        refresh_token: source
            .get("refreshToken")
            .or_else(|| source.get("refresh_token"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned(),
        api_key: source
            .get("apiKey")
            .or_else(|| source.get("api_key"))
            .or_else(|| source.get("key"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned(),
    }
}

fn content_text(value: &Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        return Some(text.to_owned());
    }
    value.as_array().map(|parts| {
        parts
            .iter()
            .filter_map(|part| {
                part.get("text")
                    .and_then(Value::as_str)
                    .or_else(|| part.as_str())
            })
            .collect::<Vec<_>>()
            .join("")
    })
}

fn normalize_thread_title(value: &str) -> Option<String> {
    let mut title = value
        .trim()
        .trim_matches(|character| matches!(character, '`' | '"' | '\''))
        .trim()
        .strip_prefix("标题:")
        .or_else(|| value.trim().strip_prefix("标题："))
        .unwrap_or(value.trim())
        .trim()
        .to_owned();
    title = title
        .lines()
        .next()
        .unwrap_or_default()
        .trim()
        .trim_matches(|character| matches!(character, '`' | '"' | '\''))
        .trim_end_matches(['。', '！', '？', '.', '!', '?'])
        .trim()
        .to_owned();
    if title.is_empty() || title == "新任务" || title == "未命名任务" {
        return None;
    }
    Some(title.chars().take(24).collect())
}

fn group_priority(group: &Value) -> u8 {
    match group
        .get("platform")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "composite" => 0,
        "openai" => 1,
        "grok" => 2,
        _ => 3,
    }
}

fn normalize_service_url(value: &str) -> Result<Url, AppError> {
    let mut url = Url::parse(value)
        .map_err(|_| AppError::new(ErrorCode::InvalidRequest, "OnPeople 服务地址无效"))?;
    if !matches!(url.scheme(), "https" | "http") || url.host_str().is_none() {
        return Err(AppError::new(
            ErrorCode::InvalidRequest,
            "OnPeople 服务地址必须使用 HTTP 或 HTTPS",
        ));
    }
    url.set_path("/");
    url.set_query(None);
    url.set_fragment(None);
    Ok(url)
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use axum::{
        Router,
        extract::State,
        http::{HeaderMap, Method, Uri},
        response::Json,
        routing::any,
    };
    use serde_json::{Value, json};
    use tokio::sync::oneshot;

    use super::{CloudClient, normalize_service_url};

    #[test]
    fn normalizes_service_url() {
        assert_eq!(
            normalize_service_url("https://api.aibro.vip/api/v1")
                .expect("url")
                .as_str(),
            "https://api.aibro.vip/"
        );
    }

    #[tokio::test]
    async fn login_creates_a_desktop_key_before_loading_models() {
        let seen = Arc::new(Mutex::new(Vec::<String>::new()));
        let app = Router::new()
            .fallback(any(mock_cloud_request))
            .with_state(Arc::clone(&seen));
        let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .expect("listener");
        let address = listener.local_addr().expect("address");
        let (shutdown_tx, shutdown_rx) = oneshot::channel();
        let server = tokio::spawn(async move {
            axum::serve(listener, app)
                .with_graceful_shutdown(async move {
                    let _ = shutdown_rx.await;
                })
                .await
                .expect("server");
        });

        let service_url = format!("http://127.0.0.1:{}", address.port());
        let client = CloudClient::new(Some(&service_url)).expect("client");
        let session = client
            .login("user@example.com", "password")
            .await
            .expect("login");
        assert_eq!(session.credentials.access_token, "access-token");
        assert_eq!(session.credentials.api_key, "generated-model-key");
        assert_eq!(session.models[0].id, "gpt-5.6-sol");
        assert_eq!(
            session.group.as_ref().and_then(|group| group.get("id")),
            Some(&json!(7))
        );

        let calls = seen.lock().expect("calls").clone();
        assert!(calls.iter().any(|call| call.contains("POST /api/v1/keys")));
        assert!(calls.iter().any(|call| {
            call.contains("GET /v1/models") && call.contains("Bearer generated-model-key")
        }));
        let _ = shutdown_tx.send(());
        server.await.expect("shutdown");
    }

    async fn mock_cloud_request(
        State(seen): State<Arc<Mutex<Vec<String>>>>,
        method: Method,
        uri: Uri,
        headers: HeaderMap,
    ) -> Json<Value> {
        let authorization = headers
            .get("authorization")
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default();
        seen.lock()
            .expect("calls")
            .push(format!("{method} {} {authorization}", uri.path()));
        let value = match (method, uri.path()) {
            (Method::POST, "/api/v1/auth/login") => {
                json!({"access_token":"access-token","refresh_token":"refresh-token"})
            }
            (Method::GET, "/api/v1/groups/available") => {
                json!([{"id":7,"name":"OpenAI","platform":"openai","status":"active"}])
            }
            (Method::GET, "/api/v1/keys") => json!({"items": []}),
            (Method::POST, "/api/v1/keys") => {
                json!({"id":11,"key":"generated-model-key","group_id":7,"status":"active"})
            }
            (Method::GET, "/v1/models") => {
                json!({"data":[{"id":"gpt-5.6-sol","name":"GPT-5.6 SOL"}]})
            }
            _ => Value::Null,
        };
        Json(value)
    }
}
