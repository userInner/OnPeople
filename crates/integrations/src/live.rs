use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use onpeople_types::{AppError, ErrorCode};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::sync::{broadcast, mpsc};
use tokio_tungstenite::{connect_async, tungstenite::Message};
use url::Url;

const MAX_SDP_BYTES: usize = 2 * 1024 * 1024;
const MAX_INITIAL_ITEMS: usize = 16;
const MAX_INITIAL_TEXT: usize = 8_000;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveSessionResult {
    pub sdp: String,
    pub call_id: Option<String>,
    pub sideband_available: bool,
    pub sideband_url: Option<String>,
}

pub async fn create_session(
    base_url: &str,
    api_key: &str,
    sdp: &str,
    voice: &str,
    instructions: &str,
    initial_items: &Value,
) -> Result<LiveSessionResult, AppError> {
    let base_url = base_url.trim_end_matches('/');
    let url = Url::parse(&format!("{base_url}/live")).map_err(AppError::internal)?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err(AppError::invalid("GPT-Live 服务地址无效"));
    }
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return Err(AppError::new(
            ErrorCode::Authentication,
            "请先登录 OnPeople 账号",
        ));
    }
    if sdp.trim().is_empty() {
        return Err(AppError::invalid("GPT-Live SDP Offer 不能为空"));
    }
    if sdp.len() > MAX_SDP_BYTES {
        return Err(AppError::invalid("GPT-Live SDP Offer 超过大小限制"));
    }
    let initial_items = normalize_initial_items(initial_items);
    let session = json!({
        "instructions": instructions.replace('\0', "").chars().take(16_000).collect::<String>(),
        "audio": { "output": { "voice": normalize_voice(voice) } },
        "delegation": { "type": "client" },
        "initial_items": initial_items,
    });
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .user_agent(format!("OnPeople/{}", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(AppError::internal)?;
    let response = client
        .post(url)
        .bearer_auth(api_key)
        .header("accept", "application/sdp")
        .json(&json!({ "sdp": sdp, "session": session }))
        .send()
        .await
        .map_err(|error| {
            AppError::new(ErrorCode::Network, "GPT-Live 网络连接失败")
                .retryable(error.is_timeout() || error.is_connect())
                .context("cause", error)
        })?;
    let status = response.status();
    let location = response
        .headers()
        .get("location")
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let answer = response.text().await.map_err(AppError::network)?;
    if !status.is_success() {
        let message = serde_json::from_str::<Value>(&answer)
            .ok()
            .and_then(|value| {
                value
                    .get("error")
                    .and_then(|error| error.get("message"))
                    .or_else(|| value.get("message"))
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
            })
            .unwrap_or_else(|| format!("GPT-Live 建连失败（HTTP {status}") + ")");
        let code = match status.as_u16() {
            401 | 403 => ErrorCode::Authentication,
            429 => ErrorCode::RateLimited,
            500..=599 => ErrorCode::Network,
            _ => ErrorCode::InvalidRequest,
        };
        return Err(
            AppError::new(code, message).retryable(status == 429 || status.is_server_error())
        );
    }
    if !answer.trim_start().starts_with("v=0") {
        return Err(AppError::new(
            ErrorCode::RuntimeProtocol,
            "GPT-Live 返回了无效的 SDP Answer",
        ));
    }
    let call_id = location
        .as_deref()
        .and_then(|value| value.split('/').rfind(|part| !part.is_empty()))
        .map(ToOwned::to_owned);
    let sideband_url = location
        .as_deref()
        .and_then(|value| resolve_sideband_url(base_url, value).ok());
    Ok(LiveSessionResult {
        sdp: answer,
        call_id,
        sideband_available: sideband_url.is_some(),
        sideband_url,
    })
}

pub async fn close_session(base_url: &str, api_key: &str, call_id: &str) -> Result<bool, AppError> {
    let id = call_id.trim();
    if id.is_empty() {
        return Ok(false);
    }
    let url = Url::parse(&format!(
        "{}/live/{}",
        base_url.trim_end_matches('/'),
        urlencoding(id)
    ))
    .map_err(AppError::internal)?;
    let response = reqwest::Client::new()
        .delete(url)
        .bearer_auth(api_key.trim())
        .send()
        .await
        .map_err(|error| {
            AppError::new(ErrorCode::Network, "GPT-Live 结束请求失败")
                .retryable(true)
                .context("cause", error)
        })?;
    if response.status().is_success() || response.status().as_u16() == 404 {
        Ok(true)
    } else {
        Err(
            AppError::new(ErrorCode::Network, "GPT-Live 结束请求被服务拒绝")
                .retryable(response.status().is_server_error()),
        )
    }
}

fn normalize_voice(value: &str) -> &'static str {
    match value.trim().to_ascii_lowercase().as_str() {
        "alloy" => "alloy",
        "verse" => "verse",
        _ => "cove",
    }
}

fn normalize_initial_items(value: &Value) -> Vec<Value> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .take(MAX_INITIAL_ITEMS)
        .filter_map(|item| {
            let role = match item.get("role").and_then(Value::as_str) {
                Some("developer") => "developer",
                Some("assistant") => "assistant",
                _ => "user",
            };
            let text = item
                .get("text")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .replace('\0', "")
                .trim()
                .chars()
                .take(MAX_INITIAL_TEXT)
                .collect::<String>();
            (!text.is_empty()).then_some(json!({
                "type": "message",
                "role": role,
                "content": [{ "type": if role == "assistant" { "output_text" } else { "input_text" }, "text": text }]
            }))
        })
        .collect()
}

fn resolve_sideband_url(base_url: &str, location: &str) -> Result<String, AppError> {
    let base =
        Url::parse(&format!("{}/", base_url.trim_end_matches('/'))).map_err(AppError::internal)?;
    let mut target = base.join(location).map_err(AppError::internal)?;
    match target.scheme() {
        "http" => {
            let _ = target.set_scheme("ws");
        }
        "https" => {
            let _ = target.set_scheme("wss");
        }
        "ws" | "wss" => {}
        _ => return Err(AppError::invalid("GPT-Live Sideband 协议无效")),
    }
    Ok(target.to_string())
}

fn urlencoding(value: &str) -> String {
    value
        .bytes()
        .flat_map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                vec![byte as char]
            }
            byte => format!("%{byte:02X}").chars().collect(),
        })
        .collect()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveEvent {
    pub event_type: String,
    pub payload: Value,
}

#[derive(Debug, Clone)]
pub struct LiveConnection {
    outgoing: mpsc::Sender<Value>,
    events: broadcast::Sender<LiveEvent>,
}

impl LiveConnection {
    pub async fn connect(url: Url, token: &str) -> Result<Self, AppError> {
        if !matches!(url.scheme(), "wss" | "ws") {
            return Err(AppError::invalid("Live 地址必须使用 ws 或 wss"));
        }
        let mut request = url
            .as_str()
            .into_client_request()
            .map_err(AppError::internal)?;
        request.headers_mut().insert(
            "authorization",
            format!("Bearer {token}")
                .parse()
                .map_err(AppError::internal)?,
        );
        let (socket, _) = connect_async(request).await.map_err(|error| {
            AppError::new(ErrorCode::Network, "无法连接 Live 服务")
                .retryable(true)
                .context("cause", error)
        })?;
        let (mut writer, mut reader) = socket.split();
        let (outgoing, mut outgoing_rx) = mpsc::channel::<Value>(64);
        let (events, _) = broadcast::channel(256);
        let event_tx = events.clone();
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    outbound = outgoing_rx.recv() => {
                        let Some(outbound) = outbound else { break; };
                        if writer.send(Message::Text(outbound.to_string().into())).await.is_err() {
                            break;
                        }
                    }
                    inbound = reader.next() => {
                        let Some(Ok(inbound)) = inbound else { break; };
                        if let Ok(text) = inbound.into_text() {
                            if let Ok(payload) = serde_json::from_str::<Value>(&text) {
                                let event_type = payload.get("type").and_then(Value::as_str).unwrap_or("message").to_owned();
                                let _ = event_tx.send(LiveEvent { event_type, payload });
                            }
                        }
                    }
                }
            }
            let _ = event_tx.send(LiveEvent {
                event_type: "closed".to_owned(),
                payload: Value::Null,
            });
        });
        Ok(Self { outgoing, events })
    }

    pub async fn send(&self, payload: Value) -> Result<(), AppError> {
        self.outgoing
            .send(payload)
            .await
            .map_err(|_| AppError::new(ErrorCode::RuntimeUnavailable, "Live 会话已关闭"))
    }

    #[must_use]
    pub fn subscribe(&self) -> broadcast::Receiver<LiveEvent> {
        self.events.subscribe()
    }
}

use tokio_tungstenite::tungstenite::client::IntoClientRequest;

#[cfg(test)]
mod tests {
    use super::normalize_voice;

    #[test]
    fn keeps_supported_live_voices_and_falls_back_safely() {
        assert_eq!(normalize_voice("alloy"), "alloy");
        assert_eq!(normalize_voice("VERSE"), "verse");
        assert_eq!(normalize_voice("unsupported"), "cove");
    }
}
