use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

use onpeople_types::{AppError, ErrorCode, ProviderSettings};
use parking_lot::{Mutex, RwLock};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, Command},
    sync::{broadcast, oneshot},
    task::JoinHandle,
};
use tracing::{debug, warn};

const INITIALIZE_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Debug, Clone)]
pub struct BuiltinMcpConfig {
    pub host_binary: PathBuf,
    pub browser_available: bool,
}

#[derive(Debug, Clone)]
pub struct AgentRuntimeConfig {
    pub enabled: bool,
    pub max_concurrent_threads: u32,
}

#[derive(Debug, Clone)]
pub enum AppServerEvent {
    Notification(Value),
    ServerRequest(Value),
    Exited {
        code: Option<i32>,
        signal: Option<String>,
    },
}

struct Pending {
    sender: oneshot::Sender<Result<Value, AppError>>,
}

pub struct AppServerClient {
    start_guard: tokio::sync::Mutex<()>,
    child: tokio::sync::Mutex<Option<Child>>,
    stdin: tokio::sync::Mutex<Option<ChildStdin>>,
    pending: Arc<Mutex<HashMap<u64, Pending>>>,
    server_requests: Arc<Mutex<HashMap<String, Value>>>,
    next_id: AtomicU64,
    events: broadcast::Sender<AppServerEvent>,
    reader_task: tokio::sync::Mutex<Option<JoinHandle<()>>>,
    ready: Arc<std::sync::atomic::AtomicBool>,
    binary: std::path::PathBuf,
    builtin_mcp: RwLock<Option<BuiltinMcpConfig>>,
    active_industry_plugin: RwLock<Option<String>>,
    running_industry_plugin: RwLock<Option<String>>,
}

impl AppServerClient {
    #[must_use]
    pub fn new(binary: std::path::PathBuf) -> Arc<Self> {
        // Headless JSONL consumers can be slower than the App Server during
        // command-output bursts. Keep enough headroom to avoid losing the
        // terminal turn/completed notification under normal automation load.
        let (events, _) = broadcast::channel(16_384);
        Arc::new(Self {
            start_guard: tokio::sync::Mutex::new(()),
            child: tokio::sync::Mutex::new(None),
            stdin: tokio::sync::Mutex::new(None),
            pending: Arc::new(Mutex::new(HashMap::new())),
            server_requests: Arc::new(Mutex::new(HashMap::new())),
            next_id: AtomicU64::new(1),
            events,
            reader_task: tokio::sync::Mutex::new(None),
            ready: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            binary,
            builtin_mcp: RwLock::new(None),
            active_industry_plugin: RwLock::new(None),
            running_industry_plugin: RwLock::new(None),
        })
    }

    pub fn configure_builtin_mcp(&self, config: BuiltinMcpConfig) {
        *self.builtin_mcp.write() = Some(config);
    }

    /// Selects the one industry plugin exposed to subsequently created turns.
    ///
    /// Installation and activation are deliberately separate: an installed
    /// industry plugin remains discoverable in the marketplace, but its
    /// skills and MCP servers are absent from the model profile until the
    /// composer explicitly selects it for a turn.
    pub async fn prepare_industry_plugin(&self, plugin_id: Option<String>) {
        *self.active_industry_plugin.write() = plugin_id.clone();
        let restart_required = self.is_ready() && *self.running_industry_plugin.read() != plugin_id;
        if restart_required {
            self.stop().await;
        }
    }

    pub fn configure_active_industry_plugin(&self, plugin_id: Option<String>) {
        *self.active_industry_plugin.write() = plugin_id;
    }

    #[must_use]
    pub fn active_industry_plugin(&self) -> Option<String> {
        self.active_industry_plugin.read().clone()
    }

    pub fn refresh_plugin_profile(&self, codex_home: &Path) -> Result<(), AppError> {
        refresh_installed_plugin_profile(codex_home, self.active_industry_plugin.read().as_deref())
    }

    #[must_use]
    pub fn binary(&self) -> &Path {
        &self.binary
    }

    #[must_use]
    pub fn is_ready(&self) -> bool {
        self.ready.load(Ordering::Acquire)
    }

    #[must_use]
    pub fn subscribe(&self) -> broadcast::Receiver<AppServerEvent> {
        self.events.subscribe()
    }

    #[must_use]
    pub fn pending_request_count(&self) -> usize {
        self.pending.lock().len()
    }

    #[must_use]
    pub fn pending_server_request_count(&self) -> usize {
        self.server_requests.lock().len()
    }

    #[must_use]
    pub fn is_running(&self) -> bool {
        self.child
            .try_lock()
            .map(|child| child.is_some())
            .unwrap_or(false)
    }

    pub async fn start(
        self: &Arc<Self>,
        cwd: &Path,
        codex_home: &Path,
        provider: &ProviderSettings,
        api_key: Option<&str>,
        agents: &AgentRuntimeConfig,
    ) -> Result<(), AppError> {
        let _start_guard = self.start_guard.lock().await;
        if self.is_ready() {
            return Ok(());
        }
        // A failed or interrupted handshake must not leave a server holding the
        // Codex database while a retry starts a second process.
        if self.child.lock().await.is_some() {
            self.stop_process().await;
        }
        if !self.binary.is_file() {
            return Err(AppError::new(
                ErrorCode::RuntimeUnavailable,
                "未找到 Codex App Server sidecar",
            )
            .context("component", "codex"));
        }
        tokio::fs::create_dir_all(codex_home)
            .await
            .map_err(AppError::storage)?;
        tokio::fs::create_dir_all(cwd)
            .await
            .map_err(AppError::storage)?;
        let builtin_mcp = self.builtin_mcp.read().clone();
        let active_industry_plugin = self.active_industry_plugin.read().clone();
        write_onpeople_profile(
            cwd,
            codex_home,
            provider,
            builtin_mcp.as_ref(),
            agents,
            active_industry_plugin.as_deref(),
        )
        .await?;
        let mut command = Command::new(&self.binary);
        command
            .args(["app-server", "--listen", "stdio://"])
            .current_dir(cwd)
            .env("CODEX_HOME", codex_home)
            .env("ONPEOPLE_RUNTIME_NAME", "OnPeople")
            .env("CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED", "1")
            .env("NO_COLOR", "1")
            .env("TERM", "dumb")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        if let Some(api_key) = api_key.filter(|key| !key.is_empty()) {
            command.env("ONPEOPLE_API_KEY", api_key);
        }
        let mut child = command.spawn().map_err(|error| {
            AppError::new(ErrorCode::ProcessFailed, "无法启动 Codex App Server")
                .context("cause", error)
        })?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| AppError::internal("Codex App Server stdin 不可用"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| AppError::internal("Codex App Server stdout 不可用"))?;
        let stderr = child.stderr.take();
        *self.child.lock().await = Some(child);
        *self.stdin.lock().await = Some(stdin);
        self.spawn_reader(stdout).await;
        if let Some(stderr) = stderr {
            let events = self.events.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    if !line.trim().is_empty() {
                        debug!(target: "onpeople.app_server", "{line}");
                        let _ = events.send(AppServerEvent::Notification(json!({
                            "type": "server-log",
                            "text": line,
                        })));
                    }
                }
            });
        }
        let initialized = self
            .request(
                "initialize",
                json!({
                    "clientInfo": {
                        "name": "onpeople",
                        "title": "OnPeople",
                        "version": env!("CARGO_PKG_VERSION")
                    },
                    "capabilities": {
                        "experimentalApi": true,
                        "requestAttestation": false
                    }
                }),
                INITIALIZE_TIMEOUT,
            )
            .await;
        if let Err(error) = initialized {
            self.stop_process().await;
            return Err(error);
        }
        if let Err(error) = self.notify("initialized", json!({})).await {
            self.stop_process().await;
            return Err(error);
        }
        *self.running_industry_plugin.write() = active_industry_plugin;
        self.ready.store(true, Ordering::Release);
        Ok(())
    }

    pub async fn request(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, AppError> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = oneshot::channel();
        self.pending.lock().insert(id, Pending { sender });
        let message = json!({ "id": id, "method": method, "params": params });
        if let Err(error) = self.write_message(&message).await {
            self.pending.lock().remove(&id);
            return Err(error);
        }
        match tokio::time::timeout(timeout, receiver).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(AppError::new(
                ErrorCode::RuntimeUnavailable,
                "Codex App Server 已关闭",
            )),
            Err(_) => {
                self.pending.lock().remove(&id);
                Err(
                    AppError::new(ErrorCode::RuntimeTimeout, "Codex App Server 请求超时")
                        .retryable(true)
                        .context("method", method),
                )
            }
        }
    }

    pub async fn notify(&self, method: &str, params: Value) -> Result<(), AppError> {
        self.write_message(&json!({ "method": method, "params": params }))
            .await
            .map(|_| ())
    }

    pub async fn resolve_server_request(
        &self,
        request_id: &str,
        decision: &str,
    ) -> Result<Value, AppError> {
        let request_id = request_id.trim();
        if request_id.is_empty() {
            return Err(AppError::invalid("审批请求 ID 不能为空"));
        }
        if !matches!(decision, "accept" | "acceptForSession" | "decline") {
            return Err(AppError::invalid("不支持的审批决定"));
        }
        let request = self
            .server_requests
            .lock()
            .get(request_id)
            .cloned()
            .ok_or_else(|| {
                AppError::new(ErrorCode::NotFound, "审批请求已处理或不再有效")
                    .context("requestId", request_id)
            })?;
        let id = request
            .get("id")
            .cloned()
            .ok_or_else(|| AppError::internal("审批请求缺少 JSON-RPC ID"))?;
        let method = request
            .get("method")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let result = if method == "mcpServer/elicitation/request" {
            let action = if decision == "decline" {
                "decline"
            } else {
                "accept"
            };
            let mut result = json!({ "action": action });
            if action == "accept" {
                result["content"] = build_elicitation_content(
                    request
                        .get("params")
                        .and_then(|params| params.get("requestedSchema")),
                );
            }
            result
        } else if method == "execCommandApproval" || method == "applyPatchApproval" {
            let legacy_decision = match decision {
                "accept" => json!("approved"),
                "acceptForSession" => json!("approved_for_session"),
                "decline" => json!({ "denied": { "rejection": "User denied the request" } }),
                _ => unreachable!("decision validated above"),
            };
            json!({ "decision": legacy_decision })
        } else if method == "item/permissions/requestApproval" {
            let requested = request
                .get("params")
                .and_then(|params| params.get("permissions"))
                .cloned()
                .unwrap_or(Value::Null);
            let permissions = if decision == "decline" {
                json!({
                    "network": { "enabled": false },
                    "fileSystem": { "read": [], "write": [], "entries": [] }
                })
            } else {
                requested
            };
            json!({
                "permissions": permissions,
                "scope": if decision == "acceptForSession" { "session" } else { "turn" }
            })
        } else {
            json!({ "decision": decision })
        };
        self.write_message(&json!({ "id": id, "result": result }))
            .await?;
        self.server_requests.lock().remove(request_id);
        Ok(json!({ "requestId": request_id, "decision": decision }))
    }

    pub async fn resolve_user_input(
        &self,
        request_id: &str,
        answers: Value,
    ) -> Result<Value, AppError> {
        let request_id = request_id.trim();
        if request_id.is_empty() {
            return Err(AppError::invalid("用户输入请求 ID 不能为空"));
        }
        let request = self
            .server_requests
            .lock()
            .get(request_id)
            .cloned()
            .ok_or_else(|| {
                AppError::new(ErrorCode::NotFound, "用户输入请求已处理或不再有效")
                    .context("requestId", request_id)
            })?;
        if request.get("method").and_then(Value::as_str) != Some("item/tool/requestUserInput") {
            return Err(AppError::invalid("请求类型不是用户输入"));
        }
        let answer_object = answers
            .as_object()
            .ok_or_else(|| AppError::invalid("用户输入答案格式无效"))?;
        let questions = request
            .get("params")
            .and_then(|params| params.get("questions"))
            .and_then(Value::as_array)
            .ok_or_else(|| AppError::internal("用户输入请求缺少问题"))?;
        let mut normalized = serde_json::Map::new();
        for question in questions {
            let id = question
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| AppError::internal("用户输入问题缺少 ID"))?;
            let values = answer_object
                .get(id)
                .and_then(Value::as_array)
                .ok_or_else(|| AppError::invalid(format!("问题 {id} 尚未回答")))?;
            let values = values
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .take(10)
                .map(|value| Value::String(value.chars().take(4_000).collect()))
                .collect::<Vec<_>>();
            if values.is_empty() {
                return Err(AppError::invalid(format!("问题 {id} 尚未回答")));
            }
            normalized.insert(id.to_owned(), json!({ "answers": values }));
        }
        let id = request
            .get("id")
            .cloned()
            .ok_or_else(|| AppError::internal("用户输入请求缺少 JSON-RPC ID"))?;
        self.write_message(&json!({
            "id": id,
            "result": { "answers": normalized }
        }))
        .await?;
        self.server_requests.lock().remove(request_id);
        Ok(json!({ "requestId": request_id, "answered": true }))
    }

    pub async fn stop(&self) {
        let _start_guard = self.start_guard.lock().await;
        self.stop_process().await;
    }

    async fn stop_process(&self) {
        self.ready.store(false, Ordering::Release);
        if let Some(task) = self.reader_task.lock().await.take() {
            task.abort();
        }
        if let Some(mut child) = self.child.lock().await.take() {
            let _ = child.kill().await;
            let _ = child.wait().await;
        }
        *self.stdin.lock().await = None;
        let error = AppError::new(ErrorCode::RuntimeUnavailable, "Codex App Server 已停止");
        let pending = std::mem::take(&mut *self.pending.lock());
        for (_, item) in pending {
            let _ = item.sender.send(Err(error.clone()));
        }
        self.server_requests.lock().clear();
    }

    async fn write_message(&self, message: &Value) -> Result<(), AppError> {
        let mut stdin = self.stdin.lock().await;
        let stdin = stdin.as_mut().ok_or_else(|| {
            AppError::new(ErrorCode::RuntimeUnavailable, "Codex App Server 尚未启动")
        })?;
        let mut line = serde_json::to_vec(message).map_err(AppError::internal)?;
        line.push(b'\n');
        stdin.write_all(&line).await.map_err(AppError::storage)?;
        stdin.flush().await.map_err(AppError::storage)
    }

    async fn spawn_reader(self: &Arc<Self>, stdout: tokio::process::ChildStdout) {
        let pending = Arc::clone(&self.pending);
        let server_requests = Arc::clone(&self.server_requests);
        let events = self.events.clone();
        let ready = Arc::clone(&self.ready);
        let client = Arc::downgrade(self);
        let task = tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            loop {
                match lines.next_line().await {
                    Ok(Some(line)) => {
                        if let Ok(message) = serde_json::from_str::<Value>(&line) {
                            if is_response(&message) {
                                let Some(id) = message.get("id").and_then(Value::as_u64) else {
                                    warn!("ignored app server response with a non-numeric id");
                                    continue;
                                };
                                if let Some(item) = pending.lock().remove(&id) {
                                    let result = if let Some(error) = message.get("error") {
                                        Err(AppError::new(
                                            ErrorCode::RuntimeProtocol,
                                            error
                                                .get("message")
                                                .and_then(Value::as_str)
                                                .unwrap_or("Codex 请求失败"),
                                        ))
                                    } else {
                                        Ok(message.get("result").cloned().unwrap_or(Value::Null))
                                    };
                                    let _ = item.sender.send(result);
                                }
                            } else if is_server_request(&message) {
                                let request_id = rpc_id_key(
                                    message.get("id").expect("server request id checked"),
                                );
                                if is_supported_server_request(&message) {
                                    server_requests.lock().insert(request_id, message.clone());
                                    let _ = events.send(AppServerEvent::ServerRequest(message));
                                } else {
                                    let _ = events.send(AppServerEvent::Notification(json!({
                                        "type": "unsupported-server-request",
                                        "request": message.clone(),
                                    })));
                                    if let Some(client) = client.upgrade() {
                                        let _ = client
                                            .write_message(&json!({
                                                "id": message.get("id").cloned().unwrap_or(Value::Null),
                                                "error": {
                                                    "code": -32601,
                                                    "message": format!(
                                                        "Unsupported client request: {}",
                                                        message
                                                            .get("method")
                                                            .and_then(Value::as_str)
                                                            .unwrap_or("unknown")
                                                    )
                                                }
                                            }))
                                            .await;
                                    }
                                }
                            } else {
                                let _ = events.send(AppServerEvent::Notification(message));
                            }
                        } else if !line.trim().is_empty() {
                            warn!("ignored non-json app server output");
                        }
                    }
                    Ok(None) | Err(_) => break,
                }
            }
            ready.store(false, Ordering::Release);
            let pending = std::mem::take(&mut *pending.lock());
            for (_, item) in pending {
                let _ = item.sender.send(Err(AppError::new(
                    ErrorCode::RuntimeUnavailable,
                    "Codex App Server 进程已退出",
                )));
            }
            server_requests.lock().clear();
            let _ = events.send(AppServerEvent::Exited {
                code: None,
                signal: None,
            });
        });
        *self.reader_task.lock().await = Some(task);
    }
}

async fn write_onpeople_profile(
    workspace: &Path,
    codex_home: &Path,
    provider: &ProviderSettings,
    builtin_mcp: Option<&BuiltinMcpConfig>,
    agents: &AgentRuntimeConfig,
    active_industry_plugin: Option<&str>,
) -> Result<(), AppError> {
    let base_url = if provider.base_url.trim().is_empty() {
        "https://api.aibro.vip/v1"
    } else {
        provider.base_url.trim()
    };
    let supports_websockets = provider
        .extra
        .get("supportsWebSockets")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    // Prefer Responses WebSockets for incremental multi-turn sessions. The
    // Codex transport keeps HTTPS as its retry-exhausted fallback path.
    let mut contents = format!(
        "model_provider = \"onpeople\"\n\n[agents]\nenabled = {}\nmax_concurrent_threads_per_session = {}\n\n[model_providers.onpeople]\nname = \"OnPeople\"\nbase_url = {}\nwire_api = \"responses\"\nenv_key = \"ONPEOPLE_API_KEY\"\nrequires_openai_auth = false\nsupports_websockets = {}\n",
        agents.enabled,
        agents.max_concurrent_threads.clamp(1, 16),
        toml_string(base_url),
        supports_websockets,
    );
    if let Some(cache_affinity) = headless_cache_affinity(workspace, provider) {
        contents.push_str(&format!(
            "http_headers = {{ \"X-Session-Affinity\" = {}, \"X-Session-Id\" = {}, \"session_id\" = {} }}\n",
            toml_string(&cache_affinity),
            toml_string(&cache_affinity),
            toml_string(&cache_affinity),
        ));
    }
    if let Some(mcp) = builtin_mcp {
        let mut servers = vec![
            ("workspace_artifacts", "artifacts"),
            ("computer_use", "computer-use"),
            ("image_generation", "image-generation"),
        ];
        if active_industry_plugin == Some("research-paper") {
            servers.push(("research_sources", "research-sources"));
        }
        if mcp.browser_available {
            servers.insert(1, ("internal_browser", "browser"));
        }
        for (server_id, argument) in servers {
            contents.push_str(&format!(
                "\n[mcp_servers.{server_id}]\ncommand = {}\nargs = [{}]\nrequired = false\nstartup_timeout_sec = 10\ntool_timeout_sec = 120\ndefault_tools_approval_mode = \"approve\"\n",
                toml_string(&mcp.host_binary.to_string_lossy()),
                toml_string(argument),
            ));
            if server_id == "internal_browser" {
                // Codex intentionally starts MCP servers with a restricted
                // environment. Explicitly allow only the two ephemeral
                // bridge values that the browser host needs; keeping them in
                // `env_vars` avoids persisting the authentication token in
                // the generated profile.
                contents.push_str(
                    "env_vars = [\"ONPEOPLE_BROWSER_AGENT_BRIDGE\", \"ONPEOPLE_BROWSER_AGENT_TOKEN\"]\n",
                );
            }
        }
    }
    contents.push_str(&installed_plugin_profile(
        codex_home,
        active_industry_plugin,
    )?);
    let path = codex_home.join("config.toml");
    let temporary = codex_home.join("config.toml.tmp");
    tokio::fs::write(&temporary, contents)
        .await
        .map_err(AppError::storage)?;
    tokio::fs::rename(&temporary, &path)
        .await
        .map_err(AppError::storage)?;
    let legacy_path = codex_home.join("onpeople.config.toml");
    let _ = tokio::fs::remove_file(legacy_path).await;
    Ok(())
}

fn headless_cache_affinity(workspace: &Path, provider: &ProviderSettings) -> Option<String> {
    if provider
        .extra
        .get("headlessCacheAffinity")
        .and_then(Value::as_bool)
        != Some(true)
    {
        return None;
    }
    let mut digest = Sha256::new();
    digest.update(b"onpeople-headless-cache-affinity-v1\0");
    digest.update(provider.base_url.trim().as_bytes());
    digest.update(b"\0");
    digest.update(workspace.to_string_lossy().as_bytes());
    let digest = digest.finalize();
    Some(format!("onpeople-{}", hex::encode(&digest[..16])))
}

const PLUGIN_PROFILE_BEGIN: &str = "# ONPEOPLE PLUGINS BEGIN";
const PLUGIN_PROFILE_END: &str = "# ONPEOPLE PLUGINS END";

/// Rebuild the personal marketplace used by `OnPeople`'s isolated Codex Home and
/// update the generated plugin section without touching provider credentials.
/// The runtime restarts the app server when the selected industry plugin changes.
fn refresh_installed_plugin_profile(
    codex_home: &Path,
    active_industry_plugin: Option<&str>,
) -> Result<(), AppError> {
    let path = codex_home.join("config.toml");
    if !path.is_file() {
        return Ok(());
    }
    let contents = std::fs::read_to_string(&path).map_err(AppError::storage)?;
    let base = strip_plugin_profile(&contents);
    let mut updated = base.trim_end().to_owned();
    updated.push_str(&installed_plugin_profile(
        codex_home,
        active_industry_plugin,
    )?);
    updated.push('\n');
    let temporary = codex_home.join("config.toml.plugins.tmp");
    std::fs::write(&temporary, updated).map_err(AppError::storage)?;
    std::fs::rename(&temporary, path).map_err(AppError::storage)
}

fn installed_plugin_profile(
    codex_home: &Path,
    active_industry_plugin: Option<&str>,
) -> Result<String, AppError> {
    let plugins_root = codex_home.join("plugins");
    let mut plugins = Vec::new();
    if plugins_root.is_dir() {
        for entry in std::fs::read_dir(&plugins_root).map_err(AppError::storage)? {
            let entry = entry.map_err(AppError::storage)?;
            if !entry.file_type().map_err(AppError::storage)?.is_dir() {
                continue;
            }
            let manifest_path = entry.path().join(".codex-plugin/plugin.json");
            let Ok(manifest) = std::fs::read_to_string(&manifest_path) else {
                continue;
            };
            let Ok(manifest) = serde_json::from_str::<Value>(&manifest) else {
                continue;
            };
            let Some(id) = manifest.get("name").and_then(Value::as_str) else {
                continue;
            };
            if id.is_empty()
                || !id
                    .chars()
                    .all(|character| character.is_ascii_alphanumeric() || "._-".contains(character))
            {
                continue;
            }
            let industry = entry.path().join(".onpeople/industry.json").is_file();
            plugins.push((id.to_owned(), industry));
        }
    }
    plugins.sort_by(|left, right| left.0.cmp(&right.0));
    plugins.dedup_by(|left, right| left.0 == right.0);

    let marketplace_dir = codex_home.join(".agents/plugins");
    std::fs::create_dir_all(&marketplace_dir).map_err(AppError::storage)?;
    let entries = plugins
        .iter()
        .map(|(id, _)| {
            json!({
                "name": id,
                "source": { "source": "local", "path": format!("./plugins/{id}") },
                "policy": { "installation": "AVAILABLE", "authentication": "ON_INSTALL" },
                "category": "OnPeople"
            })
        })
        .collect::<Vec<_>>();
    let marketplace = json!({
        "name": "onpeople-local",
        "interface": { "displayName": "OnPeople" },
        "plugins": entries,
    });
    let marketplace_bytes = serde_json::to_vec_pretty(&marketplace).map_err(AppError::internal)?;
    std::fs::write(marketplace_dir.join("marketplace.json"), marketplace_bytes)
        .map_err(AppError::storage)?;

    if plugins.is_empty() {
        return Ok(format!("\n{PLUGIN_PROFILE_BEGIN}\n{PLUGIN_PROFILE_END}\n"));
    }
    let mut block = format!(
        "\n{PLUGIN_PROFILE_BEGIN}\n\n[marketplaces.onpeople-local]\nsource_type = \"local\"\nsource = {}\n",
        toml_string(&codex_home.to_string_lossy()),
    );
    for (id, industry) in plugins {
        let enabled = !industry || active_industry_plugin == Some(id.as_str());
        block.push_str(&format!(
            "\n[plugins.{}]\nenabled = {enabled}\n",
            toml_string(&format!("{id}@onpeople-local")),
        ));
    }
    block.push_str(&format!("\n{PLUGIN_PROFILE_END}\n"));
    Ok(block)
}

fn strip_plugin_profile(contents: &str) -> String {
    let Some(start) = contents.find(PLUGIN_PROFILE_BEGIN) else {
        return contents.to_owned();
    };
    let Some(relative_end) = contents[start..].find(PLUGIN_PROFILE_END) else {
        return contents[..start].to_owned();
    };
    let end = start + relative_end + PLUGIN_PROFILE_END.len();
    format!("{}{}", &contents[..start], &contents[end..])
}

fn toml_string(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_owned())
}

#[cfg(test)]
mod profile_tests {
    use super::{AgentRuntimeConfig, BuiltinMcpConfig, write_onpeople_profile};
    use onpeople_types::{ProviderKind, ProviderSettings};
    use serde_json::Value;
    use tempfile::tempdir;

    #[tokio::test]
    async fn writes_an_onpeople_profile_without_credentials() {
        let root = tempdir().expect("temporary root");
        let provider = ProviderSettings {
            kind: ProviderKind::Onpeople,
            base_url: "https://sub2api.example/v1".to_owned(),
            ..ProviderSettings::default()
        };
        std::fs::write(
            root.path().join("onpeople.config.toml"),
            "model_provider = \"openai\"\n",
        )
        .expect("legacy profile");
        write_onpeople_profile(
            root.path(),
            root.path(),
            &provider,
            None,
            &AgentRuntimeConfig {
                enabled: true,
                max_concurrent_threads: 4,
            },
            None,
        )
        .await
        .expect("profile");
        let profile =
            std::fs::read_to_string(root.path().join("config.toml")).expect("profile contents");
        assert!(profile.contains("model_provider = \"onpeople\""));
        assert!(profile.contains("base_url = \"https://sub2api.example/v1\""));
        assert!(profile.contains("env_key = \"ONPEOPLE_API_KEY\""));
        assert!(profile.contains("supports_websockets = true"));
        assert!(profile.contains("[agents]"));
        assert!(profile.contains("enabled = true"));
        assert!(profile.contains("max_concurrent_threads_per_session = 4"));
        assert!(!profile.contains("api_key"));
        assert!(!root.path().join("onpeople.config.toml").exists());
    }

    #[tokio::test]
    async fn allows_http_only_transport_without_changing_the_default() {
        let root = tempdir().expect("temporary root");
        let mut provider = ProviderSettings {
            kind: ProviderKind::Onpeople,
            base_url: "https://sub2api.example/v1".to_owned(),
            ..ProviderSettings::default()
        };
        provider
            .extra
            .insert("supportsWebSockets".to_owned(), Value::Bool(false));

        write_onpeople_profile(
            root.path(),
            root.path(),
            &provider,
            None,
            &AgentRuntimeConfig {
                enabled: false,
                max_concurrent_threads: 1,
            },
            None,
        )
        .await
        .expect("profile");

        let profile =
            std::fs::read_to_string(root.path().join("config.toml")).expect("profile contents");
        assert!(profile.contains("supports_websockets = false"));
    }

    #[tokio::test]
    async fn writes_builtin_mcp_servers_without_shell_quoting() {
        let root = tempdir().expect("temporary root");
        let provider = ProviderSettings {
            kind: ProviderKind::Onpeople,
            base_url: "https://sub2api.example/v1".to_owned(),
            ..ProviderSettings::default()
        };
        let mcp = BuiltinMcpConfig {
            host_binary:
                "/Applications/OnPeople.app/Contents/Resources/.embedded-runtime/onpeople-mcp-host"
                    .into(),
            browser_available: true,
        };
        write_onpeople_profile(
            root.path(),
            root.path(),
            &provider,
            Some(&mcp),
            &AgentRuntimeConfig {
                enabled: false,
                max_concurrent_threads: 6,
            },
            None,
        )
        .await
        .expect("profile");
        let profile =
            std::fs::read_to_string(root.path().join("config.toml")).expect("profile contents");
        assert!(profile.contains("[mcp_servers.workspace_artifacts]"));
        assert_eq!(profile.matches("[mcp_servers.").count(), 4);
        assert!(profile.contains("args = [\"artifacts\"]"));
        assert!(profile.contains("[mcp_servers.computer_use]"));
        assert!(profile.contains("args = [\"computer-use\"]"));
        assert!(profile.contains("[mcp_servers.internal_browser]"));
        assert!(profile.contains("args = [\"browser\"]"));
        assert!(profile.contains(
            "env_vars = [\"ONPEOPLE_BROWSER_AGENT_BRIDGE\", \"ONPEOPLE_BROWSER_AGENT_TOKEN\"]"
        ));
        assert!(!profile.contains("[mcp_servers.research_sources]"));
        assert!(profile.contains("enabled = false"));
        assert!(profile.contains("max_concurrent_threads_per_session = 6"));
    }

    #[tokio::test]
    async fn omits_the_browser_server_when_the_desktop_bridge_is_unavailable() {
        let root = tempdir().expect("temporary root");
        write_onpeople_profile(
            root.path(),
            root.path(),
            &ProviderSettings::default(),
            Some(&BuiltinMcpConfig {
                host_binary: "/Applications/OnPeople.app/onpeople-mcp-host".into(),
                browser_available: false,
            }),
            &AgentRuntimeConfig {
                enabled: false,
                max_concurrent_threads: 6,
            },
            None,
        )
        .await
        .expect("profile");
        let profile =
            std::fs::read_to_string(root.path().join("config.toml")).expect("profile contents");
        assert_eq!(profile.matches("[mcp_servers.").count(), 3);
        assert!(!profile.contains("[mcp_servers.internal_browser]"));
    }

    #[tokio::test]
    async fn registers_installed_local_plugins_in_the_isolated_profile() {
        let root = tempdir().expect("temporary root");
        let plugin = root.path().join("plugins/research-paper/.codex-plugin");
        std::fs::create_dir_all(&plugin).expect("plugin directory");
        std::fs::create_dir_all(root.path().join("plugins/research-paper/.onpeople"))
            .expect("industry directory");
        std::fs::write(
            root.path()
                .join("plugins/research-paper/.onpeople/industry.json"),
            r#"{"type":"industry"}"#,
        )
        .expect("industry manifest");
        std::fs::write(
            plugin.join("plugin.json"),
            r#"{"name":"research-paper","version":"1.0.0"}"#,
        )
        .expect("plugin manifest");
        write_onpeople_profile(
            root.path(),
            root.path(),
            &ProviderSettings::default(),
            None,
            &AgentRuntimeConfig {
                enabled: true,
                max_concurrent_threads: 2,
            },
            None,
        )
        .await
        .expect("profile");
        let profile =
            std::fs::read_to_string(root.path().join("config.toml")).expect("profile contents");
        assert!(profile.contains("[marketplaces.onpeople-local]"));
        assert!(profile.contains("[plugins.\"research-paper@onpeople-local\"]"));
        assert!(profile.contains("[plugins.\"research-paper@onpeople-local\"]\nenabled = false"));
        let marketplace =
            std::fs::read_to_string(root.path().join(".agents/plugins/marketplace.json"))
                .expect("marketplace");
        assert!(marketplace.contains("./plugins/research-paper"));
    }

    #[tokio::test]
    async fn enables_only_the_selected_industry_plugin_and_its_research_mcp() {
        let root = tempdir().expect("temporary root");
        for id in ["research-paper", "legal-review"] {
            let plugin = root.path().join(format!("plugins/{id}"));
            std::fs::create_dir_all(plugin.join(".codex-plugin")).expect("plugin directory");
            std::fs::create_dir_all(plugin.join(".onpeople")).expect("industry directory");
            std::fs::write(
                plugin.join(".codex-plugin/plugin.json"),
                format!(r#"{{"name":"{id}","version":"1.0.0"}}"#),
            )
            .expect("plugin manifest");
            std::fs::write(plugin.join(".onpeople/industry.json"), "{}")
                .expect("industry manifest");
        }
        write_onpeople_profile(
            root.path(),
            root.path(),
            &ProviderSettings::default(),
            Some(&BuiltinMcpConfig {
                host_binary: "/Applications/OnPeople.app/onpeople-mcp-host".into(),
                browser_available: false,
            }),
            &AgentRuntimeConfig {
                enabled: false,
                max_concurrent_threads: 1,
            },
            Some("research-paper"),
        )
        .await
        .expect("profile");

        let profile =
            std::fs::read_to_string(root.path().join("config.toml")).expect("profile contents");
        assert!(profile.contains("[mcp_servers.research_sources]"));
        assert!(profile.contains("[plugins.\"research-paper@onpeople-local\"]\nenabled = true"));
        assert!(profile.contains("[plugins.\"legal-review@onpeople-local\"]\nenabled = false"));
    }

    #[tokio::test]
    async fn writes_workspace_scoped_headless_cache_affinity_headers() {
        let root = tempdir().expect("temporary root");
        let workspace = root.path().join("private-workspace-name");
        std::fs::create_dir(&workspace).expect("workspace");
        let mut provider = ProviderSettings {
            kind: ProviderKind::Onpeople,
            base_url: "https://sub2api.example/v1".to_owned(),
            ..ProviderSettings::default()
        };
        provider
            .extra
            .insert("headlessCacheAffinity".to_owned(), Value::Bool(true));

        write_onpeople_profile(
            &workspace,
            root.path(),
            &provider,
            None,
            &AgentRuntimeConfig {
                enabled: false,
                max_concurrent_threads: 1,
            },
            None,
        )
        .await
        .expect("profile");
        let first =
            std::fs::read_to_string(root.path().join("config.toml")).expect("profile contents");
        write_onpeople_profile(
            &workspace,
            root.path(),
            &provider,
            None,
            &AgentRuntimeConfig {
                enabled: false,
                max_concurrent_threads: 1,
            },
            None,
        )
        .await
        .expect("profile");
        let second =
            std::fs::read_to_string(root.path().join("config.toml")).expect("profile contents");

        assert_eq!(first, second);
        assert!(first.contains("http_headers = { \"X-Session-Affinity\" = \"onpeople-"));
        assert!(first.contains("\"X-Session-Id\" = \"onpeople-"));
        assert!(first.contains("\"session_id\" = \"onpeople-"));
        assert!(!first.contains("private-workspace-name"));
    }
}

fn is_response(message: &Value) -> bool {
    message.get("id").is_some()
        && (message.get("result").is_some() || message.get("error").is_some())
}

fn is_server_request(message: &Value) -> bool {
    message.get("id").is_some() && message.get("method").and_then(Value::as_str).is_some()
}

fn is_supported_server_request(message: &Value) -> bool {
    let Some(method) = message.get("method").and_then(Value::as_str) else {
        return false;
    };
    if method == "item/tool/requestUserInput"
        || method.ends_with("/requestApproval")
        || matches!(method, "execCommandApproval" | "applyPatchApproval")
    {
        return true;
    }
    method == "mcpServer/elicitation/request"
        && message
            .get("params")
            .and_then(|params| params.get("serverName"))
            .and_then(Value::as_str)
            == Some("computer_use")
        && matches!(
            message
                .get("params")
                .and_then(|params| params.get("mode"))
                .and_then(Value::as_str),
            Some("form" | "openai/form")
        )
}

fn rpc_id_key(id: &Value) -> String {
    id.as_str()
        .map_or_else(|| id.to_string(), ToOwned::to_owned)
}

fn build_elicitation_content(schema: Option<&Value>) -> Value {
    let properties = schema
        .and_then(|value| value.get("properties"))
        .and_then(Value::as_object);
    let required = schema
        .and_then(|value| value.get("required"))
        .and_then(Value::as_array);
    let mut content = serde_json::Map::new();
    for name in required.into_iter().flatten().filter_map(Value::as_str) {
        let field = properties.and_then(|values| values.get(name));
        let value = field
            .and_then(|value| value.get("const"))
            .or_else(|| field.and_then(|value| value.get("default")))
            .or_else(|| {
                field
                    .and_then(|value| value.get("enum"))
                    .and_then(Value::as_array)
                    .and_then(|values| values.first())
            })
            .cloned()
            .unwrap_or_else(|| {
                match field
                    .and_then(|value| value.get("type"))
                    .and_then(Value::as_str)
                {
                    Some("boolean") => Value::Bool(true),
                    Some("number" | "integer") => json!(1),
                    _ => Value::String("approved".to_owned()),
                }
            });
        content.insert(name.to_owned(), value);
    }
    Value::Object(content)
}

#[cfg(test)]
mod tests {
    use super::{build_elicitation_content, is_supported_server_request, rpc_id_key};
    use serde_json::json;

    #[test]
    fn recognizes_supported_server_approval_requests() {
        assert!(is_supported_server_request(&json!({
            "id": 9,
            "method": "item/commandExecution/requestApproval",
            "params": {}
        })));
        assert!(is_supported_server_request(&json!({
            "id": "form-1",
            "method": "mcpServer/elicitation/request",
            "params": { "serverName": "computer_use", "mode": "openai/form" }
        })));
        assert!(is_supported_server_request(&json!({
            "id": "input-1",
            "method": "item/tool/requestUserInput",
            "params": { "questions": [] }
        })));
        assert!(!is_supported_server_request(&json!({
            "id": 10,
            "method": "account/login/start",
            "params": {}
        })));
        assert_eq!(rpc_id_key(&json!(9)), "9");
        assert_eq!(rpc_id_key(&json!("form-1")), "form-1");
    }

    #[test]
    fn builds_required_elicitation_fields_without_leaking_schema() {
        let content = build_elicitation_content(Some(&json!({
            "type": "object",
            "properties": {
                "approved": { "type": "boolean" },
                "scope": { "enum": ["window", "desktop"] },
                "count": { "type": "integer" }
            },
            "required": ["approved", "scope", "count"]
        })));
        assert_eq!(
            content,
            json!({ "approved": true, "scope": "window", "count": 1 })
        );
    }
}
