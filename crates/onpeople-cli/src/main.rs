use std::{
    env, fs,
    io::{self, IsTerminal, Read, Write},
    path::{Path, PathBuf},
    process::ExitCode,
    time::{Duration, Instant},
};

use onpeople_core_runtime::{AgentRuntimeConfig, AppServerClient, AppServerEvent};
use onpeople_integrations::RuntimePaths;
use onpeople_storage::{Storage, stable_data_root};
use onpeople_types::{AppError, ErrorCode, ProviderKind, ProviderSettings};
use serde_json::{Value, json};

const DEFAULT_MODEL: &str = "gpt-5.6-luna";
const DEFAULT_BASE_URL: &str = "https://api.aibro.vip/v1";
const DEFAULT_TIMEOUT_SECONDS: u64 = 60 * 60;
const DEFAULT_IDLE_TIMEOUT_SECONDS: u64 = 15 * 60;
const HEADLESS_HOME_DIRECTORY: &str = "headless-v1";
const HEADLESS_DEVELOPER_INSTRUCTIONS: &str = r"You are running as the OnPeople headless coding agent. Complete the user's requested repository change autonomously and converge promptly.

Contract discipline:
- Before editing, turn every explicit requirement and implied input class into a short internal checklist. Preserve the requested API and error types exactly.
- Implement the smallest change that satisfies that checklist. Do not add stricter standards, compatibility rules, or speculative behavior that the prompt does not require.
- For transformations, parsing, validation, concurrency, and boundary work, run focused checks for every requested class. Include one representative non-obvious value implied by the contract, such as accented Unicode when output must be ASCII, zero at an inclusive numeric boundary, or rejection cleanup in asynchronous deduplication.

Convergence discipline:
- Once the implementation and focused checks satisfy the checklist, stop and provide the final result immediately.
- Do not keep expanding ad hoc tests after a successful focused verification pass. Run another edit-test cycle only for a concrete observed failure or an unmet explicit requirement.
- Keep progress messages concise. Never delay completion to explore optional edge cases.";

#[derive(Debug, Clone, PartialEq, Eq)]
struct ExecOptions {
    cwd: PathBuf,
    prompt: Option<String>,
    json: bool,
    ephemeral: bool,
    output_last_message: Option<PathBuf>,
    model: Option<String>,
    reasoning_effort: Option<String>,
    transport: String,
    sandbox: String,
    approval_policy: String,
    network: bool,
    timeout_seconds: u64,
    idle_timeout_seconds: u64,
    runtime_root: Option<PathBuf>,
    data_root: Option<PathBuf>,
    skip_git_repo_check: bool,
    use_desktop_credentials: bool,
}

#[derive(Debug)]
enum Command {
    Exec(Box<ExecOptions>),
    Help,
    Version,
}

#[derive(Debug)]
struct RunResult {
    final_message: String,
    thread_id: String,
    turn_id: String,
    usage: Option<Value>,
    transport: TransportMetrics,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct TransportMetrics {
    prewarm_failures: u32,
    stream_retries: u32,
    http_fallbacks: u32,
    previous_response_not_found: u32,
}

impl TransportMetrics {
    fn observe(&mut self, payload: &Value) {
        if payload.get("type").and_then(Value::as_str) != Some("server-log") {
            return;
        }
        let Some(text) = payload.get("text").and_then(Value::as_str) else {
            return;
        };
        if text.contains("startup websocket prewarm setup failed") {
            self.prewarm_failures = self.prewarm_failures.saturating_add(1);
        }
        if text.contains("stream disconnected - retrying sampling request") {
            self.stream_retries = self.stream_retries.saturating_add(1);
        }
        if text.to_ascii_lowercase().contains("falling back to http") {
            self.http_fallbacks = self.http_fallbacks.saturating_add(1);
        }
        if text.contains("previous_response_not_found") {
            self.previous_response_not_found = self.previous_response_not_found.saturating_add(1);
        }
    }

    fn as_json(&self, requested: &str, websocket_configured: bool) -> Value {
        json!({
            "requestedMode": requested,
            "websocketConfigured": websocket_configured,
            "prewarmFailures": self.prewarm_failures,
            "streamRetries": self.stream_retries,
            "httpFallbacks": self.http_fallbacks,
            "previousResponseNotFound": self.previous_response_not_found,
        })
    }

    fn degraded(&self) -> bool {
        self.prewarm_failures > 0 || self.stream_retries > 0 || self.http_fallbacks > 0
    }
}

fn main() -> ExitCode {
    match parse_command(env::args().skip(1)) {
        Ok(Command::Help) => {
            print!("{}", usage());
            ExitCode::SUCCESS
        }
        Ok(Command::Version) => {
            println!("onpeople {}", env!("CARGO_PKG_VERSION"));
            ExitCode::SUCCESS
        }
        Ok(Command::Exec(options)) => {
            let json = options.json;
            match tokio::runtime::Runtime::new() {
                Ok(runtime) => match runtime.block_on(run_exec(*options)) {
                    Ok(()) => ExitCode::SUCCESS,
                    Err(error) => {
                        emit_run_error(&error, json);
                        ExitCode::FAILURE
                    }
                },
                Err(error) => {
                    eprintln!("onpeople: 无法启动异步运行时: {error}");
                    ExitCode::FAILURE
                }
            }
        }
        Err(error) => {
            eprintln!("onpeople: {error}\n\n{}", usage());
            ExitCode::from(2)
        }
    }
}

fn parse_command(args: impl IntoIterator<Item = String>) -> Result<Command, String> {
    let mut args = args.into_iter();
    let Some(command) = args.next() else {
        return Ok(Command::Help);
    };
    match command.as_str() {
        "--help" | "-h" | "help" => Ok(Command::Help),
        "--version" | "-V" | "version" => Ok(Command::Version),
        "exec" => {
            let remaining = args.collect::<Vec<_>>();
            if remaining
                .iter()
                .any(|argument| matches!(argument.as_str(), "--help" | "-h"))
            {
                Ok(Command::Help)
            } else {
                parse_exec(remaining).map(Box::new).map(Command::Exec)
            }
        }
        _ => Err(format!("未知命令: {command}")),
    }
}

fn parse_exec(args: impl IntoIterator<Item = String>) -> Result<ExecOptions, String> {
    let mut options = ExecOptions {
        cwd: env::current_dir().map_err(|error| format!("无法读取当前目录: {error}"))?,
        prompt: None,
        json: false,
        ephemeral: false,
        output_last_message: None,
        model: None,
        reasoning_effort: None,
        transport: "auto".to_owned(),
        sandbox: "read-only".to_owned(),
        approval_policy: "never".to_owned(),
        network: false,
        timeout_seconds: DEFAULT_TIMEOUT_SECONDS,
        idle_timeout_seconds: DEFAULT_IDLE_TIMEOUT_SECONDS,
        runtime_root: None,
        data_root: None,
        skip_git_repo_check: false,
        use_desktop_credentials: false,
    };
    let mut args = args.into_iter();
    while let Some(argument) = args.next() {
        let mut value = |name: &str| args.next().ok_or_else(|| format!("{name} 需要一个参数值"));
        match argument.as_str() {
            "--json" => options.json = true,
            "--ephemeral" => options.ephemeral = true,
            "--network" => options.network = true,
            "--skip-git-repo-check" => options.skip_git_repo_check = true,
            "--use-desktop-credentials" => options.use_desktop_credentials = true,
            "-C" | "--cwd" => options.cwd = PathBuf::from(value(&argument)?),
            "-o" | "--output-last-message" => {
                options.output_last_message = Some(PathBuf::from(value(&argument)?));
            }
            "-m" | "--model" => options.model = Some(value(&argument)?),
            "--reasoning-effort" => options.reasoning_effort = Some(value(&argument)?),
            "--transport" => options.transport = value(&argument)?,
            "--sandbox" => options.sandbox = value(&argument)?,
            "--approval-policy" => options.approval_policy = value(&argument)?,
            "--timeout" => {
                options.timeout_seconds = value(&argument)?
                    .parse::<u64>()
                    .map_err(|_| "--timeout 必须是秒数".to_owned())?;
                if options.timeout_seconds == 0 {
                    return Err("--timeout 必须大于 0".to_owned());
                }
            }
            "--idle-timeout" => {
                options.idle_timeout_seconds = value(&argument)?
                    .parse::<u64>()
                    .map_err(|_| "--idle-timeout 必须是秒数".to_owned())?;
                if options.idle_timeout_seconds == 0 {
                    return Err("--idle-timeout 必须大于 0".to_owned());
                }
            }
            "--runtime-root" => options.runtime_root = Some(PathBuf::from(value(&argument)?)),
            "--data-root" => options.data_root = Some(PathBuf::from(value(&argument)?)),
            "-" => set_prompt(&mut options, "-".to_owned())?,
            value if value.starts_with('-') => return Err(format!("未知参数: {value}")),
            prompt => set_prompt(&mut options, prompt.to_owned())?,
        }
    }
    validate_choice(
        "--transport",
        &options.transport,
        &["auto", "websocket", "http"],
    )?;
    validate_choice(
        "--sandbox",
        &options.sandbox,
        &["read-only", "workspace-write", "danger-full-access"],
    )?;
    validate_choice(
        "--approval-policy",
        &options.approval_policy,
        &["never", "untrusted", "on-request"],
    )?;
    Ok(options)
}

fn set_prompt(options: &mut ExecOptions, prompt: String) -> Result<(), String> {
    if options.prompt.replace(prompt).is_some() {
        return Err("只能提供一个提示词参数；复杂提示请通过 stdin 传入".to_owned());
    }
    Ok(())
}

fn validate_choice(name: &str, value: &str, choices: &[&str]) -> Result<(), String> {
    if choices.contains(&value) {
        Ok(())
    } else {
        Err(format!(
            "{name} 不支持 {value}; 可选值: {}",
            choices.join(", ")
        ))
    }
}

async fn run_exec(mut options: ExecOptions) -> Result<(), AppError> {
    options.cwd = options
        .cwd
        .canonicalize()
        .map_err(|error| AppError::invalid("工作目录不存在").context("cause", error.to_string()))?;
    if !options.cwd.is_dir() {
        return Err(AppError::invalid("工作目录不是文件夹"));
    }
    if !options.skip_git_repo_check && !inside_git_repository(&options.cwd) {
        return Err(AppError::invalid(
            "工作目录不在 Git 仓库中；确认安全后可使用 --skip-git-repo-check",
        ));
    }
    let prompt = read_prompt(options.prompt.take())?;
    if prompt.trim().is_empty() {
        return Err(AppError::invalid("提示词不能为空"));
    }

    let runtime_root = resolve_runtime_root(options.runtime_root.as_deref())?;
    let codex_binary = match RuntimePaths::new(runtime_root).codex() {
        Ok(component) => component.path,
        #[cfg(debug_assertions)]
        Err(_) => find_path_executable(if cfg!(windows) { "codex.exe" } else { "codex" })
            .ok_or_else(|| {
                AppError::new(
                    ErrorCode::RuntimeUnavailable,
                    "未找到 Codex App Server 运行时",
                )
                .context("hint", "使用 --runtime-root 或 CODEX_BIN 指定运行时")
            })?,
        #[cfg(not(debug_assertions))]
        Err(error) => {
            return Err(error.context("hint", "使用 --runtime-root 或 CODEX_BIN 指定运行时"));
        }
    };
    let (mut provider, api_key, persistent_codex_home) = load_provider(
        options.data_root.as_deref(),
        !options.ephemeral || options.use_desktop_credentials,
    )?;
    if let Some(model) = options.model.as_deref() {
        provider.model = model.to_owned();
    }
    if let Some(base_url) = first_non_empty_env(&[
        "ONPEOPLE_SUB2API_BASE_URL",
        "SUB2API_BASE_URL",
        "ONPEOPLE_BASE_URL",
    ]) {
        provider.base_url = base_url;
    }
    if provider.model.trim().is_empty() {
        provider.model = DEFAULT_MODEL.to_owned();
    }
    if provider.base_url.trim().is_empty() {
        provider.base_url = DEFAULT_BASE_URL.to_owned();
    }
    provider
        .extra
        .insert("headlessCacheAffinity".to_owned(), Value::Bool(true));
    match options.transport.as_str() {
        "websocket" => {
            provider
                .extra
                .insert("supportsWebSockets".to_owned(), Value::Bool(true));
        }
        "http" => {
            provider
                .extra
                .insert("supportsWebSockets".to_owned(), Value::Bool(false));
        }
        _ => {}
    }
    let websocket_configured = provider
        .extra
        .get("supportsWebSockets")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    options.model = Some(provider.model.clone());

    let codex_home = headless_codex_home(&persistent_codex_home, options.ephemeral);
    let client = AppServerClient::new(codex_binary);
    let mut events = client.subscribe();
    client
        .start(
            &options.cwd,
            &codex_home,
            &provider,
            Some(&api_key),
            &AgentRuntimeConfig {
                enabled: false,
                max_concurrent_threads: 1,
            },
        )
        .await?;

    let result = run_turn(&client, &mut events, &options, &prompt).await;
    client.stop().await;
    let result = result?;
    if let Some(path) = options.output_last_message.as_deref() {
        write_output_file(path, &result.final_message)?;
    }
    if options.json {
        write_json_line(&json!({
            "type": "run.completed",
            "thread_id": result.thread_id,
            "turn_id": result.turn_id,
            "final_message": result.final_message,
            "usage": result.usage,
            "transport": result.transport.as_json(&options.transport, websocket_configured),
        }))?;
    } else {
        if result.transport.degraded() {
            eprintln!(
                "onpeople: transport degraded (prewarm_failures={}, stream_retries={}, http_fallbacks={})",
                result.transport.prewarm_failures,
                result.transport.stream_retries,
                result.transport.http_fallbacks,
            );
        }
        println!("{}", result.final_message);
    }
    Ok(())
}

async fn run_turn(
    client: &std::sync::Arc<AppServerClient>,
    events: &mut tokio::sync::broadcast::Receiver<AppServerEvent>,
    options: &ExecOptions,
    prompt: &str,
) -> Result<RunResult, AppError> {
    let cwd = options.cwd.to_string_lossy();
    let thread_params = headless_thread_params(options, &cwd);
    let started = client
        .request("thread/start", thread_params, Duration::from_secs(30))
        .await?;
    let thread_id = started
        .get("thread")
        .and_then(|thread| thread.get("id"))
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::internal("App Server 未返回任务 ID"))?
        .to_owned();
    if options.json {
        write_json_line(&json!({ "type": "thread.started", "thread_id": thread_id }))?;
    }
    client
        .request(
            "thread/settings/update",
            headless_thread_settings(options, &thread_id),
            Duration::from_secs(30),
        )
        .await?;
    let mut turn_params = json!({
        "threadId": thread_id,
        "cwd": cwd,
        "input": [{ "type": "text", "text": prompt, "text_elements": [] }],
        "approvalPolicy": options.approval_policy,
        "sandboxPolicy": sandbox_policy(options, &cwd),
    });
    if options.reasoning_effort.is_some() {
        turn_params["effort"] = json!(options.reasoning_effort);
    }
    let turn = client
        .request("turn/start", turn_params, Duration::from_secs(30))
        .await?;
    let turn_id = turn
        .get("turn")
        .and_then(|turn| turn.get("id"))
        .or_else(|| turn.get("turnId"))
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::internal("App Server 未返回轮次 ID"))?
        .to_owned();
    if options.json {
        write_json_line(&json!({
            "type": "turn.started",
            "thread_id": thread_id,
            "turn_id": turn_id,
        }))?;
    }

    let wait = wait_for_completion(client, events, options, &thread_id, &turn_id);
    match tokio::time::timeout(Duration::from_secs(options.timeout_seconds), wait).await {
        Ok(Ok(result)) => Ok(result),
        Ok(Err(error))
            if matches!(error.code, ErrorCode::RuntimeTimeout | ErrorCode::Cancelled) =>
        {
            let interrupted = interrupt_turn(client, events, &thread_id, &turn_id).await;
            Err(error.context("interrupted", interrupted))
        }
        Ok(Err(error)) => Err(error),
        Err(_) => {
            let interrupted = interrupt_turn(client, events, &thread_id, &turn_id).await;
            Err(
                AppError::new(ErrorCode::RuntimeTimeout, "OnPeople 无头任务执行超时")
                    .context("timeoutKind", "hard")
                    .context("timeoutSeconds", options.timeout_seconds)
                    .context("interrupted", interrupted),
            )
        }
    }
}

async fn interrupt_turn(
    client: &std::sync::Arc<AppServerClient>,
    events: &mut tokio::sync::broadcast::Receiver<AppServerEvent>,
    thread_id: &str,
    turn_id: &str,
) -> bool {
    if client
        .request(
            "turn/interrupt",
            json!({ "threadId": thread_id, "turnId": turn_id }),
            Duration::from_secs(10),
        )
        .await
        .is_err()
    {
        return false;
    }
    let wait_for_terminal = async {
        loop {
            match events.recv().await {
                Ok(AppServerEvent::Notification(payload))
                    if is_target_turn_completed(&payload, thread_id, turn_id) =>
                {
                    return true;
                }
                Ok(AppServerEvent::Exited { .. }) | Err(_) => return false,
                Ok(_) => {}
            }
        }
    };
    tokio::time::timeout(Duration::from_secs(10), wait_for_terminal)
        .await
        .unwrap_or(false)
}

fn headless_thread_params(options: &ExecOptions, cwd: &str) -> Value {
    let mut params = json!({
        "cwd": cwd,
        "ephemeral": options.ephemeral,
        "serviceName": "onpeople-headless",
        "approvalPolicy": options.approval_policy,
        "sandbox": options.sandbox,
        "model": options.model,
        "developerInstructions": HEADLESS_DEVELOPER_INSTRUCTIONS,
    });
    if options.model.is_none() {
        params.as_object_mut().expect("object").remove("model");
    }
    params
}

fn headless_thread_settings(options: &ExecOptions, thread_id: &str) -> Value {
    json!({
        "threadId": thread_id,
        "collaborationMode": {
            "mode": "default",
            "settings": {
                "model": options.model,
                "reasoning_effort": options.reasoning_effort,
                "developer_instructions": HEADLESS_DEVELOPER_INSTRUCTIONS,
            }
        }
    })
}

async fn wait_for_completion(
    client: &std::sync::Arc<AppServerClient>,
    events: &mut tokio::sync::broadcast::Receiver<AppServerEvent>,
    options: &ExecOptions,
    thread_id: &str,
    turn_id: &str,
) -> Result<RunResult, AppError> {
    let mut final_message = String::new();
    let mut usage = None;
    let mut transport = TransportMetrics::default();
    let idle_timeout = Duration::from_secs(options.idle_timeout_seconds);
    let mut last_progress = Instant::now();
    loop {
        let idle_remaining = idle_timeout.saturating_sub(last_progress.elapsed());
        let event = tokio::select! {
            event = events.recv() => event.map_err(|error| {
                AppError::new(ErrorCode::RuntimeUnavailable, "App Server 事件流已关闭")
                    .context("cause", error.to_string())
            })?,
            () = tokio::time::sleep(idle_remaining) => {
                return Err(
                    AppError::new(ErrorCode::RuntimeTimeout, "OnPeople 无头任务长时间没有进展")
                        .context("timeoutKind", "idle")
                        .context("idleTimeoutSeconds", options.idle_timeout_seconds)
                );
            }
            signal = tokio::signal::ctrl_c() => {
                signal.map_err(AppError::storage)?;
                return Err(AppError::new(ErrorCode::Cancelled, "OnPeople 无头任务已中断"));
            }
        };
        match event {
            AppServerEvent::Notification(payload) => {
                transport.observe(&payload);
                if is_progress_notification(&payload) {
                    last_progress = Instant::now();
                }
                if options.json {
                    write_json_line(&json!({
                        "type": "app_server.notification",
                        "event": payload,
                    }))?;
                }
                if let Some(message) = completed_agent_message(&payload) {
                    final_message = message;
                }
                if let Some(updated_usage) = event_token_usage(&payload, thread_id) {
                    usage = Some(updated_usage);
                }
                if is_target_turn_completed(&payload, thread_id, turn_id) {
                    if let Some(error) = turn_error(&payload) {
                        return Err(AppError::new(ErrorCode::ProcessFailed, error));
                    }
                    return Ok(RunResult {
                        final_message,
                        thread_id: thread_id.to_owned(),
                        turn_id: turn_id.to_owned(),
                        usage,
                        transport,
                    });
                }
            }
            AppServerEvent::ServerRequest(request) => {
                last_progress = Instant::now();
                if options.json {
                    write_json_line(&json!({
                        "type": "approval.requested",
                        "request": request,
                    }))?;
                }
                let method = request.get("method").and_then(Value::as_str);
                if method == Some("item/tool/requestUserInput") {
                    return Err(AppError::new(
                        ErrorCode::ProcessFailed,
                        "无头任务请求了用户输入，无法继续",
                    ));
                }
                let request_id = request
                    .get("id")
                    .map(rpc_id_key)
                    .ok_or_else(|| AppError::internal("审批请求缺少 ID"))?;
                client
                    .resolve_server_request(&request_id, "decline")
                    .await?;
            }
            AppServerEvent::Exited { code, signal } => {
                return Err(
                    AppError::new(ErrorCode::RuntimeUnavailable, "App Server 意外退出")
                        .context(
                            "code",
                            code.map_or_else(|| "unknown".to_owned(), |value| value.to_string()),
                        )
                        .context("signal", signal.unwrap_or_default()),
                );
            }
        }
    }
}

fn is_progress_notification(payload: &Value) -> bool {
    let Some(method) = payload
        .get("method")
        .and_then(Value::as_str)
        .or_else(|| payload.get("type").and_then(Value::as_str))
    else {
        return false;
    };
    method.starts_with("item/")
        || matches!(
            method,
            "turn/started" | "turn/completed" | "turn/diff/updated" | "thread/tokenUsage/updated"
        )
}

fn sandbox_policy(options: &ExecOptions, cwd: &str) -> Value {
    match options.sandbox.as_str() {
        "danger-full-access" => json!({ "type": "dangerFullAccess" }),
        "read-only" => json!({ "type": "readOnly", "networkAccess": options.network }),
        _ => json!({
            "type": "workspaceWrite",
            "writableRoots": [cwd],
            "networkAccess": options.network,
        }),
    }
}

fn completed_agent_message(payload: &Value) -> Option<String> {
    if payload.get("method").and_then(Value::as_str) != Some("item/completed") {
        return None;
    }
    let item = payload.get("params")?.get("item")?;
    match item.get("type").and_then(Value::as_str) {
        Some("agentMessage") => item
            .get("text")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        Some("assistantMessage" | "message") => item
            .get("text")
            .or_else(|| item.get("content"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        _ => None,
    }
}

fn is_target_turn_completed(payload: &Value, thread_id: &str, turn_id: &str) -> bool {
    if payload.get("method").and_then(Value::as_str) != Some("turn/completed") {
        return false;
    }
    let params = payload.get("params").unwrap_or(payload);
    let event_thread = params
        .get("threadId")
        .and_then(Value::as_str)
        .or_else(|| params.get("thread")?.get("id")?.as_str());
    let event_turn = params
        .get("turnId")
        .and_then(Value::as_str)
        .or_else(|| params.get("turn")?.get("id")?.as_str());
    event_thread == Some(thread_id) && event_turn.is_none_or(|value| value == turn_id)
}

fn event_token_usage(payload: &Value, thread_id: &str) -> Option<Value> {
    let method = payload.get("method").and_then(Value::as_str)?;
    let params = payload.get("params").unwrap_or(payload);
    let event_thread_id = params
        .get("threadId")
        .and_then(Value::as_str)
        .or_else(|| params.get("thread")?.get("id")?.as_str());
    if event_thread_id.is_some_and(|value| value != thread_id) {
        return None;
    }
    match method {
        "thread/tokenUsage/updated" => params.get("tokenUsage").cloned(),
        "turn/completed" => params
            .get("usage")
            .or_else(|| params.get("turn")?.get("usage"))
            .cloned(),
        _ => None,
    }
}

fn turn_error(payload: &Value) -> Option<String> {
    payload
        .get("params")
        .and_then(|params| params.get("turn"))
        .and_then(|turn| turn.get("error"))
        .filter(|error| !error.is_null())
        .and_then(|error| {
            error
                .get("message")
                .and_then(Value::as_str)
                .or_else(|| error.as_str())
        })
        .map(ToOwned::to_owned)
}

fn rpc_id_key(id: &Value) -> String {
    id.as_str()
        .map_or_else(|| id.to_string(), ToOwned::to_owned)
}

fn read_prompt(prompt: Option<String>) -> Result<String, AppError> {
    if prompt.as_deref().is_some_and(|value| value != "-") {
        return Ok(prompt.unwrap_or_default());
    }
    if io::stdin().is_terminal() {
        return Err(AppError::invalid(
            "缺少提示词；请传入参数或通过 stdin 提供内容",
        ));
    }
    let mut input = String::new();
    io::stdin()
        .read_to_string(&mut input)
        .map_err(AppError::storage)?;
    Ok(input)
}

fn headless_codex_home(persistent_codex_home: &Path, ephemeral: bool) -> PathBuf {
    if ephemeral {
        persistent_codex_home.join(HEADLESS_HOME_DIRECTORY)
    } else {
        persistent_codex_home.to_path_buf()
    }
}

fn load_provider(
    data_root: Option<&Path>,
    allow_desktop_credentials: bool,
) -> Result<(ProviderSettings, String, PathBuf), AppError> {
    let root = data_root.map_or_else(stable_data_root, |path| Ok(path.to_path_buf()))?;
    let storage = Storage::open(Some(root))?;
    let mut provider = storage.provider(ProviderKind::Onpeople, None)?;
    provider.kind = ProviderKind::Onpeople;
    provider.name = "OnPeople".to_owned();
    provider.protocol = "responses".to_owned();
    let api_key = if let Some(api_key) = first_non_empty_env(&[
        "ONPEOPLE_SUB2API_KEY",
        "SUB2API_API_KEY",
        "ONPEOPLE_API_KEY",
    ]) {
        api_key
    } else if allow_desktop_credentials {
        storage
            .read_secret("cloud-api-key")?
            .or(storage.read_secret("provider-onpeople")?)
            .ok_or_else(missing_sub2api_credential)?
    } else {
        return Err(missing_sub2api_credential());
    };
    Ok((provider, api_key, storage.paths().codex_home.clone()))
}

fn missing_sub2api_credential() -> AppError {
    AppError::new(
        ErrorCode::Authentication,
        "无头临时任务需要 ONPEOPLE_SUB2API_KEY；如确需读取系统凭据，请显式添加 --use-desktop-credentials",
    )
}

fn first_non_empty_env(names: &[&str]) -> Option<String> {
    names
        .iter()
        .find_map(|name| env::var(name).ok().filter(|value| !value.trim().is_empty()))
}

fn resolve_runtime_root(explicit: Option<&Path>) -> Result<PathBuf, AppError> {
    if let Some(path) = explicit {
        return Ok(path.to_path_buf());
    }
    if let Some(path) = env::var_os("ONPEOPLE_RUNTIME_ROOT") {
        return Ok(PathBuf::from(path));
    }
    let executable = env::current_exe().map_err(AppError::storage)?;
    if executable
        .parent()
        .and_then(Path::parent)
        .is_some_and(|parent| {
            parent.file_name().and_then(|name| name.to_str()) == Some(".embedded-runtime")
        })
    {
        return Ok(executable
            .parent()
            .and_then(Path::parent)
            .expect("checked parent")
            .to_path_buf());
    }
    Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../.embedded-runtime"))
}

#[cfg(debug_assertions)]
fn find_path_executable(name: &str) -> Option<PathBuf> {
    env::var_os("PATH")
        .into_iter()
        .flat_map(|paths| env::split_paths(&paths).collect::<Vec<_>>())
        .map(|directory| directory.join(name))
        .find(|candidate| candidate.is_file())
        .and_then(|candidate| candidate.canonicalize().ok())
}

fn inside_git_repository(cwd: &Path) -> bool {
    cwd.ancestors()
        .any(|directory| directory.join(".git").exists())
}

fn write_output_file(path: &Path, value: &str) -> Result<(), AppError> {
    if let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        fs::create_dir_all(parent).map_err(AppError::storage)?;
    }
    fs::write(path, value).map_err(AppError::storage)
}

fn write_json_line(value: &Value) -> Result<(), AppError> {
    let mut stdout = io::stdout().lock();
    serde_json::to_writer(&mut stdout, value).map_err(AppError::internal)?;
    stdout.write_all(b"\n").map_err(AppError::storage)?;
    stdout.flush().map_err(AppError::storage)
}

fn emit_error(error: &AppError) {
    eprintln!("onpeople: {}", error.message);
}

fn emit_run_error(error: &AppError, json: bool) {
    if json {
        let _ = write_json_line(&json!({
            "type": "run.failed",
            "error": error,
        }));
    }
    emit_error(error);
}

fn usage() -> &'static str {
    r"OnPeople headless coding agent

Usage:
  onpeople exec [OPTIONS] [PROMPT]
  onpeople exec [OPTIONS] - < prompt.md

Options:
  -C, --cwd PATH                  Working directory (default: current directory)
  -m, --model MODEL              Override the configured OnPeople model
      --reasoning-effort LEVEL    Override reasoning effort
      --transport MODE            auto, websocket, or http (default: auto)
      --sandbox MODE              read-only, workspace-write, or danger-full-access
      --approval-policy POLICY    never, untrusted, or on-request (default: never)
      --network                   Allow network access inside the sandbox
      --json                      Stream machine-readable JSON Lines to stdout
      --ephemeral                 Do not persist the thread; reuse an isolated cache-stable home
  -o, --output-last-message PATH  Write the final agent message to a file
      --timeout SECONDS           Overall turn timeout (default: 3600)
      --idle-timeout SECONDS      No-progress timeout (default: 900)
      --runtime-root PATH         Override the bundled runtime directory
      --data-root PATH            Override the OnPeople desktop data directory
      --use-desktop-credentials   Read the desktop Keychain/Credential Manager entry
      --skip-git-repo-check       Permit execution outside a Git repository
  -h, --help                      Show this help
  -V, --version                   Show the version

Environment:
  ONPEOPLE_SUB2API_KEY      OnPeople Sub2API key (preferred)
  ONPEOPLE_SUB2API_BASE_URL OnPeople Sub2API Responses API base URL
  SUB2API_API_KEY, SUB2API_BASE_URL, ONPEOPLE_API_KEY, ONPEOPLE_BASE_URL
  ONPEOPLE_RUNTIME_ROOT, CODEX_BIN
"
}

#[cfg(test)]
mod tests {
    use super::{
        Command, TransportMetrics, completed_agent_message, event_token_usage, headless_codex_home,
        headless_thread_params, headless_thread_settings, is_progress_notification,
        is_target_turn_completed, parse_command, turn_error,
    };
    use serde_json::json;

    #[test]
    fn parses_safe_exec_defaults_and_automation_flags() {
        let command = parse_command([
            "exec".to_owned(),
            "--sandbox".to_owned(),
            "workspace-write".to_owned(),
            "--json".to_owned(),
            "--ephemeral".to_owned(),
            "-C".to_owned(),
            "/tmp/project".to_owned(),
            "-".to_owned(),
        ])
        .expect("parse command");
        let Command::Exec(options) = command else {
            panic!("expected exec");
        };
        assert_eq!(options.sandbox, "workspace-write");
        assert_eq!(options.approval_policy, "never");
        assert!(options.json);
        assert!(options.ephemeral);
        assert_eq!(options.transport, "auto");
        assert_eq!(options.idle_timeout_seconds, 900);
        assert_eq!(options.prompt.as_deref(), Some("-"));
    }

    #[test]
    fn rejects_unsafe_unknown_policy_values() {
        let error = parse_command([
            "exec".to_owned(),
            "--sandbox".to_owned(),
            "everything".to_owned(),
            "task".to_owned(),
        ])
        .expect_err("invalid sandbox");
        assert!(error.contains("--sandbox"));
    }

    #[test]
    fn parses_explicit_http_transport_and_rejects_unknown_modes() {
        let command = parse_command([
            "exec".to_owned(),
            "--transport".to_owned(),
            "http".to_owned(),
            "task".to_owned(),
        ])
        .expect("valid transport");
        let Command::Exec(options) = command else {
            panic!("expected exec");
        };
        assert_eq!(options.transport, "http");

        let error = parse_command([
            "exec".to_owned(),
            "--transport".to_owned(),
            "udp".to_owned(),
            "task".to_owned(),
        ])
        .expect_err("invalid transport");
        assert!(error.contains("--transport"));
    }

    #[test]
    fn counts_transport_degradation_signals_once_per_server_log() {
        let mut metrics = TransportMetrics::default();
        for text in [
            "startup websocket prewarm setup failed: disconnected",
            "stream disconnected - retrying sampling request (1/5)",
            "falling back to HTTP",
            "previous_response_not_found",
        ] {
            metrics.observe(&json!({ "type": "server-log", "text": text }));
        }
        metrics.observe(&json!({
            "method": "warning",
            "params": { "message": "Falling back from WebSockets" }
        }));

        assert_eq!(metrics.prewarm_failures, 1);
        assert_eq!(metrics.stream_retries, 1);
        assert_eq!(metrics.http_fallbacks, 1);
        assert_eq!(metrics.previous_response_not_found, 1);
        assert!(metrics.degraded());
    }

    #[test]
    fn extracts_final_message_and_matching_completion() {
        let item = json!({
            "method": "item/completed",
            "params": { "item": { "type": "agentMessage", "text": "done" } }
        });
        assert_eq!(completed_agent_message(&item).as_deref(), Some("done"));
        let completed = json!({
            "method": "turn/completed",
            "params": {
                "threadId": "thread-1",
                "turn": { "id": "turn-1", "error": null }
            }
        });
        assert!(is_target_turn_completed(&completed, "thread-1", "turn-1"));
        assert!(turn_error(&completed).is_none());
    }

    #[test]
    fn reports_turn_errors() {
        let completed = json!({
            "method": "turn/completed",
            "params": {
                "threadId": "thread-1",
                "turn": { "id": "turn-1", "error": { "message": "model failed" } }
            }
        });
        assert_eq!(turn_error(&completed).as_deref(), Some("model failed"));
    }

    #[test]
    fn extracts_only_matching_token_usage() {
        let usage = json!({
            "method": "thread/tokenUsage/updated",
            "params": {
                "threadId": "thread-1",
                "tokenUsage": {
                    "total": {
                        "inputTokens": 100,
                        "cachedInputTokens": 40,
                        "outputTokens": 20,
                        "reasoningOutputTokens": 5
                    }
                }
            }
        });
        assert_eq!(
            event_token_usage(&usage, "thread-1")
                .and_then(|value| value.get("total").cloned())
                .and_then(|value| value.get("inputTokens").cloned()),
            Some(json!(100))
        );
        assert!(event_token_usage(&usage, "thread-2").is_none());
    }

    #[test]
    fn injects_headless_contract_and_convergence_instructions() {
        let Command::Exec(options) = parse_command([
            "exec".to_owned(),
            "--ephemeral".to_owned(),
            "--model".to_owned(),
            "gpt-test".to_owned(),
            "task".to_owned(),
        ])
        .expect("expected valid command") else {
            panic!("expected exec");
        };
        let start = headless_thread_params(&options, "/tmp/workspace");
        let settings = headless_thread_settings(&options, "thread-1");
        let start_instructions = start["developerInstructions"]
            .as_str()
            .expect("thread instructions");
        let mode_instructions = settings["collaborationMode"]["settings"]["developer_instructions"]
            .as_str()
            .expect("mode instructions");
        assert_eq!(start_instructions, mode_instructions);
        assert!(start_instructions.contains("accented Unicode"));
        assert!(start_instructions.contains("stop and provide the final result immediately"));
        assert_eq!(start["model"], "gpt-test");
    }

    #[test]
    fn uses_a_stable_isolated_home_for_ephemeral_threads() {
        let desktop_home = std::path::Path::new("/data/codex-home");
        assert_eq!(
            headless_codex_home(desktop_home, true),
            desktop_home.join("headless-v1")
        );
        assert_eq!(headless_codex_home(desktop_home, false), desktop_home);
    }

    #[test]
    fn distinguishes_progress_from_background_notifications() {
        assert!(is_progress_notification(&json!({
            "method": "item/agentMessage/delta"
        })));
        assert!(is_progress_notification(&json!({
            "method": "thread/tokenUsage/updated"
        })));
        assert!(!is_progress_notification(&json!({
            "method": "account/rateLimits/updated"
        })));
        assert!(!is_progress_notification(&json!({
            "method": "remoteControl/status/changed"
        })));
    }
}
