use std::{net::SocketAddr, sync::Arc, time::Duration};

use axum::{
    Json, Router,
    body::Body,
    extract::State,
    http::{HeaderValue, Response, StatusCode, header},
    routing::post,
};
use futures_util::StreamExt;
use onpeople_types::{AppError, ErrorCode, ProviderKind};
use parking_lot::RwLock;
use serde_json::{Value, json};
use tokio::{net::TcpListener, sync::oneshot, task::JoinHandle};
use url::Url;

#[derive(Debug, Clone)]
pub struct ProviderRuntime {
    pub kind: ProviderKind,
    pub base_url: Url,
    pub model: String,
    pub protocol: String,
    pub api_key: String,
}

#[derive(Clone)]
pub struct ModelGateway {
    client: reqwest::Client,
    provider: Arc<RwLock<ProviderRuntime>>,
}

pub struct GatewayHandle {
    pub address: SocketAddr,
    shutdown: Option<oneshot::Sender<()>>,
    task: JoinHandle<Result<(), std::io::Error>>,
}

impl GatewayHandle {
    pub async fn shutdown(mut self) -> Result<(), AppError> {
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(());
        }
        self.task
            .await
            .map_err(AppError::internal)?
            .map_err(AppError::storage)
    }
}

impl ModelGateway {
    pub fn new(provider: ProviderRuntime) -> Result<Self, AppError> {
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(300))
            .build()
            .map_err(AppError::internal)?;
        Ok(Self {
            client,
            provider: Arc::new(RwLock::new(provider)),
        })
    }

    pub fn update_provider(&self, provider: ProviderRuntime) {
        *self.provider.write() = provider;
    }

    pub async fn start(self, address: SocketAddr) -> Result<GatewayHandle, AppError> {
        let listener = TcpListener::bind(address)
            .await
            .map_err(AppError::storage)?;
        let address = listener.local_addr().map_err(AppError::storage)?;
        let router = Router::new()
            .route("/v1/responses", post(proxy_responses))
            .route("/v1/chat/completions", post(proxy_chat))
            .with_state(self);
        let (shutdown_tx, shutdown_rx) = oneshot::channel();
        let task = tokio::spawn(async move {
            axum::serve(listener, router)
                .with_graceful_shutdown(async {
                    let _ = shutdown_rx.await;
                })
                .await
        });
        Ok(GatewayHandle {
            address,
            shutdown: Some(shutdown_tx),
            task,
        })
    }
}

async fn proxy_responses(
    State(gateway): State<ModelGateway>,
    Json(body): Json<Value>,
) -> Result<Response<Body>, GatewayHttpError> {
    proxy(gateway, "responses", body).await
}

async fn proxy_chat(
    State(gateway): State<ModelGateway>,
    Json(body): Json<Value>,
) -> Result<Response<Body>, GatewayHttpError> {
    proxy(gateway, "chat/completions", body).await
}

async fn proxy(
    gateway: ModelGateway,
    endpoint: &str,
    mut body: Value,
) -> Result<Response<Body>, GatewayHttpError> {
    let provider = gateway.provider.read().clone();
    if body
        .get("model")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .is_empty()
    {
        body["model"] = Value::String(provider.model.clone());
    }
    let url = provider
        .base_url
        .join(endpoint)
        .map_err(|error| GatewayHttpError::from(AppError::internal(error)))?;
    let mut request = gateway.client.post(url).json(&body);
    if !provider.api_key.is_empty() {
        request = request.bearer_auth(&provider.api_key);
    }
    let upstream = request.send().await.map_err(|error| {
        GatewayHttpError::from(
            AppError::new(ErrorCode::Network, "模型服务连接失败")
                .retryable(true)
                .context("cause", error),
        )
    })?;
    let status = upstream.status();
    let content_type = upstream
        .headers()
        .get(header::CONTENT_TYPE)
        .cloned()
        .unwrap_or_else(|| HeaderValue::from_static("application/json"));
    let stream = upstream
        .bytes_stream()
        .map(|chunk| chunk.map_err(std::io::Error::other));
    let mut response = Response::new(Body::from_stream(stream));
    *response.status_mut() = status;
    response
        .headers_mut()
        .insert(header::CONTENT_TYPE, content_type);
    response
        .headers_mut()
        .insert("cache-control", HeaderValue::from_static("no-store"));
    Ok(response)
}

struct GatewayHttpError(AppError);

impl From<AppError> for GatewayHttpError {
    fn from(value: AppError) -> Self {
        Self(value)
    }
}

impl axum::response::IntoResponse for GatewayHttpError {
    fn into_response(self) -> axum::response::Response {
        (
            StatusCode::BAD_GATEWAY,
            Json(json!({
                "error": {
                    "code": self.0.code,
                    "message": self.0.message,
                    "retryable": self.0.retryable,
                }
            })),
        )
            .into_response()
    }
}
