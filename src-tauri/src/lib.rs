use std::{
    fs::OpenOptions,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        Arc, Mutex as StdMutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};

mod native_compositor;

use base64::Engine;
use onpeople_browser_host::{
    BrowserCommand, BrowserHostEvent, BrowserHostState, BrowserIpcClient, IpcConfig,
};
use onpeople_core_runtime::CoreRuntime;
use onpeople_storage::{Storage, stable_data_root};
use onpeople_types::{
    AgentStatus, AppError, AppUpdateState, BrowserAnnotation, BrowserBoundsRequest, BrowserFrame,
    BrowserState, GitCommitRequest, GitDiff, GitFileRequest, GitMutationRequest, GitPushRequest,
    GitRequest, GitState, Goal, GoalRequest, GoalUpdateRequest, LiveStatus, PreferencePatchRequest,
    Preferences, PromptSubmission, ProviderRequest, ProviderSettings, RuntimeDiagnostics,
    RuntimeSnapshot, ScheduledTask, SchedulerSnapshot, SendPromptRequest, StreamEnvelope,
    StreamKind, TerminalIdRequest, TerminalResizeRequest, TerminalSession, TerminalStartRequest,
    TerminalWriteRequest, ThreadFilters, ThreadList, WorktreeRequest,
};
use serde_json::{Value, json};
use sha2::Digest;
use tauri::{
    AppHandle, Emitter, Manager, Runtime, State, WebviewUrl, WebviewWindowBuilder, ipc::Channel,
};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    tray::TrayIconBuilder,
};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_updater::UpdaterExt;
use tokio::sync::{Mutex, Notify, broadcast};
use uuid::Uuid;

fn repair_macos_webview_layout<R: Runtime>(
    window: &tauri::WebviewWindow<R>,
) -> Result<(), AppError> {
    #[cfg(not(target_os = "macos"))]
    let _ = window;
    #[cfg(target_os = "macos")]
    {
        // Wry installs WKWebView after the NSWindow has been created. When a
        // Tauri app is launched while another app owns the foreground, AppKit
        // can leave that view hidden even though the document has mounted.
        // Re-assert the view state after creation and after activation.
        window
            .with_webview(|webview| unsafe {
                use objc2_app_kit::{NSView, NSWindow};

                let view = &*webview.inner().cast::<NSView>();
                view.setHidden(false);
                view.setAlphaValue(1.0);
                view.setNeedsLayout(true);
                view.setNeedsDisplay(true);

                let native_window = &*webview.ns_window().cast::<NSWindow>();
                if let Some(content_view) = native_window.contentView() {
                    let bounds = content_view.bounds();
                    if view.frame().size.width <= 0.0 || view.frame().size.height <= 0.0 {
                        view.setFrame(bounds);
                    }
                }
            })
            .map_err(AppError::internal)?;
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn begin_macos_microphone_request(
    media_type: &objc2_av_foundation::AVMediaType,
) -> tokio::sync::oneshot::Receiver<bool> {
    use block2::RcBlock;
    use objc2::runtime::Bool;
    use objc2_av_foundation::AVCaptureDevice;

    let (sender, receiver) = tokio::sync::oneshot::channel::<bool>();
    let sender = StdMutex::new(Some(sender));
    let completion = RcBlock::new(move |granted: Bool| {
        if let Ok(mut sender) = sender.lock()
            && let Some(sender) = sender.take()
        {
            let _ = sender.send(granted.as_bool());
        }
    });
    unsafe {
        AVCaptureDevice::requestAccessForMediaType_completionHandler(media_type, &completion);
    }
    receiver
}

#[cfg(target_os = "macos")]
async fn request_macos_microphone_access() -> Result<Value, AppError> {
    use objc2_av_foundation::{AVAuthorizationStatus, AVCaptureDevice, AVMediaTypeAudio};

    let media_type = unsafe { AVMediaTypeAudio }
        .ok_or_else(|| AppError::internal("AVFoundation did not expose the audio media type"))?;
    let status = unsafe { AVCaptureDevice::authorizationStatusForMediaType(media_type) };
    match status {
        AVAuthorizationStatus::Authorized => {
            return Ok(json!({ "granted": true, "status": "authorized" }));
        }
        AVAuthorizationStatus::Denied => {
            return Ok(json!({ "granted": false, "status": "denied" }));
        }
        AVAuthorizationStatus::Restricted => {
            return Ok(json!({ "granted": false, "status": "restricted" }));
        }
        AVAuthorizationStatus::NotDetermined => {}
        _ => {
            return Ok(json!({ "granted": false, "status": "unknown" }));
        }
    }

    let receiver = begin_macos_microphone_request(media_type);
    match tokio::time::timeout(Duration::from_secs(120), receiver).await {
        Ok(Ok(true)) => Ok(json!({ "granted": true, "status": "authorized" })),
        Ok(Ok(false)) => Ok(json!({ "granted": false, "status": "denied" })),
        Ok(Err(_)) => Err(AppError::internal(
            "macOS microphone permission callback was cancelled",
        )),
        Err(_) => Ok(json!({ "granted": false, "status": "timeout" })),
    }
}

#[tauri::command]
async fn request_microphone_access() -> Result<Value, AppError> {
    #[cfg(target_os = "macos")]
    {
        request_macos_microphone_access().await
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(json!({ "granted": true, "status": "webview" }))
    }
}

#[cfg(target_os = "macos")]
fn activate_isolated_preview_window<R: Runtime>(
    window: &tauri::WebviewWindow<R>,
) -> Result<(), AppError> {
    let native_window = window.ns_window().map_err(AppError::internal)?;
    let Some(main_thread) = objc2::MainThreadMarker::new() else {
        return Err(AppError::internal(
            "isolated preview activation must run on the AppKit main thread",
        ));
    };
    unsafe {
        use objc2_app_kit::{
            NSApplication, NSApplicationActivationOptions, NSRunningApplication, NSView, NSWindow,
            NSWindowCollectionBehavior,
        };

        let native_window = &*native_window.cast::<NSWindow>();
        // A window can be on-screen while the app is still inactive. In that
        // state WKWebView keeps document.visibilityState=hidden and Wry can
        // return a white native surface even though React has mounted.
        let application = NSRunningApplication::currentApplication();
        #[allow(deprecated)]
        let _ = application.activateWithOptions(
            NSApplicationActivationOptions::ActivateAllWindows
                | NSApplicationActivationOptions::ActivateIgnoringOtherApps,
        );
        native_window.setCollectionBehavior(
            NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::FullScreenAuxiliary,
        );
        native_window.makeKeyAndOrderFront(None);
        native_window.orderFrontRegardless();
        if let Ok(native_view) = window.ns_view()
            && let Some(native_view) = native_view.cast::<NSView>().as_ref()
        {
            native_view.setHidden(false);
            native_view.setAlphaValue(1.0);
            native_view.setNeedsDisplay(true);
        }
        #[allow(deprecated)]
        NSApplication::sharedApplication(main_thread).activateIgnoringOtherApps(true);
    }
    Ok(())
}

fn activate_main_window<R: Runtime>(app: &AppHandle<R>) -> Result<(), AppError> {
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };
    activate_isolated_preview_window(&window)?;
    let _ = window.show();
    repair_macos_webview_layout(&window)?;
    let _ = window.set_focus();
    Ok(())
}

fn schedule_main_window_activation<R: Runtime + 'static>(app: AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        for delay in [0_u64, 80, 240, 720] {
            if delay > 0 {
                tokio::time::sleep(Duration::from_millis(delay)).await;
            }
            let handle = app.clone();
            let callback_handle = handle.clone();
            let _ = handle.run_on_main_thread(move || {
                let _ = activate_main_window(&callback_handle);
            });
        }
    });
}

#[cfg(not(target_os = "macos"))]
fn activate_isolated_preview_window<R: Runtime>(
    _window: &tauri::WebviewWindow<R>,
) -> Result<(), AppError> {
    Ok(())
}

static SHUTDOWN_STARTED: AtomicBool = AtomicBool::new(false);

pub struct FrontendServer {
    base_url: url::Url,
    shutdown: Arc<AtomicBool>,
}

impl FrontendServer {
    fn start<R: Runtime>(app: AppHandle<R>) -> Result<Self, AppError> {
        let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(AppError::internal)?;
        listener.set_nonblocking(true).map_err(AppError::internal)?;
        let address = listener.local_addr().map_err(AppError::internal)?;
        let route_prefix = "/".to_owned();
        let base_url =
            url::Url::parse(&format!("http://{address}/")).map_err(AppError::internal)?;
        append_frontend_test_log(&format!("listen {base_url}"));
        let shutdown = Arc::new(AtomicBool::new(false));
        let thread_shutdown = shutdown.clone();
        std::thread::Builder::new()
            .name("onpeople-frontend".into())
            .spawn(move || {
                while !thread_shutdown.load(Ordering::Acquire) {
                    match listener.accept() {
                        Ok((stream, _)) => {
                            let request_app = app.clone();
                            let request_prefix = route_prefix.clone();
                            let _ = std::thread::Builder::new()
                                .name("onpeople-frontend-request".into())
                                .spawn(move || {
                                    serve_frontend_request(&request_app, stream, &request_prefix)
                                });
                        }
                        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                            std::thread::sleep(Duration::from_millis(8));
                        }
                        Err(error) => {
                            eprintln!("OnPeople frontend listener failed: {error}");
                            break;
                        }
                    }
                }
            })
            .map_err(AppError::internal)?;
        Ok(Self { base_url, shutdown })
    }

    fn page_url(&self, query: Option<&str>) -> url::Url {
        let mut url = self
            .base_url
            .join("index.html")
            .expect("frontend base URL is valid");
        url.set_query(query);
        url
    }
}

fn append_frontend_test_log(message: &str) {
    let Some(root) = std::env::var_os("ONPEOPLE_TEST_USER_DATA") else {
        return;
    };
    let path = PathBuf::from(root).join("frontend-access.log");
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{message}");
    }
}

impl Drop for FrontendServer {
    fn drop(&mut self) {
        self.shutdown.store(true, Ordering::Release);
    }
}

fn serve_frontend_request<R: Runtime>(
    app: &AppHandle<R>,
    mut stream: TcpStream,
    route_prefix: &str,
) {
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(30)));
    let mut request = [0_u8; 16 * 1024];
    let Ok(size) = stream.read(&mut request) else {
        return;
    };
    let request = String::from_utf8_lossy(&request[..size]);
    let Some(first_line) = request.lines().next() else {
        return;
    };
    let mut parts = first_line.split_whitespace();
    let method = parts.next().unwrap_or_default();
    let request_path = parts.next().unwrap_or_default();
    append_frontend_test_log(&format!("request {method} {request_path}"));
    if method != "GET" && method != "HEAD" {
        write_frontend_response(&mut stream, 405, "text/plain; charset=utf-8", None, b"");
        return;
    }
    let request_path = request_path.split(['?', '#']).next().unwrap_or_default();
    let Some(asset_path) = request_path.strip_prefix(route_prefix) else {
        write_frontend_response(&mut stream, 404, "text/plain; charset=utf-8", None, b"");
        return;
    };
    let asset_path = if asset_path.is_empty() {
        "index.html"
    } else {
        asset_path
    };
    if asset_path.contains("..") || asset_path.contains('\\') {
        write_frontend_response(&mut stream, 400, "text/plain; charset=utf-8", None, b"");
        return;
    }
    match app
        .asset_resolver()
        .get_for_scheme(asset_path.to_owned(), false)
    {
        Some(asset) => {
            append_frontend_test_log(&format!("response 200 {asset_path}"));
            write_frontend_response(
                &mut stream,
                200,
                &asset.mime_type,
                asset.csp_header.as_deref(),
                if method == "HEAD" { b"" } else { &asset.bytes },
            );
        }
        None => {
            append_frontend_test_log(&format!("response 404 {asset_path}"));
            write_frontend_response(
                &mut stream,
                404,
                "text/plain; charset=utf-8",
                None,
                b"embedded asset not found",
            );
        }
    }
}

fn write_frontend_response(
    stream: &mut TcpStream,
    status: u16,
    content_type: &str,
    csp: Option<&str>,
    body: &[u8],
) {
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        404 => "Not Found",
        405 => "Method Not Allowed",
        _ => "Error",
    };
    let mut headers = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n",
        body.len()
    );
    if let Some(csp) = csp {
        headers.push_str("Content-Security-Policy: ");
        headers.push_str(csp);
        headers.push_str("\r\n");
    }
    headers.push_str("\r\n");
    let _ = stream.write_all(headers.as_bytes());
    let _ = stream.write_all(body);
    let _ = stream.flush();
}

struct PendingUpdate {
    version: String,
    bytes: Vec<u8>,
}

fn initial_app_update_state() -> AppUpdateState {
    AppUpdateState {
        supported: cfg!(any(target_os = "macos", target_os = "windows")),
        status: "idle".to_owned(),
        current_version: env!("CARGO_PKG_VERSION").to_owned(),
        available_version: None,
        progress: None,
        message: None,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BrowserHostPhase {
    Stopped,
    Starting,
    Ready,
    Backoff,
    Failed,
    Crashed,
}

struct BrowserLifecycle {
    phase: Mutex<BrowserHostPhase>,
    notify: Notify,
    monitor_started: AtomicBool,
    backoff_attempt: AtomicU64,
    error: StdMutex<Option<String>>,
    error_kind: StdMutex<Option<String>>,
}

impl BrowserLifecycle {
    fn new() -> Self {
        Self {
            phase: Mutex::new(BrowserHostPhase::Stopped),
            notify: Notify::new(),
            monitor_started: AtomicBool::new(false),
            backoff_attempt: AtomicU64::new(0),
            error: StdMutex::new(None),
            error_kind: StdMutex::new(None),
        }
    }
}

fn browser_error_kind(error: &AppError) -> &'static str {
    match error.code {
        onpeople_types::ErrorCode::BrowserProtocol => "protocol-mismatch",
        onpeople_types::ErrorCode::ProcessFailed => "host-exit",
        onpeople_types::ErrorCode::PermissionDenied => "host-untrusted",
        onpeople_types::ErrorCode::Keychain => "keychain-authorization",
        onpeople_types::ErrorCode::Internal if error.message.contains("CEF") => "cef-init-failed",
        _ => "startup-failed",
    }
}

#[cfg(all(target_os = "macos", not(debug_assertions)))]
fn validate_release_browser_host(executable: &std::path::Path) -> Result<(), AppError> {
    const TEAM_ID: &str = "6K4S66PVRQ";
    const HOST_BUNDLE_ID: &str = "com.userinner.onpeople.browser-host";

    let current_exe = std::env::current_exe().map_err(AppError::storage)?;
    let app = current_exe
        .parent()
        .and_then(std::path::Path::parent)
        .and_then(std::path::Path::parent)
        .ok_or_else(|| {
            AppError::new(
                onpeople_types::ErrorCode::PermissionDenied,
                "当前 OnPeople.app 路径无效",
            )
        })?
        .canonicalize()
        .map_err(AppError::storage)?;
    let expected_root = app
        .join("Contents/Resources/.embedded-runtime")
        .canonicalize()
        .map_err(|error| {
            AppError::new(
                onpeople_types::ErrorCode::PermissionDenied,
                "当前 OnPeople.app 的内嵌运行时路径无效",
            )
            .context("cause", error)
        })?;
    let executable = executable.canonicalize().map_err(AppError::storage)?;
    if !executable.starts_with(&expected_root) {
        return Err(AppError::new(
            onpeople_types::ErrorCode::PermissionDenied,
            "Browser Host 路径不可信：必须来自当前 OnPeople.app",
        )
        .context("path", executable.to_string_lossy()));
    }
    let host_app = executable
        .parent()
        .and_then(std::path::Path::parent)
        .and_then(std::path::Path::parent)
        .ok_or_else(|| {
            AppError::new(
                onpeople_types::ErrorCode::PermissionDenied,
                "Browser Host.app 路径无效",
            )
        })?;

    let signature_details = |path: &std::path::Path| -> Result<String, AppError> {
        let output = Command::new("/usr/bin/codesign")
            .args(["-dv", "--verbose=4"])
            .arg(path)
            .output()
            .map_err(AppError::storage)?;
        let details = String::from_utf8_lossy(&output.stderr).into_owned();
        if !output.status.success()
            || details.contains("Signature=adhoc")
            || details.contains("Info.plist=not bound")
            || !details.contains(&format!("TeamIdentifier={TEAM_ID}"))
        {
            return Err(AppError::new(
                onpeople_types::ErrorCode::PermissionDenied,
                "Browser Host 代码签名身份不满足正式 Profile 要求",
            )
            .context("path", path.to_string_lossy()));
        }
        Ok(details)
    };
    signature_details(&app)?;
    signature_details(host_app)?;

    let status = Command::new("/usr/bin/codesign")
        .args(["--verify", "--deep", "--strict", "--verbose=2"])
        .arg(host_app)
        .status()
        .map_err(AppError::storage)?;
    if !status.success() {
        return Err(AppError::new(
            onpeople_types::ErrorCode::PermissionDenied,
            "Browser Host 严格签名验证失败",
        ));
    }
    let plist = host_app.join("Contents/Info.plist");
    let output = Command::new("/usr/libexec/PlistBuddy")
        .args(["-c", "Print :CFBundleIdentifier"])
        .arg(plist)
        .output()
        .map_err(AppError::storage)?;
    if !output.status.success() || String::from_utf8_lossy(&output.stdout).trim() != HOST_BUNDLE_ID
    {
        return Err(AppError::new(
            onpeople_types::ErrorCode::PermissionDenied,
            "Browser Host Bundle ID 不匹配",
        ));
    }
    Ok(())
}

#[cfg(any(not(target_os = "macos"), debug_assertions))]
fn validate_release_browser_host(_executable: &std::path::Path) -> Result<(), AppError> {
    Ok(())
}

#[derive(Clone)]
pub struct AppState {
    pub runtime: Arc<CoreRuntime>,
    pub browser: Arc<BrowserHostState>,
    browser_process: Arc<StdMutex<Option<Child>>>,
    browser_ipc: BrowserIpcClient,
    browser_lifecycle: Arc<BrowserLifecycle>,
    remote_browser_state: Arc<StdMutex<Option<BrowserState>>>,
    pub data_root: PathBuf,
    runtime_root: PathBuf,
    stream_sequence: Arc<AtomicU64>,
    pending_update: Arc<Mutex<Option<PendingUpdate>>>,
    app_update_state: Arc<StdMutex<AppUpdateState>>,
    browser_shutdown: Arc<AtomicBool>,
    pending_deep_links: Arc<StdMutex<Vec<String>>>,
    deep_link_frontend_ready: Arc<AtomicBool>,
}

impl AppState {
    pub fn initialize(bundled_runtime_root: Option<PathBuf>) -> Result<Self, AppError> {
        let data_root = stable_data_root()?;
        let storage = Storage::open(Some(data_root.clone()))?;
        #[cfg(debug_assertions)]
        let runtime_root = std::env::var_os("ONPEOPLE_RUNTIME_ROOT")
            .map(PathBuf::from)
            .or(bundled_runtime_root)
            .unwrap_or_else(|| {
                PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.embedded-runtime")
            });
        #[cfg(not(debug_assertions))]
        let runtime_root = bundled_runtime_root.ok_or_else(|| {
            AppError::new(
                onpeople_types::ErrorCode::RuntimeUnavailable,
                "正式构建无法定位当前 OnPeople.app 内嵌运行时",
            )
        })?;
        let browser_ipc =
            BrowserIpcClient::new(IpcConfig::for_profile(&storage.paths().cef_profile));
        let runtime = Arc::new(CoreRuntime::new(storage.clone(), runtime_root.clone())?);
        install_bundled_plugins(&runtime, &runtime_root)?;
        #[cfg(unix)]
        let browser_mcp_socket = browser_ipc.config().address.unix_socket.clone();
        #[cfg(windows)]
        let browser_mcp_socket = PathBuf::from(&browser_ipc.config().address.windows_pipe);
        runtime.configure_builtin_browser_mcp(
            browser_mcp_socket,
            browser_ipc.config().token.clone(),
        )?;
        let browser = Arc::new(BrowserHostState::with_storage(
            storage.paths().cef_profile.clone(),
            storage.clone(),
        ));
        Ok(Self {
            runtime,
            browser,
            browser_process: Arc::new(StdMutex::new(None)),
            browser_ipc,
            browser_lifecycle: Arc::new(BrowserLifecycle::new()),
            remote_browser_state: Arc::new(StdMutex::new(None)),
            data_root,
            runtime_root,
            stream_sequence: Arc::new(AtomicU64::new(1)),
            pending_update: Arc::new(Mutex::new(None)),
            app_update_state: Arc::new(StdMutex::new(initial_app_update_state())),
            browser_shutdown: Arc::new(AtomicBool::new(false)),
            pending_deep_links: Arc::new(StdMutex::new(Vec::new())),
            deep_link_frontend_ready: Arc::new(AtomicBool::new(false)),
        })
    }

    fn queue_deep_links(&self, urls: impl IntoIterator<Item = String>) {
        let mut pending = self
            .pending_deep_links
            .lock()
            .expect("pending deep links mutex");
        for url in urls {
            if url.starts_with("onpeople://") && !pending.contains(&url) {
                pending.push(url);
            }
        }
        if pending.len() > 32 {
            let overflow = pending.len() - 32;
            pending.drain(..overflow);
        }
    }

    fn dispatch_deep_links<R: Runtime>(&self, app: &AppHandle<R>, urls: Vec<String>) {
        if urls.is_empty() {
            return;
        }
        if self.deep_link_frontend_ready.load(Ordering::Acquire) {
            let _ = app.emit("app:deep-link", json!({ "urls": urls }));
        } else {
            self.queue_deep_links(urls);
        }
    }

    fn activate_deep_links(&self) -> Vec<String> {
        self.deep_link_frontend_ready.store(true, Ordering::Release);
        std::mem::take(
            &mut *self
                .pending_deep_links
                .lock()
                .expect("pending deep links mutex"),
        )
    }

    fn update_state(&self) -> AppUpdateState {
        self.app_update_state
            .lock()
            .expect("app update state mutex")
            .clone()
    }

    fn publish_update_state<R: Runtime>(&self, app: &AppHandle<R>, state: AppUpdateState) {
        *self
            .app_update_state
            .lock()
            .expect("app update state mutex") = state.clone();
        let _ = app.emit("app-update:state", state);
    }

    pub async fn stop(&self) {
        self.browser_shutdown.store(true, Ordering::Release);
        *self.browser_lifecycle.phase.lock().await = BrowserHostPhase::Stopped;
        self.browser_lifecycle.notify.notify_waiters();
        if let Some(mut process) = self
            .browser_process
            .lock()
            .expect("browser process mutex")
            .take()
        {
            let _ = process.kill();
            let _ = process.wait();
        }
        self.runtime.stop().await;
    }

    fn spawn_browser_host(&self) -> Result<(), AppError> {
        let mut process_guard = self
            .browser_process
            .lock()
            .map_err(|_| AppError::internal("浏览器进程锁定失败"))?;
        if process_guard.is_some() {
            return Ok(());
        }
        self.browser_shutdown.store(false, Ordering::Release);
        let component = onpeople_integrations::RuntimePaths::new(self.runtime_root.clone())
            .browser_host()
            .map_err(|error| {
                AppError::new(
                    onpeople_types::ErrorCode::BrowserUnavailable,
                    "未找到 CEF 浏览器宿主",
                )
                .context("cause", error.message)
            })?;
        let executable = component.path;
        validate_release_browser_host(&executable)?;
        let profile = self.data_root.join("cef-profile");
        std::fs::create_dir_all(&profile).map_err(AppError::storage)?;
        let mut command = Command::new(executable);
        command
            .env("ONPEOPLE_CEF_PROFILE", profile)
            .env(
                "ONPEOPLE_WORKSPACE_ROOT",
                self.runtime.default_cwd().to_string_lossy().into_owned(),
            )
            .env(
                "ONPEOPLE_BROWSER_IPC_TOKEN",
                self.browser_ipc.config().token.clone(),
            )
            .env(
                "ONPEOPLE_BROWSER_IPC_PROTOCOL",
                self.browser_ipc.config().protocol_version.to_string(),
            )
            .env(
                "ONPEOPLE_BROWSER_IPC_SOCKET",
                self.browser_ipc
                    .config()
                    .address
                    .unix_socket
                    .to_string_lossy()
                    .into_owned(),
            )
            .env(
                "ONPEOPLE_BROWSER_IPC_PIPE",
                self.browser_ipc.config().address.windows_pipe.clone(),
            );
        #[cfg(debug_assertions)]
        command.env("ONPEOPLE_CEF_NO_SANDBOX", "1");
        if let Some(directory) = self.runtime.preferences()?.download_directory {
            command.env("ONPEOPLE_DOWNLOAD_DIR", directory);
        }
        let process = command.spawn().map_err(|error| {
            AppError::new(
                onpeople_types::ErrorCode::BrowserUnavailable,
                "无法启动 CEF 浏览器宿主",
            )
            .context("cause", error)
        })?;
        *process_guard = Some(process);
        drop(process_guard);
        self.start_browser_monitor();
        Ok(())
    }

    fn lifecycle_snapshot(&self) -> (String, Option<String>, Option<String>, bool) {
        let phase = self
            .browser_lifecycle
            .phase
            .try_lock()
            .map(|phase| *phase)
            .unwrap_or(BrowserHostPhase::Starting);
        let status = match phase {
            BrowserHostPhase::Stopped => "stopped",
            BrowserHostPhase::Starting => "starting",
            BrowserHostPhase::Ready => "ready",
            BrowserHostPhase::Backoff => "backoff",
            BrowserHostPhase::Failed => "failed",
            BrowserHostPhase::Crashed => "crashed",
        }
        .to_owned();
        let error = self
            .browser_lifecycle
            .error
            .lock()
            .ok()
            .and_then(|error| error.clone());
        let error_kind = self
            .browser_lifecycle
            .error_kind
            .lock()
            .ok()
            .and_then(|kind| kind.clone());
        (status, error, error_kind, phase == BrowserHostPhase::Ready)
    }

    fn current_browser_state(&self) -> BrowserState {
        let base = self
            .remote_browser_state
            .lock()
            .ok()
            .and_then(|state| state.clone())
            .unwrap_or_else(|| self.browser.state());
        let (status, host_error, host_error_kind, ready) = self.lifecycle_snapshot();
        BrowserState {
            host_ready: ready && base.host_ready,
            host_status: status,
            host_error,
            host_error_kind,
            ..base
        }
    }

    fn cache_remote_browser_state(&self, state: BrowserState) -> BrowserState {
        if let Ok(mut cached) = self.remote_browser_state.lock() {
            *cached = Some(state.clone());
        }
        self.current_browser_state()
    }

    fn publish_browser_state(&self) {
        self.browser.publish_state(self.current_browser_state());
    }

    async fn wait_for_browser_ready(&self) -> Result<(), AppError> {
        let deadline = Instant::now() + Duration::from_secs(5);
        let ping = BrowserIpcClient::with_timeout(
            self.browser_ipc.config().clone(),
            Duration::from_millis(250),
        );
        let mut delay = Duration::from_millis(20);
        loop {
            if let Some(message) = self.browser_process_exit_message()? {
                return Err(AppError::new(
                    onpeople_types::ErrorCode::ProcessFailed,
                    "CEF 浏览器宿主在启动期间退出",
                )
                .context("cause", message));
            }
            match ping.request(BrowserCommand::Ping).await {
                Ok(value) if value.get("ready").and_then(Value::as_bool) == Some(true) => {
                    return Ok(());
                }
                Ok(_) => {}
                Err(error)
                    if matches!(
                        error.code,
                        onpeople_types::ErrorCode::BrowserUnavailable
                            | onpeople_types::ErrorCode::RuntimeTimeout
                    ) => {}
                Err(error) => return Err(error),
            }
            if Instant::now() >= deadline {
                return Err(AppError::new(
                    onpeople_types::ErrorCode::BrowserUnavailable,
                    "CEF 浏览器宿主启动超时",
                )
                .retryable(true));
            }
            tokio::time::sleep(delay).await;
            delay = (delay * 2).min(Duration::from_millis(200));
        }
    }

    fn browser_process_exit_message(&self) -> Result<Option<String>, AppError> {
        let mut guard = self
            .browser_process
            .lock()
            .map_err(|_| AppError::internal("浏览器进程锁定失败"))?;
        let Some(child) = guard.as_mut() else {
            return Ok(Some("浏览器宿主进程不存在".to_owned()));
        };
        match child.try_wait() {
            Ok(Some(status)) => {
                guard.take();
                Ok(Some(format!("exit status: {status}")))
            }
            Ok(None) => Ok(None),
            Err(error) => {
                guard.take();
                Ok(Some(error.to_string()))
            }
        }
    }

    async fn rehydrate_browser(&self) -> Result<(), AppError> {
        let value = self
            .browser_ipc
            .request(BrowserCommand::StateSnapshot)
            .await?;
        let remote: BrowserState = serde_json::from_value(value).map_err(AppError::internal)?;
        let active_route_id = remote.active_route_id.clone();
        self.cache_remote_browser_state(remote.clone());
        for tab in remote.tabs {
            let route_id = tab.route_id.clone();
            self.browser_ipc
                .request(BrowserCommand::CreateRoute {
                    route_id: route_id.clone(),
                    thread_id: tab.thread_id,
                    url: tab.url,
                })
                .await
                .map_err(|error| error.context("route_id", route_id.clone()))?;
            let (width, height, scale_factor) = self.browser.route_dimensions(&route_id);
            self.browser_ipc
                .request(BrowserCommand::Resize {
                    route_id: route_id.clone(),
                    width,
                    height,
                    scale_factor,
                    visible: true,
                })
                .await
                .map_err(|error| error.context("route_id", route_id))?;
        }
        if let Some(route_id) = active_route_id {
            self.browser_ipc
                .request(BrowserCommand::ActivateRoute { route_id })
                .await?;
        }
        if let Ok(value) = self
            .browser_ipc
            .request(BrowserCommand::StateSnapshot)
            .await
            && let Ok(remote) = serde_json::from_value::<BrowserState>(value)
        {
            self.cache_remote_browser_state(remote);
        }
        Ok(())
    }

    async fn ensure_browser_ready(&self) -> Result<(), AppError> {
        loop {
            let notified = self.browser_lifecycle.notify.notified();
            let become_leader = {
                let mut phase = self.browser_lifecycle.phase.lock().await;
                match *phase {
                    BrowserHostPhase::Ready => return Ok(()),
                    BrowserHostPhase::Starting | BrowserHostPhase::Backoff => false,
                    BrowserHostPhase::Failed | BrowserHostPhase::Crashed => {
                        let error = self
                            .browser_lifecycle
                            .error
                            .lock()
                            .ok()
                            .and_then(|error| error.clone())
                            .unwrap_or_else(|| "CEF 浏览器宿主不可用".to_owned());
                        return Err(AppError::new(
                            onpeople_types::ErrorCode::BrowserUnavailable,
                            error,
                        )
                        .retryable(true));
                    }
                    BrowserHostPhase::Stopped => {
                        *phase = BrowserHostPhase::Starting;
                        true
                    }
                }
            };
            if !become_leader {
                notified.await;
                continue;
            }
            self.publish_browser_state();
            let result = async {
                self.spawn_browser_host()?;
                self.wait_for_browser_ready().await?;
                self.rehydrate_browser().await
            }
            .await;
            match result {
                Ok(()) => {
                    *self.browser_lifecycle.phase.lock().await = BrowserHostPhase::Ready;
                    self.browser_lifecycle
                        .backoff_attempt
                        .store(0, Ordering::Release);
                    if let Ok(mut error) = self.browser_lifecycle.error.lock() {
                        *error = None;
                    }
                    if let Ok(mut error_kind) = self.browser_lifecycle.error_kind.lock() {
                        *error_kind = None;
                    }
                    self.publish_browser_state();
                    self.browser_lifecycle.notify.notify_waiters();
                    return Ok(());
                }
                Err(error) => {
                    if let Ok(mut message) = self.browser_lifecycle.error.lock() {
                        *message = Some(error.message.clone());
                    }
                    if let Ok(mut error_kind) = self.browser_lifecycle.error_kind.lock() {
                        *error_kind = Some(browser_error_kind(&error).to_owned());
                    }
                    *self.browser_lifecycle.phase.lock().await = BrowserHostPhase::Failed;
                    self.publish_browser_state();
                    self.browser_lifecycle.notify.notify_waiters();
                    return Err(error);
                }
            }
        }
    }

    async fn force_restart_browser_host(&self) -> Result<(), AppError> {
        if let Some(mut process) = self
            .browser_process
            .lock()
            .map_err(|_| AppError::internal("浏览器进程锁定失败"))?
            .take()
        {
            let _ = process.kill();
            let _ = process.wait();
        }
        *self.browser_lifecycle.phase.lock().await = BrowserHostPhase::Stopped;
        if let Ok(mut error) = self.browser_lifecycle.error.lock() {
            *error = None;
        }
        if let Ok(mut error_kind) = self.browser_lifecycle.error_kind.lock() {
            *error_kind = None;
        }
        self.publish_browser_state();
        self.browser_lifecycle.notify.notify_waiters();
        self.ensure_browser_ready().await
    }

    fn start_browser_monitor(&self) {
        if self
            .browser_lifecycle
            .monitor_started
            .swap(true, Ordering::AcqRel)
        {
            return;
        }
        let monitor = self.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_millis(250)).await;
                if monitor.browser_shutdown.load(Ordering::Acquire) {
                    break;
                }
                let process_exit = monitor.browser_process_exit_message().ok().flatten();
                let phase = monitor
                    .browser_lifecycle
                    .phase
                    .try_lock()
                    .map(|phase| *phase)
                    .unwrap_or(BrowserHostPhase::Starting);
                // Startup failures (including a denied Keychain request) are
                // owned by `ensure_browser_ready` and remain Failed until an
                // explicit user retry. Only a previously Ready host is
                // eligible for automatic crash recovery.
                if phase != BrowserHostPhase::Ready {
                    continue;
                }
                let unhealthy = process_exit.is_some()
                    || !matches!(
                        BrowserIpcClient::with_timeout(
                            monitor.browser_ipc.config().clone(),
                            Duration::from_millis(250),
                        )
                        .request(BrowserCommand::Ping)
                        .await,
                        Ok(value) if value.get("ready").and_then(Value::as_bool) == Some(true)
                    );
                if !unhealthy {
                    continue;
                }
                if let Some(mut process) = monitor
                    .browser_process
                    .lock()
                    .ok()
                    .and_then(|mut guard| guard.take())
                {
                    let _ = process.kill();
                    let _ = process.wait();
                }
                let message = process_exit.unwrap_or_else(|| "CEF IPC socket 不可达".to_owned());
                if let Ok(mut error) = monitor.browser_lifecycle.error.lock() {
                    *error = Some(message.clone());
                }
                if let Ok(mut error_kind) = monitor.browser_lifecycle.error_kind.lock() {
                    *error_kind = Some("host-exit".to_owned());
                }
                *monitor.browser_lifecycle.phase.lock().await = BrowserHostPhase::Crashed;
                monitor.browser.report_host_crash(message);
                monitor.publish_browser_state();
                let attempt = monitor
                    .browser_lifecycle
                    .backoff_attempt
                    .fetch_add(1, Ordering::AcqRel)
                    + 1;
                let seconds = match attempt {
                    1 => 1,
                    2 => 2,
                    3 => 4,
                    _ => 5,
                };
                *monitor.browser_lifecycle.phase.lock().await = BrowserHostPhase::Backoff;
                monitor.publish_browser_state();
                tokio::time::sleep(Duration::from_secs(seconds)).await;
                if monitor.browser_shutdown.load(Ordering::Acquire) {
                    break;
                }
                *monitor.browser_lifecycle.phase.lock().await = BrowserHostPhase::Stopped;
                monitor.browser_lifecycle.notify.notify_waiters();
                let _ = monitor.ensure_browser_ready().await;
            }
        });
    }

    async fn apply_browser_remote(&self, command: BrowserCommand) -> Result<Value, AppError> {
        self.ensure_browser_ready().await?;
        let remote = self.browser_ipc.request(command.clone()).await?;
        match self.browser.apply(command) {
            Ok(_)
            | Err(AppError {
                code: onpeople_types::ErrorCode::BrowserUnavailable,
                ..
            }) => Ok(remote),
            Err(error) => Err(error),
        }
    }

    async fn check_app_update<R: Runtime>(&self, app: &AppHandle<R>) -> Result<Value, AppError> {
        self.publish_update_state(
            app,
            AppUpdateState {
                status: "checking".to_owned(),
                message: Some("正在检查更新…".to_owned()),
                ..initial_app_update_state()
            },
        );
        let result = async {
            let update = app
                .updater()
                .map_err(AppError::internal)?
                .check()
                .await
                .map_err(AppError::network)?;
            Ok::<_, AppError>(match update {
                Some(update) => json!({
                    "available": true,
                    "currentVersion": update.current_version,
                    "version": update.version,
                    "date": update.date.map(|date| date.to_string()),
                    "body": update.body,
                }),
                None => json!({
                    "available": false,
                    "currentVersion": env!("CARGO_PKG_VERSION")
                }),
            })
        }
        .await;
        match result {
            Ok(value) => {
                let version = value
                    .get("version")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned);
                let available = value
                    .get("available")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                self.publish_update_state(
                    app,
                    AppUpdateState {
                        status: if available { "available" } else { "idle" }.to_owned(),
                        available_version: version.clone(),
                        message: Some(match version {
                            Some(version) => format!("发现新版本 {version}"),
                            None => "当前已是最新版本".to_owned(),
                        }),
                        ..initial_app_update_state()
                    },
                );
                Ok(value)
            }
            Err(error) => {
                self.publish_update_state(
                    app,
                    AppUpdateState {
                        status: "error".to_owned(),
                        message: Some(error.message.clone()),
                        ..initial_app_update_state()
                    },
                );
                Err(error)
            }
        }
    }

    async fn download_app_update<R: Runtime>(&self, app: &AppHandle<R>) -> Result<Value, AppError> {
        let updater = app.updater().map_err(AppError::internal)?;
        let update = updater.check().await.map_err(AppError::network)?;
        let Some(update) = update else {
            self.publish_update_state(
                app,
                AppUpdateState {
                    message: Some("当前已是最新版本".to_owned()),
                    ..initial_app_update_state()
                },
            );
            return Ok(json!({
                "available": false,
                "currentVersion": env!("CARGO_PKG_VERSION")
            }));
        };
        let version = update.version.clone();
        self.publish_update_state(
            app,
            AppUpdateState {
                status: "downloading".to_owned(),
                available_version: Some(version.clone()),
                progress: Some(0.0),
                message: Some(format!("正在下载版本 {version}")),
                ..initial_app_update_state()
            },
        );
        let update_state = Arc::clone(&self.app_update_state);
        let update_app = app.clone();
        let progress_version = version.clone();
        let mut downloaded = 0_u64;
        let bytes = update
            .download(
                move |chunk, total| {
                    downloaded = downloaded.saturating_add(chunk as u64);
                    let progress = total.map(|total| {
                        if total == 0 {
                            0.0
                        } else {
                            (downloaded as f64 / total as f64).clamp(0.0, 1.0)
                        }
                    });
                    let state = AppUpdateState {
                        status: "downloading".to_owned(),
                        available_version: Some(progress_version.clone()),
                        progress,
                        message: Some(match progress {
                            Some(progress) => format!("正在下载… {}%", (progress * 100.0).round()),
                            None => "正在下载更新…".to_owned(),
                        }),
                        ..initial_app_update_state()
                    };
                    *update_state.lock().expect("app update state mutex") = state.clone();
                    let _ = update_app.emit("app-update:state", state);
                },
                || {},
            )
            .await
            .map_err(|error| {
                let error = AppError::network(error);
                self.publish_update_state(
                    app,
                    AppUpdateState {
                        status: "error".to_owned(),
                        available_version: Some(version.clone()),
                        message: Some(error.message.clone()),
                        ..initial_app_update_state()
                    },
                );
                error
            })?;
        let size = bytes.len();
        *self.pending_update.lock().await = Some(PendingUpdate {
            version: version.clone(),
            bytes,
        });
        self.publish_update_state(
            app,
            AppUpdateState {
                status: "downloaded".to_owned(),
                available_version: Some(version.clone()),
                progress: Some(1.0),
                message: Some(format!("版本 {version} 已下载，可安装")),
                ..initial_app_update_state()
            },
        );
        Ok(json!({ "available": true, "downloaded": true, "version": version, "bytes": size }))
    }

    async fn install_app_update<R: Runtime>(&self, app: &AppHandle<R>) -> Result<Value, AppError> {
        let pending = self.pending_update.lock().await.take().ok_or_else(|| {
            AppError::new(onpeople_types::ErrorCode::NotFound, "没有已下载的更新")
        })?;
        self.publish_update_state(
            app,
            AppUpdateState {
                status: "installing".to_owned(),
                available_version: Some(pending.version.clone()),
                progress: Some(1.0),
                message: Some(format!("正在安装版本 {}", pending.version)),
                ..initial_app_update_state()
            },
        );
        let updater = app.updater().map_err(AppError::internal)?;
        let update = updater
            .check()
            .await
            .map_err(AppError::network)?
            .ok_or_else(|| {
                AppError::new(
                    onpeople_types::ErrorCode::Conflict,
                    "更新已不可用，请重新检查",
                )
            })?;
        if update.version != pending.version {
            return Err(AppError::new(
                onpeople_types::ErrorCode::Conflict,
                "更新版本已变化，请重新下载",
            ));
        }
        update.install(pending.bytes).map_err(AppError::internal)?;
        self.publish_update_state(
            app,
            AppUpdateState {
                status: "installed".to_owned(),
                available_version: Some(pending.version.clone()),
                progress: Some(1.0),
                message: Some(format!(
                    "版本 {} 已安装，重新打开应用后生效",
                    pending.version
                )),
                ..initial_app_update_state()
            },
        );
        Ok(json!({ "installed": true, "version": pending.version }))
    }

    fn list_browser_profiles(&self) -> Result<Vec<onpeople_types::BrowserProfile>, AppError> {
        let mut roots = Vec::new();
        if cfg!(target_os = "macos") {
            if let Some(home) = std::env::var_os("HOME") {
                let home = PathBuf::from(home);
                roots.push((
                    "Google Chrome",
                    home.join("Library/Application Support/Google/Chrome"),
                ));
                roots.push((
                    "Chromium",
                    home.join("Library/Application Support/Chromium"),
                ));
                roots.push((
                    "Microsoft Edge",
                    home.join("Library/Application Support/Microsoft Edge"),
                ));
            }
        } else if cfg!(windows)
            && let Some(local) = std::env::var_os("LOCALAPPDATA")
        {
            let local = PathBuf::from(local);
            roots.push(("Google Chrome", local.join("Google/Chrome/User Data")));
            roots.push(("Microsoft Edge", local.join("Microsoft/Edge/User Data")));
        }
        let mut profiles = Vec::new();
        for (browser, root) in roots {
            if !root.is_dir() {
                continue;
            }
            for entry in std::fs::read_dir(root).map_err(AppError::storage)? {
                let entry = entry.map_err(AppError::storage)?;
                if !entry.file_type().map_err(AppError::storage)?.is_dir() {
                    continue;
                }
                let name = entry.file_name().to_string_lossy().to_string();
                if name != "Default" && !name.starts_with("Profile ") {
                    continue;
                }
                profiles.push(onpeople_types::BrowserProfile {
                    id: hex::encode(sha2::Sha256::digest(
                        entry.path().to_string_lossy().as_bytes(),
                    )),
                    name: name.clone(),
                    browser: browser.to_owned(),
                    path: entry.path().to_string_lossy().into_owned(),
                    last_used_at: None,
                });
            }
        }
        Ok(profiles)
    }

    fn import_browser_profile(&self, payload: &Value) -> Result<Value, AppError> {
        let source = payload
            .get("path")
            .or_else(|| payload.get("profilePath"))
            .and_then(Value::as_str)
            .ok_or_else(|| AppError::invalid("缺少浏览器 Profile 路径"))?;
        let source = PathBuf::from(source);
        let profile_id = payload
            .get("profileId")
            .and_then(Value::as_str)
            .unwrap_or("imported");
        let target = self
            .data_root
            .join("cef-profile")
            .join("Imported")
            .join(profile_id);
        let result = onpeople_storage::import_chromium_profile(
            &source,
            &target,
            payload
                .get("includePasswords")
                .and_then(Value::as_bool)
                .unwrap_or(false),
        )?;
        serde_json::to_value(result).map_err(AppError::internal)
    }

    fn browser_session_status(&self, payload: &Value) -> Result<Value, AppError> {
        let provider = payload
            .get("providerId")
            .or_else(|| payload.get("provider"))
            .and_then(Value::as_str)
            .unwrap_or("default");
        Ok(self
            .runtime
            .storage()
            .get_metadata(&format!("browser.session.{provider}"))?
            .unwrap_or_else(
                || json!({ "signedIn": false, "provider": provider, "cookies": 0, "storage": 0 }),
            ))
    }

    fn clear_browser_session(&self, payload: &Value) -> Result<Value, AppError> {
        let provider = payload
            .get("providerId")
            .or_else(|| payload.get("provider"))
            .and_then(Value::as_str)
            .unwrap_or("default");
        let all = matches!(payload.get("all").and_then(Value::as_bool), Some(true))
            || payload.get("routeId").is_none();
        if all {
            let profile = &self.data_root.join("cef-profile");
            if profile.is_dir() {
                for entry in std::fs::read_dir(profile).map_err(AppError::storage)? {
                    let entry = entry.map_err(AppError::storage)?;
                    let name = entry.file_name().to_string_lossy().to_string();
                    if name != "Cache" && name != "GPUCache" {
                        let path = entry.path();
                        if path.is_dir() {
                            std::fs::remove_dir_all(path).map_err(AppError::storage)?;
                        } else {
                            std::fs::remove_file(path).map_err(AppError::storage)?;
                        }
                    }
                }
            }
        }
        self.runtime
            .storage()
            .delete_metadata(&format!("browser.session.{provider}"))?;
        Ok(json!({ "cleared": true, "provider": provider, "all": all }))
    }

    async fn fill_saved_browser_credential(&self, payload: &Value) -> Result<Value, AppError> {
        let route_id = route_id(payload)?;
        let credential_id = payload
            .get("credentialId")
            .and_then(Value::as_str)
            .unwrap_or(&route_id);
        let value = self
            .runtime
            .storage()
            .read_secret(&format!("browser-credential-{credential_id}"))?
            .ok_or_else(|| {
                AppError::new(onpeople_types::ErrorCode::NotFound, "没有保存的浏览器凭据")
            })?;
        let selector = payload
            .get("selector")
            .and_then(Value::as_str)
            .unwrap_or("input[type=password]")
            .to_owned();
        let result = self
            .apply_browser_remote(BrowserCommand::Fill {
                route_id,
                selector,
                value,
            })
            .await?;
        Ok(json!({ "filled": true, "result": result }))
    }

    async fn dispatch_command<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        command: &str,
        payload: Value,
    ) -> Result<Value, AppError> {
        if command.starts_with("browser_") || command.contains("browser") {
            self.ensure_browser_ready().await?;
        }
        match command {
            "browser_navigate" => {
                self.apply_browser_remote(BrowserCommand::Navigate {
                    route_id: required_string(&payload, "routeId")?,
                    url: required_string(&payload, "url")?,
                })
                .await
            }
            "browser_back" => {
                self.apply_browser_remote(BrowserCommand::Back {
                    route_id: route_id(&payload)?,
                })
                .await
            }
            "browser_forward" => {
                self.apply_browser_remote(BrowserCommand::Forward {
                    route_id: route_id(&payload)?,
                })
                .await
            }
            "browser_reload" => {
                self.apply_browser_remote(BrowserCommand::Reload {
                    route_id: route_id(&payload)?,
                })
                .await
            }
            "browser_visual_snapshot" => {
                self.apply_browser_remote(BrowserCommand::VisualSnapshot {
                    route_id: route_id(&payload)?,
                })
                .await
            }
            "browser_developer_inspect" => {
                self.apply_browser_remote(BrowserCommand::DeveloperInspect {
                    route_id: route_id(&payload)?,
                })
                .await
            }
            "browser_dom_snapshot" => {
                self.apply_browser_remote(BrowserCommand::DomSnapshot {
                    route_id: route_id(&payload)?,
                })
                .await
            }
            "browser_close_route" => {
                self.apply_browser_remote(BrowserCommand::CloseRoute {
                    route_id: route_id(&payload)?,
                })
                .await
            }
            "browser_click" => {
                self.apply_browser_remote(BrowserCommand::Click {
                    route_id: route_id(&payload)?,
                    selector: required_string(&payload, "selector")?,
                })
                .await
            }
            "browser_fill" => {
                self.apply_browser_remote(BrowserCommand::Fill {
                    route_id: route_id(&payload)?,
                    selector: required_string(&payload, "selector")?,
                    value: required_string(&payload, "value")?,
                })
                .await
            }
            "browser_press" => {
                self.apply_browser_remote(BrowserCommand::Press {
                    route_id: route_id(&payload)?,
                    key: required_string(&payload, "key")?,
                })
                .await
            }
            "browser_scroll" => {
                self.apply_browser_remote(BrowserCommand::Scroll {
                    route_id: route_id(&payload)?,
                    x: payload.get("x").and_then(Value::as_f64).unwrap_or(0.0),
                    y: payload.get("y").and_then(Value::as_f64).unwrap_or(0.0),
                })
                .await
            }
            "browser_resize" => {
                self.apply_browser_remote(BrowserCommand::Resize {
                    route_id: route_id(&payload)?,
                    width: payload
                        .get("width")
                        .and_then(Value::as_u64)
                        .unwrap_or(1_280) as u32,
                    height: payload.get("height").and_then(Value::as_u64).unwrap_or(720) as u32,
                    scale_factor: payload
                        .get("scaleFactor")
                        .and_then(Value::as_f64)
                        .unwrap_or(1.0),
                    visible: payload
                        .get("visible")
                        .and_then(Value::as_bool)
                        .unwrap_or(true),
                })
                .await
            }
            "browser_evaluate" => {
                self.apply_browser_remote(BrowserCommand::Evaluate {
                    route_id: route_id(&payload)?,
                    expression: required_string(&payload, "expression")?,
                })
                .await
            }
            "browser_attach" | "attach_browser" => {
                let route_id = required_string(&payload, "routeId")?;
                let url = payload
                    .get("url")
                    .and_then(Value::as_str)
                    .unwrap_or("about:blank");
                self.apply_browser_remote(BrowserCommand::CreateRoute {
                    route_id,
                    thread_id: payload
                        .get("threadId")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_owned(),
                    url: url.to_owned(),
                })
                .await
            }
            "browser_tab_activate" | "activate_browser_tab" => {
                let route_id = route_id(&payload)?;
                self.apply_browser_remote(BrowserCommand::ActivateRoute { route_id })
                    .await
            }
            "browser_tab_detach" | "detach_browser_tab" => {
                self.apply_browser_remote(BrowserCommand::CloseRoute {
                    route_id: route_id(&payload)?,
                })
                .await
            }
            "list_browser_import_profiles" => {
                Ok(json!({ "profiles": self.list_browser_profiles()? }))
            }
            "import_browser_profile" => self.import_browser_profile(&payload),
            "get_browser_session_status" => self.browser_session_status(&payload),
            "open_browser_sign_in" => {
                let route_id = route_id(&payload)?;
                let url = payload
                    .get("url")
                    .or_else(|| payload.get("providerUrl"))
                    .and_then(Value::as_str)
                    .filter(|url| !url.trim().is_empty())
                    .unwrap_or("https://aibro.vip/onpeople/")
                    .to_owned();
                self.apply_browser_remote(BrowserCommand::CreateRoute {
                    route_id: route_id.clone(),
                    thread_id: payload
                        .get("threadId")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_owned(),
                    url: url.clone(),
                })
                .await
            }
            "clear_browser_session"
            | "clear_all_browser_data"
            | "clear_browser_data_from_settings" => self.clear_browser_session(&payload),
            "fill_saved_browser_credential" => self.fill_saved_browser_credential(&payload).await,
            "get_provider_settings" => {
                let kind = payload
                    .get("kind")
                    .or_else(|| payload.get("type"))
                    .cloned()
                    .unwrap_or_else(|| json!("onpeople"));
                let kind = serde_json::from_value(kind).map_err(AppError::invalid)?;
                serde_json::to_value(
                    self.runtime.provider(onpeople_types::ProviderRequest {
                        kind,
                        thread_id: payload
                            .get("threadId")
                            .and_then(Value::as_str)
                            .map(ToOwned::to_owned),
                    })?,
                )
                .map_err(AppError::internal)
            }
            "set_thread_reasoning_effort" => {
                self.runtime
                    .set_thread_reasoning(
                        &required_string(&payload, "threadId")?,
                        &required_string(&payload, "effort")?,
                        payload.get("model").and_then(Value::as_str),
                    )
                    .await
            }
            "get_cloud_account" => {
                serde_json::to_value(self.runtime.cloud_state()).map_err(AppError::internal)
            }
            "login_cloud_account" => self
                .runtime
                .cloud_login(&payload)
                .await
                .and_then(|value| serde_json::to_value(value).map_err(AppError::internal)),
            "send_cloud_registration_code" => {
                self.runtime.cloud_send_registration_code(&payload).await
            }
            "register_cloud_account" => self
                .runtime
                .cloud_register(&payload)
                .await
                .and_then(|value| serde_json::to_value(value).map_err(AppError::internal)),
            "logout_cloud_account" => self
                .runtime
                .cloud_logout()
                .and_then(|value| serde_json::to_value(value).map_err(AppError::internal)),
            "redeem_cloud_code" => self.runtime.cloud_redeem(&payload).await,
            "open_cloud_console" => {
                let url = format!("{}/", self.runtime.cloud_state().service_url);
                open_external_url(&url)?;
                Ok(json!({ "opened": true, "url": url }))
            }
            "open_external_url" => {
                let url = required_string(&payload, "url")?;
                open_external_url(&url)?;
                Ok(json!({ "opened": true, "url": url }))
            }
            "list_cloud_groups" => self
                .runtime
                .cloud_groups()
                .await
                .map(|groups| json!({ "groups": groups })),
            "select_cloud_group" => self
                .runtime
                .cloud_select_group(&payload)
                .and_then(|value| serde_json::to_value(value).map_err(AppError::internal)),
            "get_cloud_usage_profile" => self.runtime.cloud_usage(&payload).await,
            "save_cloud_leaderboard_preference" => {
                self.runtime.save_cloud_leaderboard_preference(&payload)
            }
            "get_live_status" => {
                serde_json::to_value(self.runtime.live_status()).map_err(AppError::internal)
            }
            "create_live_session" => self.runtime.create_live_session(&payload).await,
            "close_live_session" => self.runtime.close_live_session(&payload).await,
            "check_for_app_update" => self.check_app_update(app).await,
            "download_app_update" => self.download_app_update(app).await,
            "install_app_update" => self.install_app_update(app).await,
            "open_app_download" => {
                let url = "https://aibro.vip/onpeople/#download";
                open_external_url(url)?;
                Ok(json!({ "opened": true, "url": url }))
            }
            "list_scheduled_tasks" => {
                serde_json::to_value(self.runtime.scheduler_snapshot()).map_err(AppError::internal)
            }
            "create_scheduled_task" => {
                let task = self.runtime.scheduler().create(
                    required_string(&payload, "name")?,
                    required_string(&payload, "prompt")?,
                    required_string(&payload, "cwd")?,
                    payload
                        .get("schedule")
                        .cloned()
                        .unwrap_or_else(|| json!({ "kind": "once" })),
                    payload.get("runtime").cloned().unwrap_or(Value::Null),
                )?;
                serde_json::to_value(self.runtime.scheduler_snapshot())
                    .map(|snapshot| json!({ "task": task, "state": snapshot }))
                    .map_err(AppError::internal)
            }
            "create_scheduled_task_from_text" => {
                let name = payload
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("OnPeople 计划任务")
                    .to_owned();
                let prompt = payload
                    .get("prompt")
                    .or_else(|| payload.get("text"))
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_owned();
                let cwd = payload
                    .get("cwd")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_owned();
                serde_json::to_value(
                    self.runtime.scheduler().create(
                        name,
                        prompt,
                        cwd,
                        payload
                            .get("schedule")
                            .cloned()
                            .unwrap_or_else(|| json!({"kind":"once"})),
                        payload.get("runtime").cloned().unwrap_or(Value::Null),
                    )?,
                )
                .map_err(AppError::internal)
            }
            "update_scheduled_task" => {
                let task_id = required_string(&payload, "taskId")?;
                let task = self.runtime.scheduler().update(
                    &task_id,
                    payload
                        .get("patch")
                        .cloned()
                        .unwrap_or_else(|| payload.clone()),
                )?;
                Ok(json!({ "task": task, "state": self.runtime.scheduler_snapshot() }))
            }
            "delete_scheduled_task" => {
                let task_id = required_string(&payload, "taskId")?;
                let deleted = self.runtime.scheduler().delete(&task_id)?;
                Ok(json!({ "deleted": deleted, "state": self.runtime.scheduler_snapshot() }))
            }
            "run_scheduled_task" => {
                let task_id = required_string(&payload, "taskId")?;
                execute_scheduled_task(Arc::clone(&self.runtime), task_id).await
            }
            "mark_scheduled_notifications_read" => {
                let run_id = payload.get("runId").and_then(Value::as_str);
                self.runtime.scheduler().mark_read(run_id)?;
                Ok(serde_json::to_value(self.runtime.scheduler_snapshot())
                    .map_err(AppError::internal)?)
            }
            "list_worktrees" => {
                let root = payload
                    .get("root")
                    .or_else(|| payload.get("cwd"))
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_owned();
                serde_json::to_value(self.runtime.worktrees(onpeople_types::WorktreeRequest {
                    root,
                    path: None,
                    branch: None,
                    thread_id: None,
                    remove_branch: false,
                })?)
                .map_err(AppError::internal)
            }
            "create_worktree" => {
                let root = required_string(&payload, "root")
                    .or_else(|_| required_string(&payload, "cwd"))?;
                let path = required_string(&payload, "path")?;
                let branch = payload
                    .get("branch")
                    .and_then(Value::as_str)
                    .unwrap_or("onpeople/task");
                serde_json::to_value(
                    self.runtime.worktrees(onpeople_types::WorktreeRequest {
                        root,
                        path: Some(path),
                        branch: Some(branch.to_owned()),
                        thread_id: payload
                            .get("threadId")
                            .and_then(Value::as_str)
                            .map(ToOwned::to_owned),
                        remove_branch: false,
                    })?,
                )
                .map_err(AppError::internal)
            }
            "snapshot_worktree" => {
                let path = required_string(&payload, "worktreePath")
                    .or_else(|_| required_string(&payload, "path"))?;
                let output = payload
                    .get("output")
                    .and_then(Value::as_str)
                    .map(PathBuf::from)
                    .unwrap_or_else(|| PathBuf::from(&path).join(".onpeople.snapshot.patch"));
                let root = onpeople_workspace::canonical_workspace(std::path::Path::new(&path))?;
                let output = if output.is_absolute() {
                    output
                } else {
                    root.join(output)
                };
                let value =
                    onpeople_workspace::WorktreeService::default().snapshot(&root, &output)?;
                Ok(json!({ "path": value }))
            }
            "handoff_worktree" => {
                let path = required_string(&payload, "worktreePath")
                    .or_else(|_| required_string(&payload, "path"))?;
                onpeople_workspace::WorktreeService::default()
                    .handoff(std::path::Path::new(&path))?;
                Ok(json!({ "handedOff": true, "path": path }))
            }
            "remove_worktree" => {
                let root = required_string(&payload, "root")
                    .or_else(|_| required_string(&payload, "cwd"))?;
                let path = required_string(&payload, "worktreePath")
                    .or_else(|_| required_string(&payload, "path"))?;
                let _ = self.runtime.worktrees(onpeople_types::WorktreeRequest {
                    root,
                    path: Some(path.clone()),
                    branch: None,
                    thread_id: None,
                    remove_branch: true,
                })?;
                Ok(json!({ "removed": true, "path": path }))
            }
            "get_policy" => Ok(
                json!({ "policy": self.runtime.agent_status()?.policy, "audit": self.runtime.storage().metadata_prefix("audit.")?.into_iter().map(|(_, value)| value).collect::<Vec<_>>() }),
            ),
            "save_policy" => {
                let policy = payload
                    .get("policy")
                    .cloned()
                    .unwrap_or_else(|| payload.clone());
                serde_json::to_value(self.runtime.save_policy(policy).await?)
                    .map_err(AppError::internal)
            }
            "get_usage_ledger" => self.runtime.usage_snapshot(),
            "save_usage_price" => {
                let key = required_string(&payload, "key")?;
                let price = payload
                    .get("price")
                    .and_then(Value::as_f64)
                    .filter(|value| value.is_finite() && *value >= 0.0)
                    .ok_or_else(|| AppError::invalid("价格必须是非负数"))?;
                let mut usage = self.runtime.usage_snapshot()?;
                usage["prices"][key] = json!(price);
                self.runtime
                    .storage()
                    .put_metadata("usage.snapshot", &usage)?;
                Ok(usage)
            }
            "get_effective_config" => Ok(json!({
                "source": "onpeople.db",
                "cwd": payload.get("cwd"),
                "provider": self.runtime.agent_status()?.provider,
                "policy": self.runtime.agent_status()?.policy,
                "preferences": self.runtime.preferences()?,
            })),
            "pick_download_directory" => {
                let directory = payload
                    .get("path")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
                    .or_else(|| {
                        app.dialog()
                            .file()
                            .blocking_pick_folder()
                            .and_then(|path| path.into_path().ok())
                            .map(|path| path.to_string_lossy().into_owned())
                    })
                    .ok_or_else(|| AppError::invalid("请选择下载目录"))?;
                let directory =
                    onpeople_workspace::canonical_workspace(std::path::Path::new(&directory))?;
                let mut preferences = self.runtime.preferences()?;
                preferences.download_directory = Some(directory.to_string_lossy().into_owned());
                self.runtime.save_preferences(PreferencePatchRequest {
                    preferences: preferences.clone(),
                })?;
                Ok(serde_json::to_value(preferences).map_err(AppError::internal)?)
            }
            "list_memories" => self.runtime.memory_state(
                payload.get("cwd").and_then(Value::as_str),
                payload.get("threadId").and_then(Value::as_str),
            ),
            "save_memory" => {
                let entry = payload.get("entry").unwrap_or(&payload);
                let saved = self.runtime.save_memory_from_payload(entry)?;
                Ok(json!({
                    "entry": saved,
                    "state": self.runtime.memory_state(
                        entry.get("cwd").and_then(Value::as_str),
                        payload.get("threadId").and_then(Value::as_str),
                    )?,
                }))
            }
            "delete_memory" => self
                .runtime
                .delete_document_from_payload("memories", &payload),
            "save_memory_settings" => self.runtime.save_memory_settings(&payload),
            "list_agent_profiles" => Ok(json!({ "profiles": self.runtime.list_agent_profiles()? })),
            "save_agent_profile" => {
                let profile = payload.get("profile").unwrap_or(&payload);
                let saved = self.runtime.save_agent_profile(profile)?;
                self.runtime.reload_agent_configuration().await?;
                Ok(json!({ "profile": saved, "profiles": self.runtime.list_agent_profiles()? }))
            }
            "delete_agent_profile" => {
                let deleted = self.runtime.delete_agent_profile(
                    &required_string(&payload, "profileId")
                        .or_else(|_| required_string(&payload, "id"))?,
                )?;
                self.runtime.reload_agent_configuration().await?;
                Ok(deleted)
            }
            "list_secrets" => Ok(json!({ "secrets": self.runtime.list_secrets()? })),
            "save_secret" => {
                let secret = payload.get("secret").unwrap_or(&payload);
                let saved = self.runtime.save_secret_from_payload(secret)?;
                Ok(json!({ "secret": saved, "secrets": self.runtime.list_secrets()? }))
            }
            "delete_secret" => {
                let id = payload
                    .get("id")
                    .or_else(|| payload.get("secretId"))
                    .and_then(Value::as_str)
                    .ok_or_else(|| AppError::invalid("缺少 secretId"))?;
                Ok(
                    json!({ "deleted": self.runtime.storage().delete_secret(id)?, "secrets": self.runtime.list_secrets()? }),
                )
            }
            "list_hooks" | "list_local_hooks" => {
                let cwd = payload
                    .get("cwd")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
                    .unwrap_or_else(|| self.runtime.default_cwd().to_string_lossy().into_owned());
                self.runtime.list_hooks(&cwd, command == "list_local_hooks")
            }
            "create_hook" => self.runtime.create_hook(&payload),
            "read_text" => read_system_clipboard(),
            "copy_text" => {
                let text = payload
                    .get("text")
                    .or_else(|| payload.get("value"))
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                write_system_clipboard(text)?;
                Ok(json!({ "copied": true }))
            }
            "read_generated_image" => read_generated_image(&self.runtime, &payload),
            "reveal_generated_image" => reveal_generated_image(&self.runtime, &payload),
            "copy_generated_image" => copy_generated_image(&self.runtime, &payload),
            "open_local_artifact" => open_local_artifact(&self.runtime, &payload),
            "pick_images" | "pick_attachments" | "pick_project" | "paste_image" => {
                let provided = payload
                    .get("paths")
                    .cloned()
                    .filter(|value| value.as_array().is_some_and(|entries| !entries.is_empty()));
                let selected = if let Some(provided) = provided {
                    provided
                } else if command == "paste_image" {
                    Value::Array(
                        clipboard_attachment_paths()?
                            .into_iter()
                            .map(|path| json!(path))
                            .collect(),
                    )
                } else if command == "pick_project" {
                    app.dialog()
                        .file()
                        .blocking_pick_folder()
                        .and_then(|path| path.into_path().ok())
                        .map(|path| json!([path]))
                        .unwrap_or_else(|| Value::Array(Vec::new()))
                } else {
                    app.dialog()
                        .file()
                        .blocking_pick_files()
                        .map(|paths| {
                            Value::Array(
                                paths
                                    .into_iter()
                                    .filter_map(|path| {
                                        path.into_path().ok().map(|path| json!(path))
                                    })
                                    .collect(),
                            )
                        })
                        .unwrap_or_else(|| Value::Array(Vec::new()))
                };
                Ok(json!({ "selected": selected }))
            }
            "new_task" => {
                let cwd = payload
                    .get("cwd")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(ToOwned::to_owned);
                match cwd {
                    Some(cwd) => self.runtime.start_thread(&cwd).await,
                    None => Ok(json!({
                        "pending": true,
                        "workspaceMode": "isolated",
                        "cwd": null,
                    })),
                }
            }
            "resume_thread" | "fork_thread" | "archive_thread" | "unarchive_thread"
            | "pin_thread" | "mark_thread_unread" | "rename_thread" => {
                self.runtime.thread_command(command, &payload).await
            }
            "auto_name_thread" => self.runtime.auto_name_thread(&payload).await,
            "reveal_thread" => {
                let thread_id = required_string(&payload, "threadId")
                    .or_else(|_| required_string(&payload, "id"))?;
                let thread = self
                    .runtime
                    .storage()
                    .thread_json(&thread_id)?
                    .ok_or_else(|| {
                        AppError::new(onpeople_types::ErrorCode::NotFound, "任务不存在")
                    })?;
                let cwd = thread
                    .get("cwd")
                    .and_then(Value::as_str)
                    .ok_or_else(|| AppError::invalid("任务没有工作目录"))?;
                reveal_path(cwd)?;
                Ok(json!({ "threadId": thread_id, "cwd": cwd, "opened": true }))
            }
            "update_project" => {
                let path = required_string(&payload, "projectPath")
                    .or_else(|_| required_string(&payload, "path"))?;
                let action = required_string(&payload, "action")?;
                self.runtime
                    .storage()
                    .update_project(&path, &action, payload.get("value"))
            }
            "reveal_project" => {
                let path = required_string(&payload, "projectPath")
                    .or_else(|_| required_string(&payload, "path"))?;
                reveal_path(&path)?;
                Ok(json!({ "path": path, "opened": true }))
            }
            "archive_project_tasks" => {
                let path = required_string(&payload, "projectPath")
                    .or_else(|_| required_string(&payload, "path"))?;
                let threads = self.runtime.storage().list_threads(&ThreadFilters {
                    archived: false,
                    query: String::new(),
                    project_path: Some(path.clone()),
                    limit: 1_000,
                })?;
                let mut archived = 0_u32;
                for thread in threads.threads {
                    self.runtime
                        .thread_command("archive_thread", &json!({ "threadId": thread.id }))
                        .await?;
                    archived = archived.saturating_add(1);
                }
                Ok(json!({ "projectPath": path, "archived": archived }))
            }
            "ready_terminal" => {
                let process_id = required_string(&payload, "processId")?;
                self.runtime.terminal_ready(&process_id)
            }
            "show_terminal_context_menu" => {
                let process_id = required_string(&payload, "processId")?;
                self.runtime.terminal_ready(&process_id)?;
                Ok(json!({
                    "processId": process_id,
                    "items": ["copy", "paste", "selectAll", "clear", "terminate"],
                    "hasSelection": payload
                        .get("hasSelection")
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                }))
            }
            "get_quick_launcher_suggestions" => {
                let cwd = payload
                    .get("cwd")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
                    .unwrap_or_else(|| self.runtime.default_cwd().to_string_lossy().into_owned());
                let route_id = payload.get("routeId").and_then(Value::as_str);
                let mut suggestions = self
                    .runtime
                    .project_actions(&cwd)?
                    .into_iter()
                    .map(|action| serde_json::to_value(action).unwrap_or(Value::Null))
                    .collect::<Vec<_>>();
                let query = payload
                    .get("query")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .trim();
                let files = if query.is_empty() {
                    self.runtime.files_list(&cwd, "")?
                } else {
                    self.runtime.files_search(&cwd, query)?.entries
                };
                suggestions.extend(
                    files
                        .into_iter()
                        .filter(|entry| entry.kind == "file")
                        .take(20)
                        .map(|entry| {
                            json!({
                                "kind": "file",
                                "routeId": route_id,
                                "path": entry.path,
                                "label": entry.name,
                            })
                        }),
                );
                Ok(Value::Array(suggestions))
            }
            "list_project_files" => {
                let cwd = required_string(&payload, "cwd")?;
                let relative = payload
                    .get("relative")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                serde_json::to_value(self.runtime.files_list(&cwd, relative)?)
                    .map_err(AppError::internal)
            }
            "search_project_files" => {
                let cwd = required_string(&payload, "cwd")?;
                let query = payload.get("query").and_then(Value::as_str).unwrap_or("");
                serde_json::to_value(self.runtime.files_search(&cwd, query)?)
                    .map_err(AppError::internal)
            }
            "get_project_actions" => {
                let cwd = required_string(&payload, "cwd")?;
                serde_json::to_value(self.runtime.project_actions(&cwd)?)
                    .map_err(AppError::internal)
            }
            "authorize_project_action" => {
                let cwd = required_string(&payload, "cwd")?;
                let action_id = required_string(&payload, "actionId")
                    .or_else(|_| required_string(&payload, "id"))?;
                let actions = self.runtime.project_actions(&cwd)?;
                let action = actions
                    .into_iter()
                    .find(|action| action.id == action_id)
                    .ok_or_else(|| {
                        AppError::new(onpeople_types::ErrorCode::NotFound, "项目动作不存在")
                    })?;
                if let Some(requested_fingerprint) = payload
                    .get("fingerprint")
                    .and_then(Value::as_str)
                    .filter(|value| !value.is_empty())
                    && requested_fingerprint != action.fingerprint
                {
                    return Err(AppError::new(
                        onpeople_types::ErrorCode::Conflict,
                        "项目动作已发生变化，请重新选择后再执行",
                    ));
                }
                self.runtime.storage().put_metadata(
                    &format!("project.action.{}.{}", action_id, action.fingerprint),
                    &json!({ "cwd": cwd, "action": &action, "authorizedAt": chrono::Utc::now() }),
                )?;
                let mut authorized = serde_json::to_value(action).map_err(AppError::internal)?;
                if let Value::Object(fields) = &mut authorized {
                    fields.insert("authorized".to_owned(), Value::Bool(true));
                }
                Ok(authorized)
            }
            "open_workspace_file" => {
                let cwd = required_string(&payload, "cwd")?;
                let path = required_string(&payload, "path")?;
                let root = onpeople_workspace::canonical_workspace(std::path::Path::new(&cwd))?;
                let resolved =
                    onpeople_workspace::resolve_inside(&root, std::path::Path::new(&path))?;
                workspace_file_preview(&root, &resolved, payload.get("routeId"))
            }
            "capture_browser_visual_snapshot" => {
                self.apply_browser_remote(BrowserCommand::VisualSnapshot {
                    route_id: route_id(&payload)?,
                })
                .await
            }
            "inspect_browser_developer_state" => {
                self.apply_browser_remote(BrowserCommand::DeveloperInspect {
                    route_id: route_id(&payload)?,
                })
                .await
            }
            "begin_browser_annotation" => Ok(
                json!({ "started": true, "routeId": route_id(&payload)?, "token": Uuid::now_v7().to_string() }),
            ),
            "cancel_browser_annotation" => {
                Ok(json!({ "cancelled": true, "routeId": route_id(&payload)? }))
            }
            "list_browser_annotations" => Ok(serde_json::to_value(
                self.browser.annotations(&route_id(&payload)?),
            )
            .map_err(AppError::internal)?),
            "save_browser_annotation" => {
                let annotation: BrowserAnnotation = serde_json::from_value(
                    payload
                        .get("annotation")
                        .cloned()
                        .unwrap_or(payload.clone()),
                )
                .map_err(AppError::invalid)?;
                serde_json::to_value(self.browser.save_annotation(annotation)?)
                    .map_err(AppError::internal)
            }
            "delete_browser_annotation" => {
                let id = payload
                    .get("annotationId")
                    .or_else(|| payload.get("id"))
                    .and_then(Value::as_str)
                    .ok_or_else(|| AppError::invalid("缺少 annotationId"))?;
                Ok(json!({ "deleted": self.browser.delete_annotation(id), "id": id }))
            }
            "context_state" | "get_context_state" => self
                .runtime
                .context_state(payload.get("threadId").and_then(Value::as_str)),
            "compact_context" => {
                self.runtime
                    .compact_context(payload.get("threadId").and_then(Value::as_str))
                    .await
            }
            "recalibrate_context" => {
                self.runtime
                    .recalibrate_context(payload.get("threadId").and_then(Value::as_str))
                    .await
            }
            "steer_turn" => {
                let text = required_string(&payload, "text")?;
                self.runtime
                    .steer_turn(payload.get("threadId").and_then(Value::as_str), &text)
                    .await
            }
            "queue_message" => {
                let text = required_string(&payload, "text")?;
                self.runtime
                    .queue_message(payload.get("threadId").and_then(Value::as_str), &text)
            }
            "delete_queued_message" => self.runtime.delete_queued_message(
                payload.get("threadId").and_then(Value::as_str),
                &required_string(&payload, "queueId")?,
            ),
            "steer_queued_message" => {
                self.runtime
                    .steer_queued_message(
                        payload.get("threadId").and_then(Value::as_str),
                        &required_string(&payload, "queueId")?,
                    )
                    .await
            }
            "init_git_repository" => self
                .runtime
                .git_initialize(&required_string(&payload, "cwd")?)
                .and_then(|state| serde_json::to_value(state).map_err(AppError::internal)),
            "get_git_hunks" => self.runtime.git_hunks(
                &required_string(&payload, "cwd")?,
                &required_string(&payload, "filePath")?,
            ),
            "mutate_git_hunk" => self
                .runtime
                .mutate_git_hunk(&payload)
                .and_then(|state| serde_json::to_value(state).map_err(AppError::internal)),
            "prepare_pull_request" => self.runtime.prepare_pull_request(
                payload
                    .get("cwd")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
                payload.get("base").and_then(Value::as_str),
            ),
            "start_review" => self.runtime.start_review(&payload).await,
            "submit_review_comments" => self.runtime.submit_review_comments(&payload).await,
            "open_editor" => {
                let cwd = payload
                    .get("cwd")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let path = payload
                    .get("path")
                    .or_else(|| payload.get("filePath"))
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let root = onpeople_workspace::canonical_workspace(std::path::Path::new(cwd))?;
                let resolved =
                    onpeople_workspace::resolve_inside(&root, std::path::Path::new(path))?;
                reveal_path(&resolved.to_string_lossy())?;
                Ok(json!({ "opened": true, "path": resolved }))
            }
            "list_extensions" => self
                .runtime
                .extensions(payload.get("cwd").and_then(Value::as_str)),
            "set_skill_enabled" => self.runtime.set_skill_enabled(&payload),
            "install_plugin" => self.runtime.install_plugin(&payload),
            "uninstall_plugin" => self.runtime.uninstall_plugin(&payload),
            "activate_industry_plugin" => self.runtime.activate_industry_plugin(&payload),
            "deactivate_industry_plugin" => self.runtime.deactivate_industry_plugin(&payload),
            "reload_mcp" => self.runtime.reload_mcp(),
            "sync_plugin_catalog" => self.runtime.sync_plugin_catalog(&payload).await,
            "start_connector_oauth" => self.runtime.start_connector_oauth(&payload),
            "complete_connector_oauth" => self.runtime.complete_connector_oauth(&payload).await,
            "disconnect_connector" => self.runtime.disconnect_connector(&payload),
            "list_agents" => Ok(json!({
                "agents": self
                    .runtime
                    .list_agent_tasks(
                        payload
                            .get("parentThreadId")
                            .or_else(|| payload.get("threadId"))
                            .and_then(Value::as_str),
                    )
                    .await?
            })),
            "create_agent_task" | "dispatch_agent_task" | "remove_agent_task" | "spawn_agent" => {
                Err(AppError::invalid(
                    "OnPeople 已使用 Codex 原生多 Agent；请在当前任务中明确要求委派子 Agent",
                ))
            }
            "message_agent" => {
                self.runtime
                    .message_agent(
                        &required_string(&payload, "agentId")?,
                        &required_string(&payload, "text")?,
                    )
                    .await
            }
            "stop_agent" => {
                self.runtime
                    .stop_agent(&required_string(&payload, "agentId")?)
                    .await
            }
            "read_agent" => {
                self.runtime
                    .read_agent(&required_string(&payload, "agentId")?)
                    .await
            }
            "discover_models" => self.runtime.discover_models(),
            "validate_model" => self.runtime.validate_model(&payload),
            "get_app_update_state" => {
                serde_json::to_value(self.update_state()).map_err(AppError::internal)
            }
            "restart_runtime" => {
                self.runtime.stop().await;
                self.runtime.start().await?;
                serde_json::to_value(self.runtime.runtime_diagnostics()).map_err(AppError::internal)
            }
            "interrupt" => self.runtime.interrupt(&payload).await,
            "resolve_approval" => {
                self.runtime
                    .resolve_approval(
                        &required_string(&payload, "requestId")?,
                        &required_string(&payload, "decision")?,
                    )
                    .await
            }
            "resolve_user_input" => {
                self.runtime
                    .resolve_user_input(
                        &required_string(&payload, "requestId")?,
                        payload
                            .get("answers")
                            .cloned()
                            .ok_or_else(|| AppError::invalid("缺少用户输入答案"))?,
                    )
                    .await
            }
            _ => Err(AppError::new(
                onpeople_types::ErrorCode::Unsupported,
                "未知的 OnPeople command",
            )
            .context("command", command)),
        }
    }
}

/// Built-in plugins ship inside OnPeople's signed runtime and are copied into
/// the app's isolated CODEX_HOME. The packages contain only OnPeople-owned
/// manifests and skills; they reuse the built-in MCP servers instead of
/// extracting or redistributing another product's private plugin runtime.
fn install_bundled_plugins(runtime: &CoreRuntime, runtime_root: &Path) -> Result<(), AppError> {
    const BUNDLED_PLUGIN_IDS: &[&str] = &[
        "research-paper",
        "documents",
        "pdf",
        "spreadsheets",
        "presentations",
        "template-creator",
        "sites",
        "visualize",
    ];

    for id in BUNDLED_PLUGIN_IDS {
        let candidates = [
            runtime_root.join("plugins").join(id),
            runtime_root
                .parent()
                .map(|parent| parent.join("plugins").join(id))
                .unwrap_or_default(),
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../plugins")
                .join(id),
        ];
        let Some(source) = candidates
            .into_iter()
            .find(|path| path.join(".codex-plugin/plugin.json").is_file())
        else {
            continue;
        };

        let manifest: Value = serde_json::from_slice(
            &std::fs::read(source.join(".codex-plugin/plugin.json")).map_err(AppError::storage)?,
        )
        .map_err(AppError::invalid)?;
        let version = manifest.get("version").cloned().unwrap_or(Value::Null);
        let already_installed = runtime
            .extensions(None)?
            .get("plugins")
            .and_then(Value::as_array)
            .is_some_and(|plugins| {
                plugins.iter().any(|plugin| {
                    plugin.get("id").and_then(Value::as_str) == Some(*id)
                        && plugin.get("builtin").and_then(Value::as_bool) == Some(true)
                        && plugin.get("version") == Some(&version)
                })
            });
        if already_installed {
            continue;
        }

        runtime.install_plugin(&json!({
            "id": id,
            "source": source.to_string_lossy(),
            "builtin": true,
        }))?;
    }
    Ok(())
}

fn open_external_url(url: &str) -> Result<(), AppError> {
    let parsed = url::Url::parse(url).map_err(AppError::invalid)?;
    if !matches!(parsed.scheme(), "https" | "http") {
        return Err(AppError::invalid("只允许打开 HTTP(S) 地址"));
    }
    let mut command = if cfg!(target_os = "macos") {
        let mut command = Command::new("open");
        command.arg(url);
        command
    } else if cfg!(windows) {
        let mut command = Command::new("rundll32.exe");
        command.args(["url.dll,FileProtocolHandler", url]);
        command
    } else {
        let mut command = Command::new("xdg-open");
        command.arg(url);
        command
    };
    command.spawn().map(|_| ()).map_err(|error| {
        AppError::new(onpeople_types::ErrorCode::ProcessFailed, "无法打开外部地址")
            .context("cause", error)
    })
}

fn reveal_path(path: &str) -> Result<(), AppError> {
    let path = PathBuf::from(path);
    if !path.exists() {
        return Err(
            AppError::new(onpeople_types::ErrorCode::NotFound, "要显示的路径不存在")
                .context("path", path.display()),
        );
    }
    let mut command = if cfg!(target_os = "macos") {
        let mut command = Command::new("open");
        command.arg(&path);
        command
    } else if cfg!(windows) {
        let mut command = Command::new("explorer.exe");
        command.arg(&path);
        command
    } else {
        let mut command = Command::new("xdg-open");
        command.arg(&path);
        command
    };
    command.spawn().map(|_| ()).map_err(|error| {
        AppError::new(onpeople_types::ErrorCode::ProcessFailed, "无法显示路径")
            .context("cause", error)
            .context("path", path.display())
    })
}

fn workspace_file_preview(
    root: &std::path::Path,
    path: &std::path::Path,
    route_id: Option<&Value>,
) -> Result<Value, AppError> {
    if !path.is_file() {
        return Err(AppError::invalid("只能预览工作区文件"));
    }
    let metadata = std::fs::metadata(path).map_err(AppError::storage)?;
    let size = metadata.len();
    let relative = path.strip_prefix(root).unwrap_or(path);
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let mime_type = match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "avif" => "image/avif",
        "pdf" => "application/pdf",
        "mp3" => "audio/mpeg",
        "m4a" => "audio/mp4",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "mp4" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "md" | "markdown" => "text/markdown",
        "json" | "jsonl" => "application/json",
        "html" | "htm" => "text/html",
        "css" => "text/css",
        "js" | "mjs" | "cjs" => "text/javascript",
        "ts" | "tsx" => "text/typescript",
        "rs" => "text/rust",
        "go" => "text/go",
        "py" => "text/python",
        "java" => "text/java",
        "kt" | "kts" => "text/kotlin",
        "c" | "h" | "cc" | "cpp" | "hpp" => "text/x-c",
        "swift" => "text/swift",
        "rb" => "text/ruby",
        "php" => "text/php",
        "sh" | "bash" | "zsh" => "text/x-shellscript",
        "sql" => "text/sql",
        "toml" => "application/toml",
        "yaml" | "yml" => "application/yaml",
        "xml" => "application/xml",
        "txt" | "log" | "csv" | "tsv" | "diff" | "patch" | "ini" | "conf" | "env" => "text/plain",
        _ => "application/octet-stream",
    };
    let mut result = json!({
        "opened": true,
        "name": name,
        "path": relative,
        "absolutePath": path,
        "size": size,
        "mimeType": mime_type,
        "kind": "binary",
        "routeId": route_id.cloned().unwrap_or(Value::Null),
    });
    if size > 24 * 1024 * 1024 {
        result["message"] = Value::String("文件超过 24 MB，请使用外部应用打开".to_owned());
        return Ok(result);
    }
    let bytes = std::fs::read(path).map_err(AppError::storage)?;
    if mime_type.starts_with("image/") {
        result["kind"] = Value::String("image".to_owned());
        result["dataUrl"] = Value::String(format!(
            "data:{mime_type};base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        ));
    } else if mime_type == "application/pdf" {
        result["kind"] = Value::String("pdf".to_owned());
        result["dataUrl"] = Value::String(format!(
            "data:{mime_type};base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        ));
    } else if mime_type.starts_with("audio/") {
        result["kind"] = Value::String("audio".to_owned());
        result["dataUrl"] = Value::String(format!(
            "data:{mime_type};base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        ));
    } else if mime_type.starts_with("video/") {
        result["kind"] = Value::String("video".to_owned());
        result["dataUrl"] = Value::String(format!(
            "data:{mime_type};base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        ));
    } else if size <= 4 * 1024 * 1024
        && let Ok(content) = String::from_utf8(bytes)
    {
        result["kind"] = Value::String("text".to_owned());
        result["content"] = Value::String(content);
    }
    Ok(result)
}

fn route_id(payload: &Value) -> Result<String, AppError> {
    required_string(payload, "routeId")
}

fn read_system_clipboard() -> Result<Value, AppError> {
    let (program, args): (&str, &[&str]) = if cfg!(target_os = "macos") {
        ("pbpaste", &[])
    } else if cfg!(windows) {
        (
            "powershell.exe",
            &["-NoProfile", "-Command", "Get-Clipboard"],
        )
    } else {
        ("xclip", &["-selection", "clipboard", "-o"])
    };
    let output = Command::new(program)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|error| {
            AppError::new(
                onpeople_types::ErrorCode::ProcessFailed,
                "读取系统剪贴板失败",
            )
            .context("cause", error)
        })?;
    if !output.status.success() {
        return Err(AppError::new(
            onpeople_types::ErrorCode::ProcessFailed,
            "读取系统剪贴板失败",
        ));
    }
    Ok(json!({ "text": String::from_utf8_lossy(&output.stdout).into_owned() }))
}

fn existing_clipboard_files(output: &[u8]) -> Vec<PathBuf> {
    String::from_utf8_lossy(output)
        .lines()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .filter_map(|value| {
            let decoded = if value.starts_with("file://") {
                url::Url::parse(value)
                    .ok()
                    .and_then(|url| url.to_file_path().ok())
            } else {
                Some(PathBuf::from(value))
            }?;
            let path = decoded.canonicalize().ok()?;
            path.is_file().then_some(path)
        })
        .take(20)
        .collect()
}

fn clipboard_attachment_paths() -> Result<Vec<PathBuf>, AppError> {
    #[cfg(target_os = "macos")]
    {
        let aliases = Command::new("osascript")
            .args([
                "-e",
                r#"set output to ""
try
  set clipboardItems to the clipboard as alias list
on error
  try
    set clipboardItems to {the clipboard as alias}
  on error
    return ""
  end try
end try
repeat with clipboardItem in clipboardItems
  set output to output & POSIX path of clipboardItem & linefeed
end repeat
return output"#,
            ])
            .output()
            .map_err(|error| {
                AppError::new(
                    onpeople_types::ErrorCode::ProcessFailed,
                    "读取剪贴板附件失败",
                )
                .context("cause", error)
            })?;
        let files = existing_clipboard_files(&aliases.stdout);
        if !files.is_empty() {
            return Ok(files);
        }

        let directory = stable_data_root()?.join("pasted-attachments");
        std::fs::create_dir_all(&directory).map_err(AppError::storage)?;
        let image_path = directory.join(format!("clipboard-{}.png", Uuid::new_v4()));
        let image = Command::new("osascript")
            .args([
                "-e",
                r#"on run argv
  set outputPath to item 1 of argv
  try
    set imageData to the clipboard as «class PNGf»
    set targetFile to open for access POSIX file outputPath with write permission
    set eof targetFile to 0
    write imageData to targetFile
    close access targetFile
    return outputPath
  on error
    return ""
  end try
end run"#,
                "--",
            ])
            .arg(&image_path)
            .output()
            .map_err(|error| {
                AppError::new(
                    onpeople_types::ErrorCode::ProcessFailed,
                    "读取剪贴板图片失败",
                )
                .context("cause", error)
            })?;
        if image.status.success()
            && image_path
                .metadata()
                .is_ok_and(|metadata| metadata.is_file() && metadata.len() > 0)
        {
            return Ok(vec![image_path]);
        }
        let _ = std::fs::remove_file(&image_path);
        return Ok(Vec::new());
    }

    #[cfg(windows)]
    {
        let files = Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-Command",
                "$items = Get-Clipboard -Format FileDropList -ErrorAction SilentlyContinue; $items | ForEach-Object { $_.FullName }",
            ])
            .output()
            .map_err(|error| {
                AppError::new(
                    onpeople_types::ErrorCode::ProcessFailed,
                    "读取剪贴板附件失败",
                )
                .context("cause", error)
            })?;
        let selected = existing_clipboard_files(&files.stdout);
        if !selected.is_empty() {
            return Ok(selected);
        }
        let directory = stable_data_root()?.join("pasted-attachments");
        std::fs::create_dir_all(&directory).map_err(AppError::storage)?;
        let image_path = directory.join(format!("clipboard-{}.png", Uuid::new_v4()));
        let escaped = image_path.to_string_lossy().replace("'", "''");
        let script = format!(
            "Add-Type -AssemblyName System.Windows.Forms; if ([System.Windows.Forms.Clipboard]::ContainsImage()) {{ $image=[System.Windows.Forms.Clipboard]::GetImage(); $image.Save('{escaped}', [System.Drawing.Imaging.ImageFormat]::Png) }}"
        );
        let status = Command::new("powershell.exe")
            .args(["-NoProfile", "-Command", script.as_str()])
            .status()
            .map_err(|error| {
                AppError::new(
                    onpeople_types::ErrorCode::ProcessFailed,
                    "读取剪贴板图片失败",
                )
                .context("cause", error)
            })?;
        if status.success()
            && image_path
                .metadata()
                .is_ok_and(|metadata| metadata.is_file() && metadata.len() > 0)
        {
            return Ok(vec![image_path]);
        }
        let _ = std::fs::remove_file(&image_path);
        return Ok(Vec::new());
    }

    #[cfg(not(any(target_os = "macos", windows)))]
    {
        let output = Command::new("xclip")
            .args(["-selection", "clipboard", "-t", "text/uri-list", "-o"])
            .output()
            .map_err(|error| {
                AppError::new(
                    onpeople_types::ErrorCode::ProcessFailed,
                    "读取剪贴板附件失败",
                )
                .context("cause", error)
            })?;
        Ok(existing_clipboard_files(&output.stdout))
    }
}

fn write_system_clipboard(text: &str) -> Result<(), AppError> {
    let (program, args): (&str, &[&str]) = if cfg!(target_os = "macos") {
        ("pbcopy", &[])
    } else if cfg!(windows) {
        (
            "powershell.exe",
            &["-NoProfile", "-Command", "$input | Set-Clipboard"],
        )
    } else {
        ("xclip", &["-selection", "clipboard"])
    };
    let mut child = Command::new(program)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            AppError::new(
                onpeople_types::ErrorCode::ProcessFailed,
                "写入系统剪贴板失败",
            )
            .context("cause", error)
        })?;
    if let Some(stdin) = child.stdin.as_mut() {
        std::io::Write::write_all(stdin, text.as_bytes()).map_err(AppError::storage)?;
    }
    let status = child.wait().map_err(AppError::storage)?;
    if !status.success() {
        return Err(AppError::new(
            onpeople_types::ErrorCode::ProcessFailed,
            "写入系统剪贴板失败",
        ));
    }
    Ok(())
}

fn generated_image_path(runtime: &CoreRuntime, payload: &Value) -> Result<PathBuf, AppError> {
    let thread_id = payload
        .get("threadId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let cwd = runtime
        .storage()
        .thread_json(thread_id)?
        .and_then(|value| value.get("cwd").and_then(Value::as_str).map(PathBuf::from))
        .unwrap_or_else(|| runtime.default_cwd());
    let workspace_root = onpeople_workspace::canonical_workspace(&cwd)?;
    let generated_root = workspace_root.join(".onpeople").join("generated-images");
    let candidate = payload
        .get("imagePath")
        .or_else(|| payload.get("path"))
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::invalid("缺少生成图片路径"))?;
    let candidate = candidate
        .strip_prefix("sandbox:")
        .or_else(|| candidate.strip_prefix("file://"))
        .unwrap_or(candidate);
    let candidate = PathBuf::from(candidate);
    let candidate = if candidate.is_absolute() {
        candidate
    } else {
        generated_root.join(candidate)
    };
    let candidate = candidate.canonicalize().map_err(AppError::storage)?;
    let mut allowed_roots = vec![workspace_root];
    if let Ok(data_root) = runtime.storage().paths().root.canonicalize()
        && !allowed_roots.contains(&data_root)
    {
        allowed_roots.push(data_root);
    }
    for root in [std::env::temp_dir(), PathBuf::from("/tmp")] {
        if let Ok(root) = root.canonicalize()
            && !allowed_roots.contains(&root)
        {
            allowed_roots.push(root);
        }
    }
    if !candidate.is_file() || !allowed_roots.iter().any(|root| candidate.starts_with(root)) {
        return Err(AppError::new(
            onpeople_types::ErrorCode::WorkspaceBoundary,
            "图片不在当前任务目录或系统临时目录",
        ));
    }
    let extension = candidate
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !matches!(extension.as_str(), "png" | "jpg" | "jpeg" | "webp") {
        return Err(AppError::invalid("不支持的生成图片格式"));
    }
    Ok(candidate)
}

fn read_generated_image(runtime: &CoreRuntime, payload: &Value) -> Result<Value, AppError> {
    let path = generated_image_path(runtime, payload)?;
    let bytes = std::fs::read(&path).map_err(AppError::storage)?;
    if bytes.is_empty() || bytes.len() > 48 * 1024 * 1024 {
        return Err(AppError::invalid("生成图片为空或超过 48 MB"));
    }
    let mime = match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "webp" => "image/webp",
        "jpg" | "jpeg" => "image/jpeg",
        _ => "application/octet-stream",
    };
    Ok(
        json!({ "path": path, "name": path.file_name().and_then(|value| value.to_str()).unwrap_or_default(), "mimeType": mime, "bytes": bytes.len(), "dataUrl": format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)) }),
    )
}

fn reveal_generated_image(runtime: &CoreRuntime, payload: &Value) -> Result<Value, AppError> {
    let path = generated_image_path(runtime, payload)?;
    reveal_path(&path.to_string_lossy())?;
    Ok(json!({ "revealed": true, "path": path }))
}

fn open_local_artifact(runtime: &CoreRuntime, payload: &Value) -> Result<Value, AppError> {
    let path = local_artifact_path(runtime, payload)?;
    if payload
        .get("preview")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        let workspace_root = local_artifact_workspace_root(runtime, payload)?;
        return workspace_file_preview(&workspace_root, &path, None);
    }
    reveal_path(&path.to_string_lossy())?;
    Ok(json!({ "opened": true, "path": path }))
}

fn timeline_value_has_attachment_path(value: &Value, candidate: &Path) -> bool {
    match value {
        Value::Array(values) => values
            .iter()
            .any(|value| timeline_value_has_attachment_path(value, candidate)),
        Value::Object(object) => {
            let is_attachment = object
                .get("type")
                .and_then(Value::as_str)
                .is_some_and(|kind| matches!(kind, "mention" | "localImage" | "image"));
            if is_attachment
                && object
                    .get("path")
                    .and_then(Value::as_str)
                    .and_then(|path| PathBuf::from(path).canonicalize().ok())
                    .is_some_and(|path| path == candidate)
            {
                return true;
            }
            object
                .values()
                .any(|value| timeline_value_has_attachment_path(value, candidate))
        }
        _ => false,
    }
}

fn local_artifact_path(runtime: &CoreRuntime, payload: &Value) -> Result<PathBuf, AppError> {
    let workspace_root = local_artifact_workspace_root(runtime, payload)?;
    let thread_id = payload
        .get("threadId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let thread = runtime.storage().thread_json(thread_id)?;
    let candidate = payload
        .get("path")
        .or_else(|| payload.get("filePath"))
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::invalid("缺少本地文件路径"))?;
    let candidate = candidate
        .strip_prefix("sandbox:")
        .or_else(|| candidate.strip_prefix("file://"))
        .unwrap_or(candidate);
    let candidate = PathBuf::from(candidate);
    let candidate = if candidate.is_absolute() {
        candidate
    } else {
        workspace_root.join(candidate)
    };
    let candidate = candidate.canonicalize().map_err(AppError::storage)?;
    let mut allowed_roots = vec![workspace_root];
    if let Some(base_cwd) = thread
        .as_ref()
        .and_then(|value| value.get("workspaceBaseCwd"))
        .and_then(Value::as_str)
        .map(PathBuf::from)
        .and_then(|path| path.canonicalize().ok())
        && !allowed_roots.contains(&base_cwd)
    {
        allowed_roots.push(base_cwd);
    }
    for root in [
        stable_data_root()?,
        std::env::temp_dir(),
        PathBuf::from("/tmp"),
    ] {
        if let Ok(root) = root.canonicalize()
            && !allowed_roots.contains(&root)
        {
            allowed_roots.push(root);
        }
    }
    let is_explicit_attachment = runtime
        .storage()
        .timeline_items(thread_id)?
        .iter()
        .any(|value| timeline_value_has_attachment_path(value, &candidate));
    if !candidate.is_file()
        || !(allowed_roots.iter().any(|root| candidate.starts_with(root)) || is_explicit_attachment)
    {
        return Err(AppError::new(
            onpeople_types::ErrorCode::WorkspaceBoundary,
            "文件不在当前任务目录或系统临时目录",
        ));
    }
    let extension = candidate
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !matches!(
        extension.as_str(),
        "png"
            | "jpg"
            | "jpeg"
            | "webp"
            | "gif"
            | "bmp"
            | "svg"
            | "avif"
            | "pdf"
            | "txt"
            | "md"
            | "markdown"
            | "log"
            | "json"
            | "jsonl"
            | "csv"
            | "tsv"
            | "xml"
            | "yaml"
            | "yml"
            | "toml"
            | "diff"
            | "patch"
            | "ini"
            | "conf"
            | "env"
            | "rtf"
            | "doc"
            | "docx"
            | "xls"
            | "xlsx"
            | "ppt"
            | "pptx"
            | "zip"
            | "tar"
            | "gz"
            | "7z"
            | "mp3"
            | "m4a"
            | "wav"
            | "ogg"
            | "mp4"
            | "mov"
            | "webm"
            | "rs"
            | "go"
            | "py"
            | "js"
            | "jsx"
            | "mjs"
            | "cjs"
            | "ts"
            | "tsx"
            | "css"
            | "html"
            | "htm"
            | "sql"
            | "java"
            | "kt"
            | "kts"
            | "c"
            | "h"
            | "cc"
            | "cpp"
            | "hpp"
            | "swift"
            | "rb"
            | "php"
            | "sh"
            | "bash"
            | "zsh"
    ) {
        return Err(AppError::invalid("不支持打开这种本地文件类型"));
    }
    Ok(candidate)
}

fn local_artifact_workspace_root(
    runtime: &CoreRuntime,
    payload: &Value,
) -> Result<PathBuf, AppError> {
    let thread_id = payload
        .get("threadId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let thread = runtime.storage().thread_json(thread_id)?;
    let cwd = thread
        .as_ref()
        .and_then(|value| value.get("cwd"))
        .and_then(Value::as_str)
        .map(PathBuf::from)
        .unwrap_or_else(|| runtime.default_cwd());
    onpeople_workspace::canonical_workspace(&cwd)
}

fn copy_generated_image(runtime: &CoreRuntime, payload: &Value) -> Result<Value, AppError> {
    let path = generated_image_path(runtime, payload)?;
    copy_image_to_system_clipboard(&path)?;
    let image = read_generated_image(runtime, payload)?;
    Ok(json!({ "copied": true, "image": image, "clipboard": "system-image" }))
}

fn copy_image_to_system_clipboard(path: &std::path::Path) -> Result<(), AppError> {
    let path_string = path.to_string_lossy();
    let (program, args): (&str, Vec<String>) = if cfg!(target_os = "macos") {
        let escaped = path_string.replace('\\', "\\\\").replace('"', "\\\"");
        (
            "osascript",
            vec![
                "-e".to_owned(),
                format!("set the clipboard to (read (POSIX file \"{escaped}\") as «class PNGf»)",),
            ],
        )
    } else if cfg!(windows) {
        (
            "powershell.exe",
            vec![
                "-NoProfile".to_owned(),
                "-Command".to_owned(),
                format!(
                    "Add-Type -AssemblyName System.Windows.Forms; $image=[System.Drawing.Image]::FromFile('{}'); [System.Windows.Forms.Clipboard]::SetImage($image)",
                    path_string.replace('\'', "''")
                ),
            ],
        )
    } else {
        (
            "xclip",
            vec![
                "-selection".to_owned(),
                "clipboard".to_owned(),
                "-t".to_owned(),
                "image/png".to_owned(),
                "-i".to_owned(),
                path_string.into_owned(),
            ],
        )
    };
    let status = Command::new(program).args(args).status().map_err(|error| {
        AppError::new(
            onpeople_types::ErrorCode::ProcessFailed,
            "复制图片到系统剪贴板失败",
        )
        .context("cause", error)
    })?;
    if status.success() {
        Ok(())
    } else {
        Err(AppError::new(
            onpeople_types::ErrorCode::ProcessFailed,
            "复制图片到系统剪贴板失败",
        ))
    }
}

fn required_string(payload: &Value, key: &str) -> Result<String, AppError> {
    payload
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| AppError::invalid(format!("缺少参数 {key}")))
}

async fn execute_scheduled_task(
    runtime: Arc<CoreRuntime>,
    task_id: String,
) -> Result<Value, AppError> {
    let run = runtime.scheduler().run_now(&task_id)?;
    let task = runtime
        .scheduler()
        .task(&task_id)
        .ok_or_else(|| AppError::new(onpeople_types::ErrorCode::NotFound, "计划任务不存在"))?;
    let submission = runtime
        .send_prompt(SendPromptRequest {
            thread_id: None,
            text: task.prompt,
            cwd: Some(task.cwd),
            workspace_mode: Some("local".to_owned()),
            images: Vec::new(),
            attachments: Vec::new(),
            capability: None,
            mode: None,
            industry_plugin: None,
            model: None,
            reasoning_effort: None,
        })
        .await;
    match submission {
        Ok(submission) => {
            runtime.scheduler().start_run(
                &run.id,
                submission.thread_id.clone(),
                submission.turn_id.clone(),
            )?;
            Ok(json!({
                "run": run,
                "submission": submission,
                "state": runtime.scheduler_snapshot(),
            }))
        }
        Err(error) => {
            runtime
                .scheduler()
                .finish_run(&run.id, "failed", None, Some(error.message.clone()))?;
            Err(error)
        }
    }
}

fn install_app_menu<R: Runtime>(app: &AppHandle<R>) -> Result<(), AppError> {
    let settings = MenuItemBuilder::with_id("menu-settings", "设置…")
        .accelerator("CmdOrCtrl+Comma")
        .build(app)
        .map_err(AppError::internal)?;
    let check_updates = MenuItemBuilder::with_id("menu-check-updates", "检查更新…")
        .build(app)
        .map_err(AppError::internal)?;
    let app_menu = SubmenuBuilder::new(app, "OnPeople")
        .about(None)
        .separator()
        .item(&settings)
        .item(&check_updates)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()
        .map_err(AppError::internal)?;

    let new_window = MenuItemBuilder::with_id("menu-new-window", "新建窗口")
        .accelerator("CmdOrCtrl+Shift+KeyN")
        .build(app)
        .map_err(AppError::internal)?;
    let new_chat = MenuItemBuilder::with_id("menu-new-chat", "新对话")
        .accelerator("CmdOrCtrl+KeyN")
        .build(app)
        .map_err(AppError::internal)?;
    let open_folder = MenuItemBuilder::with_id("menu-open-folder", "打开文件夹…")
        .accelerator("CmdOrCtrl+KeyO")
        .build(app)
        .map_err(AppError::internal)?;
    let file_menu = SubmenuBuilder::new(app, "文件")
        .item(&new_window)
        .item(&new_chat)
        .separator()
        .item(&open_folder)
        .separator()
        .close_window()
        .build()
        .map_err(AppError::internal)?;

    let edit_menu = SubmenuBuilder::new(app, "编辑")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()
        .map_err(AppError::internal)?;

    let toggle_sidebar = MenuItemBuilder::with_id("menu-toggle-sidebar", "切换边栏")
        .build(app)
        .map_err(AppError::internal)?;
    let toggle_bottom_panel = MenuItemBuilder::with_id("menu-toggle-bottom-panel", "切换底部面板")
        .accelerator("CmdOrCtrl+KeyJ")
        .build(app)
        .map_err(AppError::internal)?;
    let toggle_summary = MenuItemBuilder::with_id("menu-toggle-summary", "切换置顶摘要")
        .build(app)
        .map_err(AppError::internal)?;
    let open_terminal = MenuItemBuilder::with_id("menu-open-terminal", "打开终端")
        .build(app)
        .map_err(AppError::internal)?;
    let toggle_files = MenuItemBuilder::with_id("menu-toggle-files", "切换文件树")
        .build(app)
        .map_err(AppError::internal)?;
    let toggle_review = MenuItemBuilder::with_id("menu-toggle-review", "切换审阅面板")
        .build(app)
        .map_err(AppError::internal)?;
    let browser = MenuItemBuilder::with_id("menu-browser", "浏览器")
        .build(app)
        .map_err(AppError::internal)?;
    let find = MenuItemBuilder::with_id("menu-find", "查找")
        .accelerator("CmdOrCtrl+KeyF")
        .build(app)
        .map_err(AppError::internal)?;
    let previous_chat = MenuItemBuilder::with_id("menu-previous-chat", "上一个对话")
        .build(app)
        .map_err(AppError::internal)?;
    let next_chat = MenuItemBuilder::with_id("menu-next-chat", "下一个对话")
        .build(app)
        .map_err(AppError::internal)?;
    let back = MenuItemBuilder::with_id("menu-back", "返回")
        .build(app)
        .map_err(AppError::internal)?;
    let forward = MenuItemBuilder::with_id("menu-forward", "前进")
        .build(app)
        .map_err(AppError::internal)?;
    let view_menu = SubmenuBuilder::new(app, "视图")
        .item(&toggle_sidebar)
        .item(&toggle_bottom_panel)
        .item(&toggle_summary)
        .item(&open_terminal)
        .item(&toggle_files)
        .item(&toggle_review)
        .separator()
        .item(&browser)
        .separator()
        .item(&find)
        .separator()
        .item(&previous_chat)
        .item(&next_chat)
        .item(&back)
        .item(&forward)
        .separator()
        .fullscreen()
        .build()
        .map_err(AppError::internal)?;

    let window_menu = SubmenuBuilder::new(app, "窗口")
        .minimize()
        .maximize()
        .separator()
        .bring_all_to_front()
        .build()
        .map_err(AppError::internal)?;

    let shortcuts = MenuItemBuilder::with_id("menu-keyboard-shortcuts", "显示键盘快捷键")
        .build(app)
        .map_err(AppError::internal)?;
    let troubleshooting = MenuItemBuilder::with_id("menu-troubleshooting", "故障排查")
        .build(app)
        .map_err(AppError::internal)?;
    let task_manager = MenuItemBuilder::with_id("menu-task-manager", "任务管理器")
        .build(app)
        .map_err(AppError::internal)?;
    let help_menu = SubmenuBuilder::new(app, "帮助")
        .item(&shortcuts)
        .separator()
        .item(&troubleshooting)
        .item(&task_manager)
        .build()
        .map_err(AppError::internal)?;

    let menu = MenuBuilder::new(app)
        .items(&[
            &app_menu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &window_menu,
            &help_menu,
        ])
        .build()
        .map_err(AppError::internal)?;
    app.set_menu(menu).map_err(AppError::internal)?;
    app.on_menu_event(|app, event| {
        if let Some(action) = event.id().0.strip_prefix("menu-") {
            let _ = app.emit("app:menu-action", json!({ "action": action }));
        }
    });
    Ok(())
}

fn should_forward_runtime_event(event: &onpeople_types::EventEnvelope) -> bool {
    if !matches!(event.kind, onpeople_types::EventKind::Agent) {
        return true;
    }
    let method = event
        .payload
        .get("method")
        .and_then(Value::as_str)
        .or_else(|| event.payload.get("type").and_then(Value::as_str));
    let Some(method) = method else {
        return true;
    };

    // Codex emits a large amount of startup bookkeeping. The runtime keeps
    // processing every notification, but the WebView only needs the protocol
    // events that can change the visible conversation or its controls.
    if method == "fs/changed"
        || method == "skills/changed"
        || method.starts_with("mcpServer/")
        || method.starts_with("account/rateLimits/")
        || method.starts_with("remoteControl/")
        || method.starts_with("externalAgentConfig/")
    {
        return false;
    }
    true
}

pub fn setup_app<R: Runtime>(app: &AppHandle<R>) -> Result<(), AppError> {
    let bundled_runtime_root = app
        .path()
        .resource_dir()
        .ok()
        .map(|path| path.join(".embedded-runtime"));
    let state = match AppState::initialize(bundled_runtime_root) {
        Ok(state) => state,
        Err(error) => {
            eprintln!(
                "OnPeople setup failed: code={:?}, message={}, context={:?}",
                error.code, error.message, error.context
            );
            return Err(error);
        }
    };
    let event_state = state.runtime.clone();
    let event_app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut events = event_state.subscribe();
        loop {
            let event = match events.recv().await {
                Ok(event) => event,
                Err(broadcast::error::RecvError::Lagged(skipped)) => {
                    eprintln!("OnPeople runtime event bridge lagged; skipped {skipped} events");
                    continue;
                }
                Err(broadcast::error::RecvError::Closed) => break,
            };
            if !should_forward_runtime_event(&event) {
                continue;
            }
            let _ = event_app.emit("runtime:event", &event);
            match event.kind {
                onpeople_types::EventKind::Preferences => {
                    let _ = event_app.emit("preferences:changed", &event.payload);
                }
                onpeople_types::EventKind::CloudAccount => {
                    let _ = event_app.emit("cloud:account:updated", &event.payload);
                }
                onpeople_types::EventKind::AppUpdate => {
                    let _ = event_app.emit("app-update:state", &event.payload);
                }
                onpeople_types::EventKind::CommandPalette => {
                    let _ = event_app.emit("app:command-palette", &event.payload);
                }
                onpeople_types::EventKind::TerminalMenu => {
                    let _ = event_app.emit("terminal:menu-action", &event.payload);
                }
                onpeople_types::EventKind::Agent => {
                    let _ = event_app.emit("agent:event", &event.payload);
                }
                onpeople_types::EventKind::Runtime => {
                    let _ = event_app.emit("runtime:updated", &event.payload);
                }
                onpeople_types::EventKind::BrowserNavigation => {
                    let _ = event_app.emit("browser:agent-navigation", &event.payload);
                }
                onpeople_types::EventKind::BrowserPreview => {
                    let _ = event_app.emit("browser:preview-updated", &event.payload);
                }
                onpeople_types::EventKind::BrowserNewTab => {
                    let _ = event_app.emit("browser:new-tab-requested", &event.payload);
                }
                onpeople_types::EventKind::Scheduler => {
                    let _ = event_app.emit("scheduler:updated", &event.payload);
                }
                onpeople_types::EventKind::SchedulerOpen => {
                    let _ = event_app.emit("scheduler:open", &event.payload);
                }
                onpeople_types::EventKind::DeepLink => {
                    let _ = event_app.emit("app:deep-link", &event.payload);
                }
                onpeople_types::EventKind::BrowserState => {
                    let _ = event_app.emit("browser:state", &event.payload);
                }
            }
        }
    });
    let live_runtime = state.runtime.clone();
    let live_app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut events = live_runtime.subscribe_live();
        while let Ok(payload) = events.recv().await {
            let _ = live_app.emit("live:sideband-event", &payload);
            let _ = live_app.emit("live:sideband-status", &payload);
        }
    });
    let scheduler = state.runtime.scheduler().clone();
    let scheduler_app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut events = scheduler.subscribe();
        while let Ok(snapshot) = events.recv().await {
            let _ = scheduler_app.emit("scheduler:updated", snapshot);
        }
    });
    let scheduled_runtime = Arc::clone(&state.runtime);
    tauri::async_runtime::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_secs(30));
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            ticker.tick().await;
            let due = match scheduled_runtime.scheduler().claim_due(chrono::Utc::now()) {
                Ok(tasks) => tasks,
                Err(error) => {
                    tracing::warn!(
                        code = ?error.code,
                        message = %error.message,
                        "failed to claim scheduled tasks"
                    );
                    continue;
                }
            };
            for task in due {
                let task_runtime = Arc::clone(&scheduled_runtime);
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = execute_scheduled_task(task_runtime, task.id).await {
                        tracing::warn!(
                            code = ?error.code,
                            message = %error.message,
                            "scheduled task execution failed"
                        );
                    }
                });
            }
        }
    });
    let terminal_runtime = state.runtime.clone();
    let terminal_app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut events = terminal_runtime.terminal_events();
        while let Ok(event) = events.recv().await {
            match event {
                onpeople_workspace::TerminalEvent::Output { process_id, data } => {
                    let _ = terminal_app.emit(
                        "terminal:output",
                        json!({
                            "processId": process_id,
                            "data": String::from_utf8_lossy(&data),
                        }),
                    );
                }
                onpeople_workspace::TerminalEvent::Exit(value) => {
                    let _ = terminal_app.emit("terminal:exit", value);
                }
            }
        }
    });
    let browser = state.browser.clone();
    let browser_state_source = state.clone();
    let browser_app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut events = browser.subscribe();
        while let Ok(event) = events.recv().await {
            let payload = match event {
                BrowserHostEvent::State(_value) => {
                    let _ = browser_app.emit(
                        "browser:state",
                        browser_state_source.current_browser_state(),
                    );
                    continue;
                }
                BrowserHostEvent::Frame(value) => {
                    let _ = browser_app.emit("browser:preview-updated", &value);
                    json!({ "kind": "frame", "value": value })
                }
                BrowserHostEvent::Navigation { route_id, url } => {
                    let _ = browser_app.emit(
                        "browser:agent-navigation",
                        json!({ "routeId": route_id.clone(), "url": url.clone() }),
                    );
                    json!({ "kind": "navigation", "routeId": route_id, "url": url })
                }
                BrowserHostEvent::NewTab { route_id, url } => {
                    let _ = browser_app.emit(
                        "browser:new-tab-requested",
                        json!({ "routeId": route_id.clone(), "url": url.clone() }),
                    );
                    json!({ "kind": "new-tab", "routeId": route_id, "url": url })
                }
                BrowserHostEvent::Crash { route_id, message } => {
                    json!({ "kind": "crash", "routeId": route_id, "message": message })
                }
            };
            let _ = browser_app.emit("browser:event", payload);
        }
    });
    // The Browser Host is a separate process, so mirror its state into the
    // shell once and publish only actual changes. Publishing every poll tick
    // caused React to treat the active tab as new and repeatedly replace the
    // native surface with a screenshot fallback.
    let remote_state_source = state.clone();
    tauri::async_runtime::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_millis(250));
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let mut last_published = None;
        loop {
            ticker.tick().await;
            let Ok(value) = remote_state_source
                .browser_ipc
                .request(BrowserCommand::StateSnapshot)
                .await
            else {
                continue;
            };
            let Ok(remote_state) = serde_json::from_value::<BrowserState>(value) else {
                continue;
            };
            let published = remote_state_source.cache_remote_browser_state(remote_state);
            let Ok(fingerprint) = serde_json::to_value(&published) else {
                continue;
            };
            if last_published.as_ref() == Some(&fingerprint) {
                continue;
            }
            last_published = Some(fingerprint);
            remote_state_source.browser.publish_state(published);
        }
    });
    // Bridge the Browser Host's retained IOSurface lease over the existing IPC
    // commands. Render synchronously before acknowledging the frame so CEF
    // cannot release the source surface while Metal is copying it.
    let frame_state = state.clone();
    let frame_app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_millis(16));
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            ticker.tick().await;
            let current = frame_state.current_browser_state();
            if !current.host_ready {
                continue;
            }
            let Some(route_id) = current.active_route_id else {
                continue;
            };
            let Ok(value) = frame_state
                .browser_ipc
                .request(BrowserCommand::FrameSnapshot {
                    route_id: route_id.clone(),
                })
                .await
            else {
                continue;
            };
            let Ok(frame) = serde_json::from_value::<BrowserFrame>(value) else {
                continue;
            };
            if frame.route_id != route_id {
                continue;
            }
            let rendered = native_compositor::render_frame(&frame_app, frame.clone()).is_ok();
            let _ = frame_state
                .browser_ipc
                .request(BrowserCommand::FrameConsumed {
                    route_id: frame.route_id.clone(),
                    sequence: frame.sequence,
                })
                .await;
            if rendered {
                frame_state.browser.emit_frame_internal(frame);
            }
        }
    });
    let deep_link_state = state.clone();
    let deep_link_app = app.clone();
    app.deep_link().on_open_url(move |event| {
        let urls = event
            .urls()
            .into_iter()
            .map(|url| url.to_string())
            .collect::<Vec<_>>();
        deep_link_state.dispatch_deep_links(&deep_link_app, urls);
    });
    match app.deep_link().get_current() {
        Ok(Some(urls)) => state.queue_deep_links(
            urls.into_iter()
                .map(|url| url.to_string())
                .collect::<Vec<_>>(),
        ),
        Ok(None) => {}
        Err(error) => tracing::warn!(message = %error, "failed to read launch deep link"),
    }
    install_app_menu(app)?;
    let show_item = MenuItemBuilder::with_id("show", "显示 OnPeople")
        .build(app)
        .map_err(AppError::internal)?;
    let new_task_item = MenuItemBuilder::with_id("new-task", "新建任务")
        .build(app)
        .map_err(AppError::internal)?;
    let quit_item = MenuItemBuilder::with_id("quit", "退出 OnPeople")
        .build(app)
        .map_err(AppError::internal)?;
    let menu = MenuBuilder::new(app)
        .item(&show_item)
        .item(&new_task_item)
        .separator()
        .item(&quit_item)
        .build()
        .map_err(AppError::internal)?;
    TrayIconBuilder::with_id("onpeople")
        .menu(&menu)
        .tooltip("OnPeople")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().0.as_str() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "new-task" => {
                let _ = app.emit("app:new-task", Value::Null);
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)
        .map_err(AppError::internal)?;
    app.manage(state);
    Ok(())
}

#[tauri::command]
fn agent_status(state: State<'_, AppState>) -> Result<AgentStatus, AppError> {
    state.runtime.agent_status()
}

#[tauri::command]
fn get_preferences(state: State<'_, AppState>) -> Result<Preferences, AppError> {
    state.runtime.preferences()
}

#[tauri::command]
fn activate_deep_links(state: State<'_, AppState>) -> Vec<String> {
    state.activate_deep_links()
}

#[tauri::command]
fn frontend_ready<R: Runtime>(app: AppHandle<R>) -> Result<(), AppError> {
    let main_app = app.clone();
    app.run_on_main_thread(move || {
        let _ = activate_main_window(&main_app);
    })
    .map_err(AppError::internal)?;
    schedule_main_window_activation(app);
    Ok(())
}

#[tauri::command]
fn save_preferences(
    state: State<'_, AppState>,
    request: PreferencePatchRequest,
) -> Result<Preferences, AppError> {
    state.runtime.save_preferences(request)
}

#[tauri::command]
async fn list_threads(
    state: State<'_, AppState>,
    filters: ThreadFilters,
) -> Result<ThreadList, AppError> {
    state.runtime.list_threads(filters).await
}

#[tauri::command]
fn get_thread_timeline(
    state: State<'_, AppState>,
    thread_id: String,
) -> Result<Vec<Value>, AppError> {
    state.runtime.storage().timeline_items(&thread_id)
}

#[tauri::command]
fn get_runtime_snapshot(
    state: State<'_, AppState>,
    thread_id: Option<String>,
) -> Result<RuntimeSnapshot, AppError> {
    Ok(state.runtime.runtime_snapshot(thread_id.as_deref()))
}

#[tauri::command]
fn get_runtime_diagnostics(state: State<'_, AppState>) -> Result<RuntimeDiagnostics, AppError> {
    Ok(state.runtime.runtime_diagnostics())
}

#[tauri::command]
async fn start_runtime(state: State<'_, AppState>) -> Result<(), AppError> {
    state.runtime.start().await
}

#[tauri::command]
async fn stop_runtime(state: State<'_, AppState>) -> Result<(), AppError> {
    state.runtime.stop().await;
    Ok(())
}

#[tauri::command]
async fn send_prompt(
    state: State<'_, AppState>,
    request: SendPromptRequest,
) -> Result<PromptSubmission, AppError> {
    state.runtime.send_prompt(request).await
}

#[tauri::command]
async fn set_goal(state: State<'_, AppState>, request: GoalRequest) -> Result<Goal, AppError> {
    state.runtime.set_goal(request).await
}

#[tauri::command]
async fn update_goal(
    state: State<'_, AppState>,
    request: GoalUpdateRequest,
) -> Result<Option<Goal>, AppError> {
    state.runtime.update_goal(request).await
}

#[tauri::command]
fn get_provider(
    state: State<'_, AppState>,
    request: ProviderRequest,
) -> Result<ProviderSettings, AppError> {
    state.runtime.provider(request)
}

#[tauri::command]
fn save_provider(
    state: State<'_, AppState>,
    request: onpeople_types::SaveProviderRequest,
) -> Result<ProviderSettings, AppError> {
    state.runtime.save_provider(request)
}

#[tauri::command]
fn start_terminal(
    state: State<'_, AppState>,
    request: TerminalStartRequest,
) -> Result<TerminalSession, AppError> {
    state.runtime.terminal_start(request)
}

#[tauri::command]
fn write_terminal(
    state: State<'_, AppState>,
    request: TerminalWriteRequest,
) -> Result<(), AppError> {
    state.runtime.terminal_write(request)
}

#[tauri::command]
fn resize_terminal(
    state: State<'_, AppState>,
    request: TerminalResizeRequest,
) -> Result<(), AppError> {
    state.runtime.terminal_resize(request)
}

#[tauri::command]
fn terminate_terminal(
    state: State<'_, AppState>,
    request: TerminalIdRequest,
) -> Result<(), AppError> {
    state.runtime.terminal_terminate(request)
}

#[tauri::command]
fn get_git_state(state: State<'_, AppState>, request: GitRequest) -> Result<GitState, AppError> {
    state.runtime.git_state(request)
}

#[tauri::command]
fn get_git_diff(state: State<'_, AppState>, request: GitFileRequest) -> Result<GitDiff, AppError> {
    state.runtime.git_diff(request)
}

#[tauri::command]
fn mutate_git(
    state: State<'_, AppState>,
    request: GitMutationRequest,
) -> Result<GitState, AppError> {
    state.runtime.git_mutate(request)
}

#[tauri::command]
fn commit_git(state: State<'_, AppState>, request: GitCommitRequest) -> Result<GitState, AppError> {
    state.runtime.git_commit(request)
}

#[tauri::command]
fn push_git(state: State<'_, AppState>, request: GitPushRequest) -> Result<GitState, AppError> {
    state.runtime.git_push(request)
}

#[tauri::command]
fn list_project_files(state: State<'_, AppState>, request: Value) -> Result<Value, AppError> {
    let cwd = request
        .get("cwd")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::invalid("缺少工作区路径"))?;
    let relative = request
        .get("relative")
        .and_then(Value::as_str)
        .unwrap_or("");
    serde_json::to_value(state.runtime.files_list(cwd, relative)?).map_err(AppError::internal)
}

#[tauri::command]
fn search_project_files(state: State<'_, AppState>, request: Value) -> Result<Value, AppError> {
    let cwd = request
        .get("cwd")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::invalid("缺少工作区路径"))?;
    let query = request.get("query").and_then(Value::as_str).unwrap_or("");
    serde_json::to_value(state.runtime.files_search(cwd, query)?).map_err(AppError::internal)
}

#[tauri::command]
fn discover_project_actions(state: State<'_, AppState>, request: Value) -> Result<Value, AppError> {
    let cwd = request
        .get("cwd")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::invalid("缺少工作区路径"))?;
    serde_json::to_value(state.runtime.project_actions(cwd)?).map_err(AppError::internal)
}

#[tauri::command]
fn get_worktrees(state: State<'_, AppState>, request: WorktreeRequest) -> Result<Value, AppError> {
    state.runtime.worktrees(request)
}

#[tauri::command]
fn get_scheduler(state: State<'_, AppState>) -> Result<SchedulerSnapshot, AppError> {
    Ok(state.runtime.scheduler_snapshot())
}

#[tauri::command]
fn open_scheduler<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
) -> Result<SchedulerSnapshot, AppError> {
    app.emit("scheduler:open", json!({}))
        .map_err(AppError::internal)?;
    Ok(state.runtime.scheduler_snapshot())
}

#[tauri::command]
fn create_scheduled_task(
    state: State<'_, AppState>,
    request: onpeople_types::ScheduledTaskRequest,
) -> Result<ScheduledTask, AppError> {
    state.runtime.scheduler().create(
        request.name,
        request.prompt,
        request.cwd,
        request.schedule,
        request.runtime,
    )
}

#[tauri::command]
fn update_scheduled_task(
    state: State<'_, AppState>,
    request: onpeople_types::ScheduledTaskMutationRequest,
) -> Result<ScheduledTask, AppError> {
    state
        .runtime
        .scheduler()
        .update(&request.task_id, request.patch)
}

#[tauri::command]
fn delete_scheduled_task(
    state: State<'_, AppState>,
    request: onpeople_types::IdRequest,
) -> Result<bool, AppError> {
    state.runtime.scheduler().delete(&request.id)
}

#[tauri::command]
async fn run_scheduled_task(
    state: State<'_, AppState>,
    request: onpeople_types::IdRequest,
) -> Result<Value, AppError> {
    execute_scheduled_task(Arc::clone(&state.runtime), request.id).await
}

#[tauri::command]
fn mark_scheduled_notifications_read(
    state: State<'_, AppState>,
    request: Value,
) -> Result<SchedulerSnapshot, AppError> {
    let run_id = request
        .get("runId")
        .or_else(|| request.get("id"))
        .and_then(Value::as_str);
    state.runtime.scheduler().mark_read(run_id)?;
    Ok(state.runtime.scheduler_snapshot())
}

#[tauri::command]
fn get_live_status(state: State<'_, AppState>) -> Result<LiveStatus, AppError> {
    Ok(state.runtime.live_status())
}

#[tauri::command]
fn get_cloud_account(state: State<'_, AppState>) -> Result<Value, AppError> {
    serde_json::to_value(state.runtime.cloud_state()).map_err(AppError::internal)
}

#[tauri::command]
fn discover_models(state: State<'_, AppState>) -> Result<Value, AppError> {
    state.runtime.discover_models()
}

#[tauri::command]
fn get_app_update_state(state: State<'_, AppState>) -> Result<AppUpdateState, AppError> {
    Ok(state.update_state())
}

#[tauri::command]
fn get_browser_state(state: State<'_, AppState>) -> Result<BrowserState, AppError> {
    Ok(state.current_browser_state())
}

#[tauri::command]
async fn restart_browser_host(state: State<'_, AppState>) -> Result<BrowserState, AppError> {
    state.force_restart_browser_host().await?;
    Ok(state.current_browser_state())
}

#[tauri::command]
async fn browser_command(
    state: State<'_, AppState>,
    command: BrowserCommand,
) -> Result<Value, AppError> {
    state.apply_browser_remote(command).await
}

#[tauri::command]
async fn browser_surface_bounds<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    request: BrowserBoundsRequest,
) -> Result<Value, AppError> {
    native_compositor::update_bounds(&app, request.clone())?;
    if request.interactive {
        return Ok(json!({ "interactive": true }));
    }
    let width = request.width.round().clamp(1.0, 8_192.0) as u32;
    let height = request.height.round().clamp(1.0, 8_192.0) as u32;
    let command = BrowserCommand::Resize {
        route_id: request.route_id,
        width,
        height,
        scale_factor: request.scale_factor,
        visible: request.visible,
    };
    state.apply_browser_remote(command).await
}

#[tauri::command]
fn stream_terminal(
    state: State<'_, AppState>,
    request: TerminalIdRequest,
    channel: Channel<StreamEnvelope>,
) -> Result<(), AppError> {
    let mut events = state.runtime.terminal_events();
    let sequence = Arc::clone(&state.stream_sequence);
    let process_id = request.process_id;
    tauri::async_runtime::spawn(async move {
        while let Ok(event) = events.recv().await {
            match event {
                onpeople_workspace::TerminalEvent::Output {
                    process_id: event_process_id,
                    data,
                } if event_process_id == process_id
                    && channel
                        .send(StreamEnvelope {
                            sequence: sequence.fetch_add(1, Ordering::Relaxed),
                            kind: StreamKind::Terminal,
                            stream_id: process_id.clone(),
                            payload: json!({ "data": String::from_utf8_lossy(&data) }),
                            terminal: false,
                        })
                        .is_err() =>
                {
                    break;
                }
                onpeople_workspace::TerminalEvent::Exit(exit) if exit.process_id == process_id => {
                    let _ = channel.send(StreamEnvelope {
                        sequence: sequence.fetch_add(1, Ordering::Relaxed),
                        kind: StreamKind::Terminal,
                        stream_id: process_id.clone(),
                        payload: serde_json::to_value(exit).unwrap_or(Value::Null),
                        terminal: true,
                    });
                    break;
                }
                _ => {}
            }
        }
    });
    Ok(())
}

#[tauri::command]
fn stream_agent(
    state: State<'_, AppState>,
    channel: Channel<StreamEnvelope>,
) -> Result<(), AppError> {
    let mut events = state.runtime.subscribe();
    let sequence = Arc::clone(&state.stream_sequence);
    tauri::async_runtime::spawn(async move {
        while let Ok(event) = events.recv().await {
            let stream_id = event
                .thread_id
                .clone()
                .unwrap_or_else(|| "runtime".to_owned());
            if channel
                .send(StreamEnvelope {
                    sequence: sequence.fetch_add(1, Ordering::Relaxed),
                    kind: StreamKind::AgentDelta,
                    stream_id,
                    payload: serde_json::to_value(event).unwrap_or(Value::Null),
                    terminal: false,
                })
                .is_err()
            {
                break;
            }
        }
    });
    Ok(())
}

#[tauri::command]
async fn stream_browser(
    state: State<'_, AppState>,
    channel: Channel<StreamEnvelope>,
) -> Result<(), AppError> {
    state.ensure_browser_ready().await?;
    let mut events = state.browser.subscribe();
    let sequence = Arc::clone(&state.stream_sequence);
    let event_channel = channel.clone();
    tauri::async_runtime::spawn(async move {
        while let Ok(event) = events.recv().await {
            let (stream_id, payload) = match event {
                BrowserHostEvent::Frame(frame) => {
                    if frame.sequence <= 3 {
                        eprintln!(
                            "[onpeople-tauri] browser frame event route={} sequence={}",
                            frame.route_id, frame.sequence
                        );
                    }
                    (
                        frame.route_id.clone(),
                        serde_json::to_value(frame).unwrap_or(Value::Null),
                    )
                }
                BrowserHostEvent::Navigation { route_id, url } => {
                    (route_id, json!({ "kind": "navigation", "url": url }))
                }
                BrowserHostEvent::NewTab { route_id, url } => {
                    (route_id, json!({ "kind": "new-tab", "url": url }))
                }
                BrowserHostEvent::Crash { route_id, message } => {
                    (route_id, json!({ "kind": "crash", "message": message }))
                }
                BrowserHostEvent::State(state) => (
                    state
                        .active_route_id
                        .clone()
                        .unwrap_or_else(|| "browser".to_owned()),
                    serde_json::to_value(state).unwrap_or(Value::Null),
                ),
            };
            if event_channel
                .send(StreamEnvelope {
                    sequence: sequence.fetch_add(1, Ordering::Relaxed),
                    kind: StreamKind::BrowserFrame,
                    stream_id,
                    payload,
                    terminal: false,
                })
                .is_err()
            {
                break;
            }
        }
    });
    Ok(())
}

#[tauri::command]
fn stream_live(
    state: State<'_, AppState>,
    channel: Channel<StreamEnvelope>,
) -> Result<(), AppError> {
    let mut events = state.runtime.subscribe_live();
    let sequence = Arc::clone(&state.stream_sequence);
    tauri::async_runtime::spawn(async move {
        while let Ok(payload) = events.recv().await {
            if channel
                .send(StreamEnvelope {
                    sequence: sequence.fetch_add(1, Ordering::Relaxed),
                    kind: StreamKind::Live,
                    stream_id: payload
                        .get("callId")
                        .and_then(Value::as_str)
                        .unwrap_or("live")
                        .to_owned(),
                    payload,
                    terminal: false,
                })
                .is_err()
            {
                break;
            }
        }
    });
    Ok(())
}

#[tauri::command]
fn list_browser_annotations(
    state: State<'_, AppState>,
    route_id: String,
) -> Result<Vec<BrowserAnnotation>, AppError> {
    Ok(state.browser.annotations(&route_id))
}

#[tauri::command]
fn save_browser_annotation(
    state: State<'_, AppState>,
    annotation: BrowserAnnotation,
) -> Result<BrowserAnnotation, AppError> {
    state.browser.save_annotation(annotation)
}

#[tauri::command]
fn delete_browser_annotation(
    state: State<'_, AppState>,
    request: onpeople_types::IdRequest,
) -> Result<bool, AppError> {
    Ok(state.browser.delete_annotation(&request.id))
}

#[tauri::command]
fn set_terminal_focused(state: State<'_, AppState>, request: Value) -> Result<Value, AppError> {
    state.runtime.set_terminal_focused(
        request
            .get("processId")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
    )
}

#[tauri::command]
fn open_task_window<R: Runtime>(
    app: AppHandle<R>,
    frontend: State<'_, FrontendServer>,
    thread_id: Option<String>,
) -> Result<(), AppError> {
    let suffix = thread_id.unwrap_or_else(|| uuid::Uuid::now_v7().to_string());
    let label = format!("task-{}", suffix.replace('-', ""));
    if app.get_webview_window(&label).is_some() {
        return Ok(());
    }
    let url = frontend.page_url(Some(&format!("thread={suffix}")));
    let navigation_base = frontend.base_url.to_string();
    let window = WebviewWindowBuilder::new(&app, label, WebviewUrl::External(url))
        .title("OnPeople")
        .inner_size(1280.0, 820.0)
        .min_inner_size(960.0, 640.0)
        .on_navigation(move |target| {
            target.as_str() == "about:blank" || target.as_str().starts_with(&navigation_base)
        })
        .build()
        .map_err(AppError::internal)?;
    repair_macos_webview_layout(&window)
}

macro_rules! command_wrapper {
    ($function:ident, $command:literal) => {
        #[tauri::command(rename = $command)]
        async fn $function(
            app: AppHandle,
            state: State<'_, AppState>,
            request: Option<Value>,
        ) -> Result<Value, AppError> {
            state
                .dispatch_command(&app, $command, request.unwrap_or(Value::Null))
                .await
        }
    };
}

command_wrapper!(command_pick_images, "pick_images");
command_wrapper!(command_pick_attachments, "pick_attachments");
command_wrapper!(command_paste_image, "paste_image");
command_wrapper!(command_read_generated_image, "read_generated_image");
command_wrapper!(command_reveal_generated_image, "reveal_generated_image");
command_wrapper!(command_copy_generated_image, "copy_generated_image");
command_wrapper!(command_open_local_artifact, "open_local_artifact");
command_wrapper!(command_new_task, "new_task");
command_wrapper!(command_get_provider_settings, "get_provider_settings");
command_wrapper!(
    command_set_thread_reasoning_effort,
    "set_thread_reasoning_effort"
);
command_wrapper!(command_login_cloud_account, "login_cloud_account");
command_wrapper!(
    command_send_cloud_registration_code,
    "send_cloud_registration_code"
);
command_wrapper!(command_register_cloud_account, "register_cloud_account");
command_wrapper!(command_logout_cloud_account, "logout_cloud_account");
command_wrapper!(command_redeem_cloud_code, "redeem_cloud_code");
command_wrapper!(command_open_cloud_console, "open_cloud_console");
command_wrapper!(command_open_external_url, "open_external_url");
command_wrapper!(command_list_cloud_groups, "list_cloud_groups");
command_wrapper!(command_select_cloud_group, "select_cloud_group");
command_wrapper!(command_get_cloud_usage_profile, "get_cloud_usage_profile");
command_wrapper!(
    command_save_cloud_leaderboard_preference,
    "save_cloud_leaderboard_preference"
);
command_wrapper!(command_create_live_session, "create_live_session");
command_wrapper!(command_close_live_session, "close_live_session");
command_wrapper!(command_check_for_app_update, "check_for_app_update");
command_wrapper!(command_download_app_update, "download_app_update");
command_wrapper!(command_install_app_update, "install_app_update");
command_wrapper!(command_open_app_download, "open_app_download");
command_wrapper!(command_resume_thread, "resume_thread");
command_wrapper!(command_fork_thread, "fork_thread");
command_wrapper!(command_archive_thread, "archive_thread");
command_wrapper!(command_unarchive_thread, "unarchive_thread");
command_wrapper!(command_pin_thread, "pin_thread");
command_wrapper!(command_mark_thread_unread, "mark_thread_unread");
command_wrapper!(command_rename_thread, "rename_thread");
command_wrapper!(command_auto_name_thread, "auto_name_thread");
command_wrapper!(command_reveal_thread, "reveal_thread");
command_wrapper!(command_copy_text, "copy_text");
command_wrapper!(command_read_text, "read_text");
command_wrapper!(
    command_show_terminal_context_menu,
    "show_terminal_context_menu"
);
command_wrapper!(command_pick_project, "pick_project");
command_wrapper!(command_update_project, "update_project");
command_wrapper!(command_reveal_project, "reveal_project");
command_wrapper!(command_archive_project_tasks, "archive_project_tasks");
command_wrapper!(command_ready_terminal, "ready_terminal");
command_wrapper!(command_init_git_repository, "init_git_repository");
command_wrapper!(command_get_git_hunks, "get_git_hunks");
command_wrapper!(command_mutate_git_hunk, "mutate_git_hunk");
command_wrapper!(command_prepare_pull_request, "prepare_pull_request");
command_wrapper!(command_start_review, "start_review");
command_wrapper!(command_submit_review_comments, "submit_review_comments");
command_wrapper!(command_open_editor, "open_editor");
command_wrapper!(command_restart_runtime, "restart_runtime");
command_wrapper!(command_list_extensions, "list_extensions");
command_wrapper!(command_set_skill_enabled, "set_skill_enabled");
command_wrapper!(command_install_plugin, "install_plugin");
command_wrapper!(command_uninstall_plugin, "uninstall_plugin");
command_wrapper!(command_activate_industry_plugin, "activate_industry_plugin");
command_wrapper!(
    command_deactivate_industry_plugin,
    "deactivate_industry_plugin"
);
command_wrapper!(command_reload_mcp, "reload_mcp");
command_wrapper!(command_sync_plugin_catalog, "sync_plugin_catalog");
command_wrapper!(command_start_connector_oauth, "start_connector_oauth");
command_wrapper!(command_complete_connector_oauth, "complete_connector_oauth");
command_wrapper!(command_disconnect_connector, "disconnect_connector");
command_wrapper!(command_validate_model, "validate_model");
command_wrapper!(command_list_agents, "list_agents");
command_wrapper!(command_list_agent_profiles, "list_agent_profiles");
command_wrapper!(command_save_agent_profile, "save_agent_profile");
command_wrapper!(command_delete_agent_profile, "delete_agent_profile");
command_wrapper!(command_spawn_agent, "spawn_agent");
command_wrapper!(command_create_agent_task, "create_agent_task");
command_wrapper!(command_dispatch_agent_task, "dispatch_agent_task");
command_wrapper!(command_remove_agent_task, "remove_agent_task");
command_wrapper!(command_message_agent, "message_agent");
command_wrapper!(command_stop_agent, "stop_agent");
command_wrapper!(command_read_agent, "read_agent");
command_wrapper!(command_list_worktrees, "list_worktrees");
command_wrapper!(command_create_worktree, "create_worktree");
command_wrapper!(command_handoff_worktree, "handoff_worktree");
command_wrapper!(command_snapshot_worktree, "snapshot_worktree");
command_wrapper!(command_remove_worktree, "remove_worktree");
command_wrapper!(command_get_context_state, "get_context_state");
command_wrapper!(command_compact_context, "compact_context");
command_wrapper!(command_recalibrate_context, "recalibrate_context");
command_wrapper!(command_steer_turn, "steer_turn");
command_wrapper!(command_queue_message, "queue_message");
command_wrapper!(command_delete_queued_message, "delete_queued_message");
command_wrapper!(command_steer_queued_message, "steer_queued_message");
command_wrapper!(command_get_policy, "get_policy");
command_wrapper!(command_save_policy, "save_policy");
command_wrapper!(command_pick_download_directory, "pick_download_directory");
command_wrapper!(command_get_effective_config, "get_effective_config");
command_wrapper!(command_list_memories, "list_memories");
command_wrapper!(command_save_memory, "save_memory");
command_wrapper!(command_delete_memory, "delete_memory");
command_wrapper!(command_save_memory_settings, "save_memory_settings");
command_wrapper!(command_get_usage_ledger, "get_usage_ledger");
command_wrapper!(command_save_usage_price, "save_usage_price");
command_wrapper!(command_list_secrets, "list_secrets");
command_wrapper!(command_save_secret, "save_secret");
command_wrapper!(command_delete_secret, "delete_secret");
command_wrapper!(command_list_hooks, "list_hooks");
command_wrapper!(command_list_local_hooks, "list_local_hooks");
command_wrapper!(command_create_hook, "create_hook");
command_wrapper!(command_list_scheduled_tasks, "list_scheduled_tasks");
command_wrapper!(
    command_create_scheduled_task_from_text,
    "create_scheduled_task_from_text"
);
command_wrapper!(command_interrupt, "interrupt");
command_wrapper!(command_resolve_approval, "resolve_approval");
command_wrapper!(command_resolve_user_input, "resolve_user_input");
command_wrapper!(command_browser_navigate, "browser_navigate");
command_wrapper!(
    command_get_quick_launcher_suggestions,
    "get_quick_launcher_suggestions"
);
command_wrapper!(command_get_project_actions, "get_project_actions");
command_wrapper!(command_authorize_project_action, "authorize_project_action");
command_wrapper!(command_open_workspace_file, "open_workspace_file");
command_wrapper!(command_browser_back, "browser_back");
command_wrapper!(command_browser_forward, "browser_forward");
command_wrapper!(command_browser_reload, "browser_reload");
command_wrapper!(
    command_capture_browser_visual_snapshot,
    "capture_browser_visual_snapshot"
);
command_wrapper!(
    command_inspect_browser_developer_state,
    "inspect_browser_developer_state"
);
command_wrapper!(command_begin_browser_annotation, "begin_browser_annotation");
command_wrapper!(
    command_cancel_browser_annotation,
    "cancel_browser_annotation"
);
command_wrapper!(
    command_get_browser_session_status,
    "get_browser_session_status"
);
command_wrapper!(command_open_browser_sign_in, "open_browser_sign_in");
command_wrapper!(command_clear_browser_session, "clear_browser_session");
command_wrapper!(command_clear_all_browser_data, "clear_all_browser_data");
command_wrapper!(
    command_clear_browser_data_from_settings,
    "clear_browser_data_from_settings"
);
command_wrapper!(
    command_fill_saved_browser_credential,
    "fill_saved_browser_credential"
);
command_wrapper!(
    command_list_browser_import_profiles,
    "list_browser_import_profiles"
);
command_wrapper!(command_import_browser_profile, "import_browser_profile");
command_wrapper!(command_attach_browser, "attach_browser");
command_wrapper!(command_activate_browser_tab, "activate_browser_tab");
command_wrapper!(command_detach_browser_tab, "detach_browser_tab");

pub fn run() {
    // reqwest/tauri-updater and tokio-tungstenite enable different rustls
    // crypto backends. Rustls 0.23 refuses to guess when more than one is
    // compiled in; install the backend used by reqwest before any async task
    // can open a network connection.
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let builder = tauri::Builder::default();
    // Isolated preview/test launches intentionally coexist with an installed
    // production build. The single-instance plugin keys off Tauri's compiled
    // identifier (not a post-build Info.plist override), so enabling it here
    // would forward the preview launch to an unrelated running OnPeople app.
    // Production launches keep the normal single-instance behavior.
    let builder = if std::env::var_os("ONPEOPLE_TEST_USER_DATA").is_some() {
        builder
    } else {
        builder.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            let deep_links = argv
                .iter()
                .filter(|value| value.starts_with("onpeople://"))
                .cloned()
                .collect::<Vec<_>>();
            let _ = app.emit(
                "app:second-instance",
                json!({ "argv": argv, "cwd": cwd, "deepLinks": deep_links }),
            );
            if !deep_links.is_empty() {
                if let Some(state) = app.try_state::<AppState>() {
                    state.dispatch_deep_links(app, deep_links);
                } else {
                    let _ = app.emit("app:deep-link", json!({ "urls": deep_links }));
                }
            }
            let _ = app
                .get_webview_window("main")
                .map(|window| window.set_focus());
        }))
    };
    let builder = builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .skip_initial_state("main")
                .build(),
        )
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let frontend = FrontendServer::start(app.handle().clone())?;
            let initial_url = url::Url::parse("about:blank").map_err(AppError::internal)?;
            let navigation_base = frontend.base_url.to_string();
            let preview_on_all_workspaces = std::env::var_os("ONPEOPLE_TEST_USER_DATA").is_some();
            app.manage(frontend);
            setup_app(app.handle())
                .map_err(|error| Box::new(error) as Box<dyn std::error::Error>)?;
            // Do not load the real page while the process is still in the
            // background. WebKit can cache document.visibilityState=hidden
            // for that first navigation and keep returning a white native
            // surface even after the window is later activated. Start with a
            // visible about:blank document and navigate once AppKit owns the
            // foreground instead.
            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(initial_url))
                .title("OnPeople")
                .inner_size(1480.0, 930.0)
                .min_inner_size(1080.0, 720.0)
                // Isolated previews are launched without activation by the
                // native test driver. Keep only those windows available on
                // the active Space so WebKit does not classify them occluded.
                .visible_on_all_workspaces(preview_on_all_workspaces)
                // Keep WKWebView visible while it boots. On macOS, creating
                // the window hidden and revealing it from RunEvent::Ready can
                // leave document.visibilityState as hidden permanently.
                .visible(true)
                .on_navigation(move |target| {
                    target.as_str() == "about:blank"
                        || target.as_str().starts_with(&navigation_base)
                })
                .build()?;
            repair_macos_webview_layout(&window)?;
            schedule_main_window_activation(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            agent_status,
            get_preferences,
            activate_deep_links,
            frontend_ready,
            save_preferences,
            list_threads,
            get_thread_timeline,
            get_runtime_snapshot,
            get_runtime_diagnostics,
            start_runtime,
            stop_runtime,
            send_prompt,
            set_goal,
            update_goal,
            get_provider,
            save_provider,
            start_terminal,
            write_terminal,
            resize_terminal,
            terminate_terminal,
            get_git_state,
            get_git_diff,
            mutate_git,
            commit_git,
            push_git,
            list_project_files,
            search_project_files,
            discover_project_actions,
            get_worktrees,
            get_scheduler,
            open_scheduler,
            create_scheduled_task,
            update_scheduled_task,
            delete_scheduled_task,
            run_scheduled_task,
            mark_scheduled_notifications_read,
            get_live_status,
            request_microphone_access,
            get_cloud_account,
            discover_models,
            get_app_update_state,
            get_browser_state,
            restart_browser_host,
            browser_command,
            browser_surface_bounds,
            stream_terminal,
            stream_agent,
            stream_browser,
            stream_live,
            list_browser_annotations,
            save_browser_annotation,
            delete_browser_annotation,
            set_terminal_focused,
            open_task_window,
            command_pick_images,
            command_pick_attachments,
            command_paste_image,
            command_read_generated_image,
            command_reveal_generated_image,
            command_copy_generated_image,
            command_open_local_artifact,
            command_new_task,
            command_get_provider_settings,
            command_set_thread_reasoning_effort,
            command_login_cloud_account,
            command_send_cloud_registration_code,
            command_register_cloud_account,
            command_logout_cloud_account,
            command_redeem_cloud_code,
            command_open_cloud_console,
            command_open_external_url,
            command_list_cloud_groups,
            command_select_cloud_group,
            command_get_cloud_usage_profile,
            command_save_cloud_leaderboard_preference,
            command_create_live_session,
            command_close_live_session,
            command_check_for_app_update,
            command_download_app_update,
            command_install_app_update,
            command_open_app_download,
            command_resume_thread,
            command_fork_thread,
            command_archive_thread,
            command_unarchive_thread,
            command_pin_thread,
            command_mark_thread_unread,
            command_rename_thread,
            command_auto_name_thread,
            command_reveal_thread,
            command_copy_text,
            command_read_text,
            command_show_terminal_context_menu,
            command_pick_project,
            command_update_project,
            command_reveal_project,
            command_archive_project_tasks,
            command_ready_terminal,
            command_init_git_repository,
            command_get_git_hunks,
            command_mutate_git_hunk,
            command_prepare_pull_request,
            command_start_review,
            command_submit_review_comments,
            command_open_editor,
            command_restart_runtime,
            command_list_extensions,
            command_set_skill_enabled,
            command_install_plugin,
            command_uninstall_plugin,
            command_activate_industry_plugin,
            command_deactivate_industry_plugin,
            command_reload_mcp,
            command_sync_plugin_catalog,
            command_start_connector_oauth,
            command_complete_connector_oauth,
            command_disconnect_connector,
            command_validate_model,
            command_list_agents,
            command_list_agent_profiles,
            command_save_agent_profile,
            command_delete_agent_profile,
            command_spawn_agent,
            command_create_agent_task,
            command_dispatch_agent_task,
            command_remove_agent_task,
            command_message_agent,
            command_stop_agent,
            command_read_agent,
            command_list_worktrees,
            command_create_worktree,
            command_handoff_worktree,
            command_snapshot_worktree,
            command_remove_worktree,
            command_get_context_state,
            command_compact_context,
            command_recalibrate_context,
            command_steer_turn,
            command_queue_message,
            command_delete_queued_message,
            command_steer_queued_message,
            command_get_policy,
            command_save_policy,
            command_pick_download_directory,
            command_get_effective_config,
            command_list_memories,
            command_save_memory,
            command_delete_memory,
            command_save_memory_settings,
            command_get_usage_ledger,
            command_save_usage_price,
            command_list_secrets,
            command_save_secret,
            command_delete_secret,
            command_list_hooks,
            command_list_local_hooks,
            command_create_hook,
            command_list_scheduled_tasks,
            command_create_scheduled_task_from_text,
            command_interrupt,
            command_resolve_approval,
            command_resolve_user_input,
            command_browser_navigate,
            command_get_quick_launcher_suggestions,
            command_get_project_actions,
            command_authorize_project_action,
            command_open_workspace_file,
            command_browser_back,
            command_browser_forward,
            command_browser_reload,
            command_capture_browser_visual_snapshot,
            command_inspect_browser_developer_state,
            command_begin_browser_annotation,
            command_cancel_browser_annotation,
            command_get_browser_session_status,
            command_open_browser_sign_in,
            command_clear_browser_session,
            command_clear_all_browser_data,
            command_clear_browser_data_from_settings,
            command_fill_saved_browser_credential,
            command_list_browser_import_profiles,
            command_import_browser_profile,
            command_attach_browser,
            command_activate_browser_tab,
            command_detach_browser_tab,
        ]);

    builder
        .build(tauri::generate_context!())
        .expect("failed to build OnPeople Tauri application")
        .run(|app, event| {
            match event {
                tauri::RunEvent::Ready => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = activate_isolated_preview_window(&window);
                        let _ = repair_macos_webview_layout(&window);
                        let _ = window.set_focus();
                        if let Some(frontend) = app.try_state::<FrontendServer>() {
                            let page_url = frontend.page_url(
                                std::env::var_os("ONPEOPLE_TEST_USER_DATA")
                                    .is_some()
                                    .then_some("frontendProbe=1"),
                            );
                            let _ = window.navigate(page_url);
                        }
                    }
                    schedule_main_window_activation(app.clone());
                }
                tauri::RunEvent::ExitRequested { code, api, .. }
                    if code != Some(tauri::RESTART_EXIT_CODE)
                        && SHUTDOWN_STARTED
                            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                            .is_ok() =>
                {
                    api.prevent_exit();
                    let app = app.clone();
                    let state = app
                        .try_state::<AppState>()
                        .map(|state| state.inner().clone());
                    tauri::async_runtime::spawn(async move {
                        if let Some(state) = state {
                            let _ = tokio::time::timeout(
                                std::time::Duration::from_secs(5),
                                state.stop(),
                            )
                            .await;
                        }
                        app.exit(code.unwrap_or(0));
                    });
                }
                // AppKit can transition directly to `Exit` for the standard Cmd+Q
                // path. At this point the UI event loop is already terminating,
                // so a bounded synchronous cleanup cannot freeze an interactive
                // window and guarantees sidecars are not re-parented to launchd.
                tauri::RunEvent::Exit => {
                    if let Some(state) = app.try_state::<AppState>() {
                        let state = state.inner().clone();
                        tauri::async_runtime::block_on(async move {
                            let _ = tokio::time::timeout(
                                std::time::Duration::from_secs(5),
                                state.stop(),
                            )
                            .await;
                        });
                    }
                }
                _ => {}
            }
        });
}

#[cfg(test)]
mod tests {
    use onpeople_types::{AppError, ErrorCode};

    use super::{browser_error_kind, workspace_file_preview};

    #[test]
    fn builds_internal_previews_for_markdown_pdf_and_media() {
        let root = std::env::temp_dir().join(format!("onpeople-preview-{}", uuid::Uuid::now_v7()));
        std::fs::create_dir_all(&root).expect("create preview fixture directory");

        let markdown_path = root.join("README.md");
        std::fs::write(&markdown_path, "# Preview\n").expect("write markdown fixture");
        let markdown =
            workspace_file_preview(&root, &markdown_path, None).expect("build markdown preview");
        assert_eq!(markdown["kind"], "text");
        assert_eq!(markdown["mimeType"], "text/markdown");
        assert_eq!(markdown["content"], "# Preview\n");

        let pdf_path = root.join("report.pdf");
        std::fs::write(&pdf_path, b"%PDF-1.4").expect("write pdf fixture");
        let pdf = workspace_file_preview(&root, &pdf_path, None).expect("build pdf preview");
        assert_eq!(pdf["kind"], "pdf");
        assert!(
            pdf["dataUrl"]
                .as_str()
                .is_some_and(|value| value.starts_with("data:application/pdf;base64,"))
        );

        let audio_path = root.join("sample.mp3");
        std::fs::write(&audio_path, b"ID3").expect("write audio fixture");
        let audio = workspace_file_preview(&root, &audio_path, None).expect("build audio preview");
        assert_eq!(audio["kind"], "audio");
        assert_eq!(audio["mimeType"], "audio/mpeg");

        std::fs::remove_dir_all(&root).expect("remove preview fixture directory");
    }

    #[test]
    fn allows_the_local_artifact_command_from_the_desktop_ui() {
        let permissions = include_str!("../permissions/app-commands.toml");
        assert!(
            permissions
                .lines()
                .any(|line| line.trim() == "\"open_local_artifact\","),
            "open_local_artifact must remain in the desktop command permission list"
        );
    }

    #[test]
    fn classifies_spawn_failures_as_startup_failures() {
        let error = AppError::new(ErrorCode::BrowserUnavailable, "无法启动 CEF 浏览器宿主");
        assert_eq!(browser_error_kind(&error), "startup-failed");
    }

    #[test]
    fn classifies_process_exit_separately_from_startup_failure() {
        let error = AppError::new(ErrorCode::ProcessFailed, "CEF 浏览器宿主在启动期间退出");
        assert_eq!(browser_error_kind(&error), "host-exit");
    }

    #[test]
    fn classifies_protocol_and_cef_initialization_failures() {
        let protocol = AppError::new(ErrorCode::BrowserProtocol, "协议版本不匹配");
        assert_eq!(browser_error_kind(&protocol), "protocol-mismatch");

        let cef = AppError::new(ErrorCode::Internal, "CEF 初始化失败");
        assert_eq!(browser_error_kind(&cef), "cef-init-failed");
    }
}
