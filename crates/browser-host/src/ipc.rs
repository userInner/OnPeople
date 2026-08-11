use std::{path::PathBuf, sync::Arc, time::Duration};

use onpeople_types::{AppError, ErrorCode};
use rand::{Rng, distr::Alphanumeric};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
#[cfg(unix)]
use sha2::{Digest, Sha256};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    io::{AsyncRead, AsyncWrite},
    time::timeout,
};
use tracing::warn;

use crate::state::{BrowserCommand, BrowserHostState};

#[derive(Debug, Clone)]
pub struct IpcAddress {
    pub unix_socket: PathBuf,
    pub windows_pipe: String,
}

#[derive(Debug, Clone)]
pub struct IpcConfig {
    pub address: IpcAddress,
    pub token: String,
    pub protocol_version: u32,
}

impl IpcConfig {
    #[must_use]
    pub fn for_profile(profile: &std::path::Path) -> Self {
        let token = rand::rng()
            .sample_iter(Alphanumeric)
            .take(48)
            .map(char::from)
            .collect();
        Self::for_profile_with_token(profile, token)
    }

    #[must_use]
    pub fn for_profile_with_token(profile: &std::path::Path, token: String) -> Self {
        Self {
            address: IpcAddress {
                unix_socket: unix_socket_path(profile),
                windows_pipe: format!(r"\\.\pipe\onpeople-browser-{}", uuid::Uuid::now_v7()),
            },
            token,
            protocol_version: 1,
        }
    }

    pub fn from_environment(profile: &std::path::Path) -> Result<Self, AppError> {
        let token = std::env::var("ONPEOPLE_BROWSER_IPC_TOKEN")
            .map_err(|_| AppError::new(ErrorCode::BrowserProtocol, "浏览器 IPC token 未配置"))?;
        let protocol_version = std::env::var("ONPEOPLE_BROWSER_IPC_PROTOCOL")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(1);
        Ok(Self {
            address: IpcAddress {
                unix_socket: std::env::var_os("ONPEOPLE_BROWSER_IPC_SOCKET")
                    .map(PathBuf::from)
                    .unwrap_or_else(|| unix_socket_path(profile)),
                windows_pipe: std::env::var("ONPEOPLE_BROWSER_IPC_PIPE").unwrap_or_else(|_| {
                    format!(r"\\.\pipe\onpeople-browser-{}", uuid::Uuid::now_v7())
                }),
            },
            token,
            protocol_version,
        })
    }
}

fn unix_socket_path(profile: &std::path::Path) -> PathBuf {
    #[cfg(unix)]
    {
        // macOS sockaddr_un.sun_path only has room for 104 bytes. A normal
        // Application Support Profile already exceeds that once the socket
        // filename is appended, so use a short deterministic per-Profile path.
        let identity = profile
            .canonicalize()
            .unwrap_or_else(|_| profile.to_path_buf());
        let digest = format!(
            "{:x}",
            Sha256::digest(identity.to_string_lossy().as_bytes())
        );
        std::env::temp_dir().join(format!("onpeople-browser-ipc-{}.sock", &digest[..20]))
    }
    #[cfg(not(unix))]
    {
        profile.join("browser-host.sock")
    }
}

#[derive(Debug, Deserialize)]
struct Request {
    protocol_version: u32,
    token: String,
    id: String,
    command: BrowserCommand,
}

#[derive(Debug, Serialize, Deserialize)]
struct Response {
    protocol_version: u32,
    id: String,
    ok: bool,
    result: Value,
}

pub struct BrowserIpc {
    config: IpcConfig,
    state: Arc<BrowserHostState>,
}

#[derive(Clone)]
pub struct BrowserIpcClient {
    config: IpcConfig,
    request_timeout: Duration,
}

impl BrowserIpcClient {
    #[must_use]
    pub fn new(config: IpcConfig) -> Self {
        Self {
            config,
            request_timeout: Duration::from_secs(30),
        }
    }

    #[must_use]
    pub fn with_timeout(config: IpcConfig, request_timeout: Duration) -> Self {
        Self {
            config,
            request_timeout,
        }
    }

    #[must_use]
    pub fn config(&self) -> &IpcConfig {
        &self.config
    }

    pub async fn request(&self, command: BrowserCommand) -> Result<Value, AppError> {
        #[cfg(unix)]
        {
            let stream = timeout(
                self.request_timeout,
                tokio::net::UnixStream::connect(&self.config.address.unix_socket),
            )
            .await
            .map_err(|_| AppError::new(ErrorCode::RuntimeTimeout, "连接 CEF 浏览器宿主超时"))?
            .map_err(|error| {
                AppError::new(ErrorCode::BrowserUnavailable, "无法连接 CEF 浏览器宿主")
                    .context("cause", error)
            })?;
            request_over_stream(stream, &self.config, command, self.request_timeout).await
        }

        #[cfg(windows)]
        {
            const ERROR_PIPE_BUSY: i32 = 231;
            let stream = timeout(self.request_timeout, async {
                loop {
                    match tokio::net::windows::named_pipe::ClientOptions::new()
                        .open(&self.config.address.windows_pipe)
                    {
                        Ok(stream) => return Ok(stream),
                        Err(error) if error.raw_os_error() == Some(ERROR_PIPE_BUSY) => {
                            tokio::time::sleep(Duration::from_millis(20)).await;
                        }
                        Err(error) => return Err(error),
                    }
                }
            })
            .await
            .map_err(|_| AppError::new(ErrorCode::RuntimeTimeout, "连接 CEF 浏览器宿主超时"))?
            .map_err(|error| {
                AppError::new(ErrorCode::BrowserUnavailable, "无法连接 CEF 浏览器宿主")
                    .context("cause", error)
            })?;
            request_over_stream(stream, &self.config, command, self.request_timeout).await
        }

        #[cfg(not(any(unix, windows)))]
        {
            let _ = command;
            Err(AppError::new(
                ErrorCode::BrowserUnavailable,
                "当前平台不支持 CEF IPC",
            ))
        }
    }
}

impl BrowserIpc {
    #[must_use]
    pub fn new(config: IpcConfig, state: Arc<BrowserHostState>) -> Self {
        Self { config, state }
    }

    #[must_use]
    pub fn config(&self) -> &IpcConfig {
        &self.config
    }

    #[cfg(unix)]
    pub async fn serve(&self) -> Result<(), AppError> {
        use tokio::net::UnixListener;
        if let Some(parent) = self.config.address.unix_socket.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(AppError::storage)?;
        }
        let _ = tokio::fs::remove_file(&self.config.address.unix_socket).await;
        let listener =
            UnixListener::bind(&self.config.address.unix_socket).map_err(AppError::storage)?;
        loop {
            let (stream, _) = listener.accept().await.map_err(AppError::storage)?;
            let state = Arc::clone(&self.state);
            let config = self.config.clone();
            tokio::spawn(async move {
                if let Err(error) = handle_connection(stream, state, config).await {
                    warn!(target: "onpeople.browser-host", "IPC connection closed: {}", error.message);
                }
            });
        }
    }

    #[cfg(windows)]
    pub async fn serve(&self) -> Result<(), AppError> {
        use tokio::net::windows::named_pipe::ServerOptions;
        let mut server = ServerOptions::new()
            .first_pipe_instance(true)
            .create(&self.config.address.windows_pipe)
            .map_err(AppError::storage)?;
        loop {
            server.connect().await.map_err(AppError::storage)?;
            let connected = server;
            server = ServerOptions::new()
                .create(&self.config.address.windows_pipe)
                .map_err(AppError::storage)?;
            let state = Arc::clone(&self.state);
            let config = self.config.clone();
            tokio::spawn(async move {
                if let Err(error) = handle_connection(connected, state, config).await {
                    warn!(target: "onpeople.browser-host", "IPC connection closed: {}", error.message);
                }
            });
        }
    }
}

async fn handle_connection<S>(
    stream: S,
    state: Arc<BrowserHostState>,
    config: IpcConfig,
) -> Result<(), AppError>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let (read, mut write) = tokio::io::split(stream);
    let mut lines = BufReader::new(read).lines();
    while let Some(line) = lines.next_line().await.map_err(AppError::storage)? {
        let request: Request = serde_json::from_str(&line).map_err(|error| {
            AppError::new(ErrorCode::BrowserProtocol, "浏览器 IPC 请求无效").context("cause", error)
        })?;
        if request.protocol_version != config.protocol_version
            || !constant_time_eq(&request.token, &config.token)
        {
            return Err(AppError::new(
                ErrorCode::PermissionDenied,
                "浏览器 IPC 认证失败",
            ));
        }
        let result = tokio::task::spawn_blocking({
            let state = Arc::clone(&state);
            move || state.apply(request.command)
        })
        .await
        .map_err(AppError::internal)?;
        let response = match result {
            Ok(value) => Response {
                protocol_version: config.protocol_version,
                id: request.id,
                ok: true,
                result: value,
            },
            Err(error) => Response {
                protocol_version: config.protocol_version,
                id: request.id,
                ok: false,
                result: json!({ "code": error.code, "message": error.message, "retryable": error.retryable }),
            },
        };
        let mut bytes = serde_json::to_vec(&response).map_err(AppError::internal)?;
        bytes.push(b'\n');
        write.write_all(&bytes).await.map_err(AppError::storage)?;
        write.flush().await.map_err(AppError::storage)?;
    }
    Ok(())
}

async fn request_over_stream<S>(
    stream: S,
    config: &IpcConfig,
    command: BrowserCommand,
    request_timeout: Duration,
) -> Result<Value, AppError>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let (read, mut write) = tokio::io::split(stream);
    let request = json!({
        "protocol_version": config.protocol_version,
        "token": config.token,
        "id": uuid::Uuid::now_v7().to_string(),
        "command": command,
    });
    let mut bytes = serde_json::to_vec(&request).map_err(AppError::internal)?;
    bytes.push(b'\n');
    timeout(request_timeout, write.write_all(&bytes))
        .await
        .map_err(|_| AppError::new(ErrorCode::RuntimeTimeout, "发送 CEF 浏览器请求超时"))?
        .map_err(AppError::storage)?;
    timeout(request_timeout, write.flush())
        .await
        .map_err(|_| AppError::new(ErrorCode::RuntimeTimeout, "刷新 CEF 浏览器请求超时"))?
        .map_err(AppError::storage)?;
    let mut lines = BufReader::new(read).lines();
    let line = timeout(request_timeout, lines.next_line())
        .await
        .map_err(|_| AppError::new(ErrorCode::RuntimeTimeout, "等待 CEF 浏览器响应超时"))?
        .map_err(AppError::storage)?
        .ok_or_else(|| AppError::new(ErrorCode::BrowserUnavailable, "CEF 浏览器宿主已关闭连接"))?;
    let response: Response = serde_json::from_str(&line).map_err(|error| {
        AppError::new(ErrorCode::BrowserProtocol, "CEF 浏览器响应无效").context("cause", error)
    })?;
    if response.protocol_version != config.protocol_version {
        return Err(AppError::new(
            ErrorCode::BrowserProtocol,
            "CEF 浏览器协议版本不匹配",
        ));
    }
    if response.ok {
        return Ok(response.result);
    }
    let code = response
        .result
        .get("code")
        .and_then(Value::as_str)
        .and_then(|value| serde_json::from_value(json!(value)).ok())
        .unwrap_or(ErrorCode::BrowserProtocol);
    let message = response
        .result
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("CEF 浏览器请求失败")
        .to_owned();
    let retryable = response
        .result
        .get("retryable")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    error_response(code, message, retryable)
}

fn error_response(code: ErrorCode, message: String, retryable: bool) -> Result<Value, AppError> {
    Err(AppError {
        code,
        message,
        retryable,
        context: std::collections::BTreeMap::default(),
    })
}

fn constant_time_eq(left: &str, right: &str) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.as_bytes()
        .iter()
        .zip(right.as_bytes())
        .fold(0_u8, |value, (left, right)| value | (left ^ right))
        == 0
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use onpeople_types::AppError;
    use serde_json::{Value, json};

    use super::{BrowserCommand, BrowserHostState, BrowserIpc, BrowserIpcClient, IpcConfig};
    use crate::state::BrowserController;

    struct TestController;

    impl BrowserController for TestController {
        fn execute(&self, _command: BrowserCommand) -> Result<Value, AppError> {
            Ok(json!({ "ok": true }))
        }
    }

    #[tokio::test]
    async fn ping_distinguishes_socket_from_cef_readiness() {
        let profile = std::path::PathBuf::from(format!(
            "/tmp/op-ipc-{}",
            &uuid::Uuid::now_v7().to_string()[..8]
        ));
        tokio::fs::create_dir_all(&profile).await.unwrap();
        let config = IpcConfig::for_profile(&profile);
        let state = Arc::new(BrowserHostState::new(profile.clone()));
        state.set_controller(Arc::new(TestController));
        let server = BrowserIpc::new(config.clone(), Arc::clone(&state));
        let task = tokio::spawn(async move { server.serve().await });
        let client = BrowserIpcClient::with_timeout(config, std::time::Duration::from_millis(100));

        let mut first = None;
        let mut last_error = None;
        for _ in 0..50 {
            match client.request(BrowserCommand::Ping).await {
                Ok(value) => {
                    first = Some(value);
                    break;
                }
                Err(error) => {
                    last_error = Some(error);
                    tokio::task::yield_now().await;
                    tokio::time::sleep(std::time::Duration::from_millis(10)).await;
                }
            }
        }
        assert_eq!(
            first.unwrap_or_else(|| panic!("IPC socket ready: {last_error:?}"))["ready"],
            false
        );
        state.set_ready();
        assert_eq!(
            client.request(BrowserCommand::Ping).await.unwrap()["ready"],
            true
        );

        task.abort();
        let _ = tokio::fs::remove_dir_all(profile).await;
    }
}
