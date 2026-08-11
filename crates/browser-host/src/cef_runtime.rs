use std::{
    cell::RefCell,
    collections::{HashMap, VecDeque},
    path::PathBuf,
    sync::{
        Arc, Mutex,
        mpsc::{SyncSender, sync_channel},
    },
    time::Duration,
};

#[cfg(target_os = "macos")]
use std::path::Path;

use cef::{args::Args, *};
use onpeople_types::{AppError, ErrorCode};
use serde_json::{Value, json};

use onpeople_browser_host::{
    BrowserCommand, BrowserController, BrowserHostState, BrowserIpc, IpcConfig,
};

const OPAQUE_WHITE: u32 = 0xFFFF_FFFF;

thread_local! {
    static UI_BROWSERS: RefCell<HashMap<String, Browser>> = RefCell::new(HashMap::new());
    static UI_STATE: RefCell<Option<Arc<BrowserHostState>>> = const { RefCell::new(None) };
    static PENDING_ROUTE_IDS: RefCell<VecDeque<String>> = const { RefCell::new(VecDeque::new()) };
    static PENDING_DEVTOOLS: RefCell<HashMap<i32, PendingDevTools>> = RefCell::new(HashMap::new());
    static PENDING_UPLOADS: RefCell<HashMap<i32, PendingDevTools>> = RefCell::new(HashMap::new());
    static NEXT_DEVTOOLS_ID: RefCell<i32> = const { RefCell::new(1) };
    #[cfg(target_os = "macos")]
    static SOFTWARE_SURFACES: RefCell<HashMap<String, SoftwareSurface>> = RefCell::new(HashMap::new());
}

#[cfg(target_os = "macos")]
struct SoftwareSurface {
    surface: objc2_core_foundation::CFRetained<objc2_io_surface::IOSurfaceRef>,
    width: u32,
    height: u32,
    sequence: u64,
}

#[allow(dead_code)]
struct PendingDevTools {
    observer: DevToolsMessageObserver,
    registration: Registration,
}

struct CefCommandRequest {
    command: BrowserCommand,
    response: SyncSender<Result<Value, AppError>>,
}

#[derive(Clone)]
struct CefController {
    queue: Arc<Mutex<VecDeque<CefCommandRequest>>>,
}

impl CefController {
    fn new() -> Self {
        Self {
            queue: Arc::new(Mutex::new(VecDeque::new())),
        }
    }

    fn execute_once(&self, command: BrowserCommand) -> Result<Value, AppError> {
        let (response, receiver) = sync_channel(1);
        self.queue
            .lock()
            .map_err(|_| AppError::internal("CEF UI 命令队列锁定失败"))?
            .push_back(CefCommandRequest { command, response });
        let mut task = UiCommandTask::new(self.queue.clone());
        if post_task(ThreadId::UI, Some(&mut task)) == 0 {
            return Err(AppError::new(
                ErrorCode::BrowserUnavailable,
                "无法投递 CEF UI 命令",
            ));
        }
        receiver
            .recv_timeout(Duration::from_secs(25))
            .map_err(|_| AppError::new(ErrorCode::RuntimeTimeout, "CEF UI 命令超时"))?
    }
}

impl BrowserController for CefController {
    fn execute(&self, command: BrowserCommand) -> Result<Value, AppError> {
        let retryable = matches!(command, BrowserCommand::CreateRoute { .. });
        for attempt in 0..50 {
            match self.execute_once(command.clone()) {
                Err(error)
                    if retryable && error.code == ErrorCode::BrowserUnavailable && attempt < 49 =>
                {
                    std::thread::sleep(Duration::from_millis(100));
                }
                result => return result,
            }
        }
        Err(AppError::new(
            ErrorCode::BrowserUnavailable,
            "CEF 浏览器尚未创建页面",
        ))
    }
}

wrap_task! {
    struct UiCommandTask {
        queue: Arc<Mutex<VecDeque<CefCommandRequest>>>,
    }

    impl Task {
        fn execute(&self) {
            let requests = self
                .queue
                .lock()
                .map(|mut queue| queue.drain(..).collect::<Vec<_>>())
                .unwrap_or_default();
            for request in requests {
                match execute_on_ui(request.command, request.response.clone()) {
                    Ok(Some(result)) => {
                        let _ = request.response.send(Ok(result));
                    }
                    Ok(None) => {}
                    Err(error) => {
                        let _ = request.response.send(Err(error));
                    }
                }
            }
        }
    }
}

fn execute_on_ui(
    command: BrowserCommand,
    response: SyncSender<Result<Value, AppError>>,
) -> Result<Option<Value>, AppError> {
    match command {
        BrowserCommand::Ping => Ok(Some(json!({ "ready": true }))),
        BrowserCommand::ActivateRoute { route_id } => {
            let state = UI_STATE
                .with(|state| state.borrow().clone())
                .ok_or_else(|| {
                    AppError::new(ErrorCode::BrowserUnavailable, "CEF 状态尚未初始化")
                })?;
            state.activate_route(&route_id)?;
            Ok(Some(json!({ "active": route_id })))
        }
        BrowserCommand::CreateRoute {
            route_id,
            thread_id: _,
            url,
        } => {
            let state = UI_STATE
                .with(|state| state.borrow().clone())
                .ok_or_else(|| {
                    AppError::new(ErrorCode::BrowserUnavailable, "CEF 状态尚未初始化")
                })?;
            let url = CefString::from(url.as_str());
            let window_info = WindowInfo {
                windowless_rendering_enabled: 1,
                // Keep the macOS preview on CEF's software OSR path.  The
                // accelerated IOSurface path is only safe once the complete
                // signed helper bundle and GPU context are available; an
                // unsigned preview otherwise enters a GPU crash loop.
                shared_texture_enabled: 0,
                // Let CEF schedule accelerated OSR frames at the configured
                // frame rate. Enabling external begin-frame requires the host
                // to call send_external_begin_frame for every frame; this
                // process has no such scheduler and would otherwise render a
                // permanently blank surface.
                external_begin_frame_enabled: 0,
                ..Default::default()
            };
            let settings = BrowserSettings {
                windowless_frame_rate: 60,
                // CEF enables transparent painting for windowless browsers by
                // default. The native Metal surface composites transparent
                // about:blank pixels as black, so use a stable light canvas.
                background_color: OPAQUE_WHITE,
                ..Default::default()
            };
            PENDING_ROUTE_IDS.with(|routes| routes.borrow_mut().push_back(route_id));
            let mut client = BrowserClient::new(state);
            let created = browser_host_create_browser(
                Some(&window_info),
                Some(&mut client),
                Some(&url),
                Some(&settings),
                None,
                None,
            );
            if created == 0 {
                PENDING_ROUTE_IDS.with(|routes| {
                    let _ = routes.borrow_mut().pop_back();
                });
                return Err(AppError::new(
                    ErrorCode::BrowserUnavailable,
                    "无法创建 CEF 标签页",
                ));
            }
            Ok(Some(json!({ "created": true })))
        }
        BrowserCommand::Navigate { route_id, url } => {
            let browser = browser_for_route(&route_id)?;
            let frame = browser
                .main_frame()
                .ok_or_else(|| AppError::new(ErrorCode::BrowserUnavailable, "CEF 主框架不可用"))?;
            let url = CefString::from(url.as_str());
            frame.load_url(Some(&url));
            Ok(Some(json!({ "navigated": true })))
        }
        BrowserCommand::Back { route_id } => {
            let browser = browser_for_route(&route_id)?;
            let can_go_back = browser.can_go_back() != 0;
            if can_go_back {
                browser.go_back();
            }
            Ok(Some(json!({ "changed": can_go_back })))
        }
        BrowserCommand::Forward { route_id } => {
            let browser = browser_for_route(&route_id)?;
            let can_go_forward = browser.can_go_forward() != 0;
            if can_go_forward {
                browser.go_forward();
            }
            Ok(Some(json!({ "changed": can_go_forward })))
        }
        BrowserCommand::Reload { route_id } => {
            browser_for_route(&route_id)?.reload();
            Ok(Some(json!({ "reloaded": true })))
        }
        BrowserCommand::Resize {
            route_id,
            width: _,
            height: _,
            scale_factor: _,
            visible: _,
        } => {
            let browser = browser_for_route(&route_id)?;
            if let Some(host) = browser.host() {
                host.was_resized();
                host.invalidate(PaintElementType::VIEW);
            }
            Ok(Some(json!({ "resized": true })))
        }
        BrowserCommand::CloseRoute { route_id } => {
            if let Some(browser) = take_browser(&route_id) {
                if let Some(host) = browser.host() {
                    host.close_browser(1);
                }
            }
            Ok(Some(json!({ "closed": true })))
        }
        BrowserCommand::Evaluate {
            route_id,
            expression,
        } => {
            let frame = browser_for_route(&route_id)?
                .main_frame()
                .ok_or_else(|| AppError::new(ErrorCode::BrowserUnavailable, "CEF 主框架不可用"))?;
            let result = evaluate_script(&frame, &expression)?;
            Ok(Some(json!({ "result": result })))
        }
        BrowserCommand::DomSnapshot { route_id } => {
            let browser = browser_for_route(&route_id)?;
            let frame = browser
                .main_frame()
                .ok_or_else(|| AppError::new(ErrorCode::BrowserUnavailable, "CEF 主框架不可用"))?;
            let mut cef_visitor = TextVisitor::new(response, frame_url(&frame));
            frame.text(Some(&mut cef_visitor));
            Ok(None)
        }
        BrowserCommand::VisualSnapshot { route_id } => {
            let browser = browser_for_route(&route_id)?;
            let Some(host) = browser.host() else {
                return Err(AppError::new(
                    ErrorCode::BrowserUnavailable,
                    "CEF 浏览器宿主不可用，无法捕获视觉快照",
                ));
            };
            {
                let mut params = dictionary_value_create().ok_or_else(|| {
                    AppError::new(ErrorCode::BrowserUnavailable, "无法创建 CEF 视觉快照参数")
                })?;
                let format_key = CefString::from("format");
                let format_value = CefString::from("png");
                params.set_string(Some(&format_key), Some(&format_value));
                let message_id = NEXT_DEVTOOLS_ID.with(|next| {
                    let mut next = next.borrow_mut();
                    let value = *next;
                    *next = next.wrapping_add(1).max(1);
                    value
                });
                let observer = VisualSnapshotObserver::new(route_id, response);
                let mut observer_for_registration = observer.clone();
                let Some(registration) =
                    host.add_dev_tools_message_observer(Some(&mut observer_for_registration))
                else {
                    return Err(AppError::new(
                        ErrorCode::BrowserUnavailable,
                        "无法注册 CEF 视觉快照回调",
                    ));
                };
                if host.execute_dev_tools_method(
                    message_id,
                    Some(&CefString::from("Page.captureScreenshot")),
                    Some(&mut params),
                ) == 0
                {
                    return Err(AppError::new(
                        ErrorCode::BrowserUnavailable,
                        "无法请求 CEF 视觉快照",
                    ));
                }
                PENDING_DEVTOOLS.with(|pending| {
                    pending.borrow_mut().insert(
                        message_id,
                        PendingDevTools {
                            observer,
                            registration,
                        },
                    );
                });
            }
            Ok(None)
        }
        BrowserCommand::FrameSnapshot { .. } => Ok(Some(Value::Null)),
        BrowserCommand::FrameConsumed { .. } => Ok(Some(json!({ "consumed": true }))),
        BrowserCommand::DeveloperInspect { route_id } => {
            let browser = browser_for_route(&route_id)?;
            let state = UI_STATE.with(|state| state.borrow().clone());
            let mut value = state
                .as_ref()
                .and_then(|state| state.developer_state(&route_id).ok())
                .and_then(|state| serde_json::to_value(state).ok())
                .unwrap_or_else(|| json!({}));
            if let Some(object) = value.as_object_mut() {
                object.insert(
                    "url".to_owned(),
                    json!(
                        browser
                            .main_frame()
                            .map(|frame| frame_url(&frame))
                            .unwrap_or_default()
                    ),
                );
                object.insert("browserId".to_owned(), json!(browser.identifier()));
                object.insert("loading".to_owned(), json!(browser.is_loading() != 0));
            }
            Ok(Some(value))
        }
        BrowserCommand::StateSnapshot => {
            let state = UI_STATE
                .with(|state| state.borrow().clone())
                .ok_or_else(|| {
                    AppError::new(ErrorCode::BrowserUnavailable, "CEF 状态尚未初始化")
                })?;
            Ok(Some(
                serde_json::to_value(state.state()).map_err(AppError::internal)?,
            ))
        }
        BrowserCommand::Pointer {
            route_id,
            kind,
            x,
            y,
            delta_x,
            delta_y,
            button,
            click_count,
            modifiers,
        } => {
            let browser = browser_for_route(&route_id)?;
            let host = browser.host().ok_or_else(|| {
                AppError::new(ErrorCode::BrowserUnavailable, "CEF 浏览器宿主不可用")
            })?;
            let event = MouseEvent {
                x: x.round() as i32,
                y: y.round() as i32,
                modifiers,
            };
            match kind.as_str() {
                "move" => host.send_mouse_move_event(Some(&event), 0),
                "leave" => host.send_mouse_move_event(Some(&event), 1),
                "wheel" => host.send_mouse_wheel_event(
                    Some(&event),
                    delta_x.round() as i32,
                    delta_y.round() as i32,
                ),
                "down" | "up" => {
                    host.set_focus(1);
                    host.send_mouse_click_event(
                        Some(&event),
                        match button {
                            1 => MouseButtonType::MIDDLE,
                            2 => MouseButtonType::RIGHT,
                            _ => MouseButtonType::LEFT,
                        },
                        i32::from(kind == "up"),
                        click_count,
                    );
                }
                _ => return Err(AppError::invalid("CEF 指针事件类型无效")),
            }
            Ok(Some(json!({ "handled": true })))
        }
        BrowserCommand::Key {
            route_id,
            kind,
            key_code,
            native_key_code,
            character,
            modifiers,
        } => {
            let browser = browser_for_route(&route_id)?;
            let host = browser.host().ok_or_else(|| {
                AppError::new(ErrorCode::BrowserUnavailable, "CEF 浏览器宿主不可用")
            })?;
            host.set_focus(1);
            let unit = character.encode_utf16().next().unwrap_or(0);
            let event = KeyEvent {
                size: std::mem::size_of::<KeyEvent>(),
                type_: if kind == "up" {
                    KeyEventType::KEYUP
                } else {
                    KeyEventType::RAWKEYDOWN
                },
                modifiers,
                windows_key_code: key_code,
                native_key_code,
                is_system_key: i32::from(modifiers & (1 << 3) != 0),
                character: unit,
                unmodified_character: unit,
                focus_on_editable_field: 0,
            };
            host.send_key_event(Some(&event));
            if kind == "down" && unit != 0 && !character.chars().all(char::is_control) {
                let character_event = KeyEvent {
                    type_: KeyEventType::CHAR,
                    ..event
                };
                host.send_key_event(Some(&character_event));
            }
            Ok(Some(json!({ "handled": true })))
        }
        BrowserCommand::Click { route_id, selector } => {
            execute_script(
                &route_id,
                &format!("document.querySelector({}).click()", js_string(&selector)),
            )?;
            Ok(Some(json!({ "clicked": true })))
        }
        BrowserCommand::Hover { route_id, selector } => {
            execute_script(
                &route_id,
                &format!(
                    "document.querySelector({}).dispatchEvent(new MouseEvent('mouseover',{{bubbles:true}}))",
                    js_string(&selector)
                ),
            )?;
            Ok(Some(json!({ "hovered": true })))
        }
        BrowserCommand::Fill {
            route_id,
            selector,
            value,
        } => {
            execute_script(
                &route_id,
                &format!(
                    "(()=>{{const e=document.querySelector({});if(!e)throw new Error('element not found');e.focus();e.value={};e.dispatchEvent(new Event('input',{{bubbles:true}}));e.dispatchEvent(new Event('change',{{bubbles:true}}));}})()",
                    js_string(&selector),
                    js_string(&value)
                ),
            )?;
            Ok(Some(json!({ "filled": true })))
        }
        BrowserCommand::Select {
            route_id,
            selector,
            value,
        } => {
            execute_script(
                &route_id,
                &format!(
                    "(()=>{{const e=document.querySelector({});if(!e)throw new Error('element not found');e.value={};e.dispatchEvent(new Event('input',{{bubbles:true}}));e.dispatchEvent(new Event('change',{{bubbles:true}}));}})()",
                    js_string(&selector),
                    js_string(&value)
                ),
            )?;
            Ok(Some(json!({ "selected": true })))
        }
        BrowserCommand::Upload {
            route_id,
            selector,
            paths,
        } => {
            let browser = browser_for_route(&route_id)?;
            let Some(host) = browser.host() else {
                return Err(AppError::new(
                    ErrorCode::BrowserUnavailable,
                    "CEF 浏览器宿主不可用，无法上传文件",
                ));
            };
            let params = dictionary_value_create().ok_or_else(|| {
                AppError::new(ErrorCode::BrowserUnavailable, "无法创建 CEF 上传参数")
            })?;
            let depth_key = CefString::from("depth");
            let pierce_key = CefString::from("pierce");
            let _ = params.set_int(Some(&depth_key), -1);
            let _ = params.set_bool(Some(&pierce_key), 1);
            start_upload_stage(
                &browser,
                host,
                route_id,
                selector,
                paths,
                0,
                params,
                "DOM.getDocument",
                response,
            )?;
            Ok(None)
        }
        BrowserCommand::Press { route_id, key } => {
            execute_script(
                &route_id,
                &format!(
                    "document.activeElement?.dispatchEvent(new KeyboardEvent('keydown',{{key:{}}}))",
                    js_string(&key)
                ),
            )?;
            Ok(Some(json!({ "pressed": true })))
        }
        BrowserCommand::Scroll { route_id, x, y } => {
            execute_script(&route_id, &format!("window.scrollTo({}, {})", x, y))?;
            Ok(Some(json!({ "scrolled": true })))
        }
        BrowserCommand::Wait {
            route_id,
            expression,
            timeout_ms: _,
        } => {
            execute_script(&route_id, &expression)?;
            Ok(Some(json!({ "ready": true })))
        }
    }
}

fn execute_script(route_id: &str, script: &str) -> Result<(), AppError> {
    let frame = browser_for_route(route_id)?
        .main_frame()
        .ok_or_else(|| AppError::new(ErrorCode::BrowserUnavailable, "CEF 主框架不可用"))?;
    let code = CefString::from(script);
    frame.execute_java_script(Some(&code), None, 0);
    Ok(())
}

fn evaluate_script(frame: &Frame, expression: &str) -> Result<Value, AppError> {
    let context = frame.v8_context().ok_or_else(|| {
        AppError::new(ErrorCode::BrowserUnavailable, "CEF JavaScript 上下文不可用")
    })?;
    let code = CefString::from(format!("JSON.stringify(({expression}))").as_str());
    let mut value = None;
    let mut exception = None;
    if context.enter() == 0 {
        return Err(AppError::new(
            ErrorCode::BrowserUnavailable,
            "无法进入 CEF JavaScript 上下文",
        ));
    }
    let evaluated = context.eval(Some(&code), None, 0, Some(&mut value), Some(&mut exception));
    let _ = context.exit();
    if evaluated == 0 {
        let message = exception
            .as_ref()
            .map(|error| userfree_string(error.message()))
            .unwrap_or_else(|| "浏览器表达式执行失败".to_owned());
        return Err(AppError::new(ErrorCode::BrowserProtocol, message));
    }
    let Some(value) = value else {
        return Ok(Value::Null);
    };
    if value.is_undefined() != 0 || value.is_null() != 0 {
        return Ok(Value::Null);
    }
    if value.is_string() == 0 {
        return Err(AppError::new(
            ErrorCode::BrowserProtocol,
            "CEF JavaScript 未返回可序列化结果",
        ));
    }
    let serialized = userfree_string(value.string_value());
    serde_json::from_str(&serialized).map_err(|error| {
        AppError::new(
            ErrorCode::BrowserProtocol,
            "CEF JavaScript 结果不是有效 JSON",
        )
        .context("cause", error)
    })
}

fn userfree_string(value: CefStringUserfree) -> String {
    let utf16 = CefStringUtf16::from(&value);
    CefStringUtf8::from(&utf16).to_string()
}

fn js_string(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "null".to_owned())
}

wrap_dev_tools_message_observer! {
    struct VisualSnapshotObserver {
        route_id: String,
        response: SyncSender<Result<Value, AppError>>,
    }

    impl DevToolsMessageObserver {
        fn on_dev_tools_method_result(
            &self,
            _browser: Option<&mut Browser>,
            message_id: i32,
            success: i32,
            result: Option<&[u8]>,
        ) {
            let value = if success == 0 {
                Err(AppError::new(
                    ErrorCode::BrowserProtocol,
                    "CEF 视觉快照请求失败",
                ))
            } else {
                let payload = result
                    .and_then(|bytes| serde_json::from_slice::<Value>(bytes).ok())
                    .ok_or_else(|| {
                        AppError::new(
                            ErrorCode::BrowserProtocol,
                            "CEF 视觉快照响应无效",
                        )
                    });
                match payload {
                    Ok(payload) => payload
                        .get("data")
                        .and_then(Value::as_str)
                        .filter(|data| !data.is_empty())
                        .map(|data| {
                            Ok(json!({
                                "routeId": self.route_id,
                                "capturedAt": chrono::Utc::now(),
                                "mimeType": "image/png",
                                "imageBase64": data,
                            }))
                        })
                        .unwrap_or_else(|| {
                            Err(AppError::new(
                                ErrorCode::BrowserProtocol,
                                "CEF 视觉快照响应缺少 PNG 数据",
                            ))
                        }),
                    Err(error) => Err(error),
                }
            };
            let _ = self.response.send(value);
            PENDING_DEVTOOLS.with(|pending| {
                pending.borrow_mut().remove(&message_id);
            });
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn start_upload_stage(
    browser: &Browser,
    host: BrowserHost,
    route_id: String,
    selector: String,
    paths: Vec<String>,
    stage: i32,
    mut params: DictionaryValue,
    method: &str,
    response: SyncSender<Result<Value, AppError>>,
) -> Result<(), AppError> {
    let message_id = NEXT_DEVTOOLS_ID.with(|next| {
        let mut next = next.borrow_mut();
        let value = *next;
        *next = next.wrapping_add(1).max(1);
        value
    });
    let observer = UploadObserver::new(route_id, selector, paths, stage, response);
    let mut observer_for_registration = observer.clone();
    let Some(registration) =
        host.add_dev_tools_message_observer(Some(&mut observer_for_registration))
    else {
        return Err(AppError::new(
            ErrorCode::BrowserUnavailable,
            "无法注册 CEF 上传回调",
        ));
    };
    if host.execute_dev_tools_method(
        message_id,
        Some(&CefString::from(method)),
        Some(&mut params),
    ) == 0
    {
        return Err(AppError::new(
            ErrorCode::BrowserUnavailable,
            "无法请求 CEF 上传操作",
        ));
    }
    let _ = browser;
    PENDING_UPLOADS.with(|pending| {
        pending.borrow_mut().insert(
            message_id,
            PendingDevTools {
                observer,
                registration,
            },
        );
    });
    Ok(())
}

fn devtools_payload(success: i32, result: Option<&[u8]>) -> Result<Value, AppError> {
    if success == 0 {
        return Err(AppError::new(
            ErrorCode::BrowserProtocol,
            "CEF 浏览器开发者协议请求失败",
        ));
    }
    result
        .and_then(|bytes| serde_json::from_slice::<Value>(bytes).ok())
        .ok_or_else(|| AppError::new(ErrorCode::BrowserProtocol, "CEF 开发者协议响应无效"))
}

wrap_dev_tools_message_observer! {
    struct UploadObserver {
        route_id: String,
        selector: String,
        paths: Vec<String>,
        stage: i32,
        response: SyncSender<Result<Value, AppError>>,
    }

    impl DevToolsMessageObserver {
        fn on_dev_tools_method_result(
            &self,
            browser: Option<&mut Browser>,
            message_id: i32,
            success: i32,
            result: Option<&[u8]>,
        ) {
            PENDING_UPLOADS.with(|pending| {
                let _ = pending.borrow_mut().remove(&message_id);
            });
            let payload = match devtools_payload(success, result) {
                Ok(payload) => payload,
                Err(error) => {
                    let _ = self.response.send(Err(error));
                    return;
                }
            };
            if self.stage == 0 {
                let Some(node_id) = payload
                    .get("root")
                    .and_then(|root| root.get("nodeId"))
                    .and_then(Value::as_i64)
                    .and_then(|value| i32::try_from(value).ok())
                else {
                    let _ = self.response.send(Err(AppError::new(
                        ErrorCode::BrowserProtocol,
                        "CEF DOM 文档没有根节点",
                    )));
                    return;
                };
                let Some(browser) = browser else {
                    let _ = self.response.send(Err(AppError::new(
                        ErrorCode::BrowserUnavailable,
                        "CEF 浏览器已关闭，无法继续上传",
                    )));
                    return;
                };
                let Some(host) = browser.host() else {
                    let _ = self.response.send(Err(AppError::new(
                        ErrorCode::BrowserUnavailable,
                        "CEF 浏览器宿主不可用，无法继续上传",
                    )));
                    return;
                };
                let Some(params) = dictionary_value_create() else {
                    let _ = self
                        .response
                        .send(Err(AppError::internal("无法创建 CEF DOM 查询参数")));
                    return;
                };
                let node_key = CefString::from("nodeId");
                let selector_key = CefString::from("selector");
                let selector = CefString::from(self.selector.as_str());
                let _ = params.set_int(Some(&node_key), node_id);
                let _ = params.set_string(Some(&selector_key), Some(&selector));
                if let Err(error) = start_upload_stage(
                    browser,
                    host,
                    self.route_id.clone(),
                    self.selector.clone(),
                    self.paths.clone(),
                    1,
                    params,
                    "DOM.querySelector",
                    self.response.clone(),
                ) {
                    let _ = self.response.send(Err(error));
                }
                return;
            }
            if self.stage == 1 {
                let Some(node_id) = payload
                    .get("nodeId")
                    .and_then(Value::as_i64)
                    .and_then(|value| i32::try_from(value).ok())
                else {
                    let _ = self.response.send(Err(AppError::new(
                        ErrorCode::NotFound,
                        "上传目标元素不存在，请重新获取浏览器快照",
                    )));
                    return;
                };
                let Some(browser) = browser else {
                    let _ = self.response.send(Err(AppError::new(
                        ErrorCode::BrowserUnavailable,
                        "CEF 浏览器已关闭，无法继续上传",
                    )));
                    return;
                };
                let Some(host) = browser.host() else {
                    let _ = self.response.send(Err(AppError::new(
                        ErrorCode::BrowserUnavailable,
                        "CEF 浏览器宿主不可用，无法继续上传",
                    )));
                    return;
                };
                let Some(mut files) = list_value_create() else {
                    let _ = self.response.send(Err(AppError::internal(
                        "无法创建 CEF 文件列表",
                    )));
                    return;
                };
                let _ = files.set_size(self.paths.len());
                for (index, path) in self.paths.iter().enumerate() {
                    let path = CefString::from(path.as_str());
                    let _ = files.set_string(index, Some(&path));
                }
                let Some(params) = dictionary_value_create() else {
                    let _ = self
                        .response
                        .send(Err(AppError::internal("无法创建 CEF 文件上传参数")));
                    return;
                };
                let node_key = CefString::from("nodeId");
                let files_key = CefString::from("files");
                let _ = params.set_int(Some(&node_key), node_id);
                let _ = params.set_list(Some(&files_key), Some(&mut files));
                if let Err(error) = start_upload_stage(
                    browser,
                    host,
                    self.route_id.clone(),
                    self.selector.clone(),
                    self.paths.clone(),
                    2,
                    params,
                    "DOM.setFileInputFiles",
                    self.response.clone(),
                ) {
                    let _ = self.response.send(Err(error));
                }
                return;
            }
            let uploaded = self
                .paths
                .iter()
                .map(|path| {
                    std::path::Path::new(path)
                        .file_name()
                        .and_then(|name| name.to_str())
                        .unwrap_or("file")
                })
                .collect::<Vec<_>>();
            let _ = self.response.send(Ok(json!({
                "routeId": self.route_id,
                "uploaded": uploaded,
                "verified": true,
            })));
        }
    }
}

fn frame_url(frame: &Frame) -> String {
    let value = frame.url();
    let utf16 = CefStringUtf16::from(&value);
    CefStringUtf8::from(&utf16).to_string()
}

fn browser_for_route(route_id: &str) -> Result<Browser, AppError> {
    UI_BROWSERS.with(|browsers| {
        browsers
            .borrow()
            .get(route_id)
            .cloned()
            .ok_or_else(|| AppError::new(ErrorCode::NotFound, "CEF 浏览器路由不存在"))
    })
}

fn route_id_for_browser(browser: &Browser) -> String {
    UI_BROWSERS.with(|browsers| {
        browsers
            .borrow()
            .iter()
            .find(|(route_id, candidate)| {
                !route_id.starts_with("__cef_") && candidate.identifier() == browser.identifier()
            })
            .map(|(route_id, _)| route_id.clone())
            .unwrap_or_else(|| format!("cef-{}", browser.identifier()))
    })
}

fn download_directory() -> PathBuf {
    if let Some(path) = std::env::var_os("ONPEOPLE_DOWNLOAD_DIR") {
        return PathBuf::from(path);
    }
    if let Some(home) = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }) {
        return PathBuf::from(home).join("Downloads");
    }
    PathBuf::from("downloads")
}

fn safe_download_name(value: Option<&CefString>) -> String {
    let name = value.map(ToString::to_string).unwrap_or_default();
    let candidate = std::path::Path::new(&name)
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("download");
    candidate
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric()
                || matches!(character, '.' | '-' | '_' | ' ' | '(' | ')')
            {
                character
            } else {
                '_'
            }
        })
        .collect::<String>()
}

fn take_browser(route_id: &str) -> Option<Browser> {
    UI_BROWSERS.with(|browsers| browsers.borrow_mut().remove(route_id))
}

#[cfg(target_os = "macos")]
#[allow(unsafe_code)]
fn accelerated_surface_handle(info: &AcceleratedPaintInfo) -> String {
    // A CEF IOSurface pointer is only meaningful inside the browser-host
    // process and only for the duration of this callback.  IOSurface IDs are
    // the process-independent rendezvous value used by the native compositor
    // in the Tauri shell.
    #[link(name = "IOSurface", kind = "framework")]
    unsafe extern "C" {
        fn IOSurfaceGetID(surface: *mut std::ffi::c_void) -> u32;
    }
    let id = if info.shared_texture_io_surface.is_null() {
        0
    } else {
        // SAFETY: CEF provides a valid IOSurfaceRef for this callback when the
        // accelerated paint handle is non-null.
        unsafe { IOSurfaceGetID(info.shared_texture_io_surface) }
    };
    format!("iosurface:{id}")
}

#[cfg(windows)]
fn accelerated_surface_handle(info: &AcceleratedPaintInfo) -> String {
    // The D3D11 shared handle is valid in the target process only after the
    // shell imports it with ID3D11Device::OpenSharedResource.  Keep the value
    // opaque on the wire as an integer token; never expose a Rust pointer
    // formatting artifact.
    format!("d3d11:{:x}", info.shared_texture_handle as usize)
}

#[cfg(not(any(target_os = "macos", windows)))]
fn accelerated_surface_handle(info: &AcceleratedPaintInfo) -> String {
    format!("shared-texture:{:p}", info.shared_texture_io_surface)
}

wrap_string_visitor! {
    struct TextVisitor {
        response: SyncSender<Result<Value, AppError>>,
        url: String,
    }

    impl CefStringVisitor {
        fn visit(&self, string: Option<&CefString>) {
            let text = string.map(ToString::to_string).unwrap_or_default();
            let _ = self
                .response
                .send(Ok(json!({ "text": text, "url": self.url.clone() })));
        }
    }
}

wrap_app! {
    struct BrowserApp {
        state: Arc<Mutex<Option<Arc<BrowserHostState>>>>,
    }

    impl App {
        fn on_before_command_line_processing(
            &self,
            process_type: Option<&CefString>,
            command_line: Option<&mut CommandLine>,
        ) {
            #[cfg(target_os = "macos")]
            if process_type.is_none_or(|value| value.to_string().is_empty())
                && let Some(command_line) = command_line
            {
                // CEF's GPU subprocess is unstable in the current unsigned
                // macOS preview bundle.  Disable the GPU compositor before
                // CEF creates child processes so the browser remains alive
                // and the shell can use the normal software OSR/screenshot
                // path.  This is intentionally applied through CEF's app
                // callback, matching the host-owned lifecycle used by Codex.
                for switch in [
                    "disable-gpu",
                    "disable-gpu-compositing",
                    "disable-gpu-rasterization",
                ] {
                    let switch = CefString::from(switch);
                    command_line.append_switch(Some(&switch));
                }
            }
        }

        fn browser_process_handler(&self) -> Option<BrowserProcessHandler> {
            Some(BrowserProcessHandlerImpl::new(self.state.clone()))
        }
    }
}

wrap_browser_process_handler! {
    struct BrowserProcessHandlerImpl {
        state: Arc<Mutex<Option<Arc<BrowserHostState>>>>,
    }

    impl BrowserProcessHandler {
        fn on_context_initialized(&self) {
            let Some(state) = self.state.lock().ok().and_then(|guard| guard.clone()) else {
                return;
            };
            UI_STATE.with(|current| current.replace(Some(state.clone())));
            let start_url = std::env::var("ONPEOPLE_BROWSER_START_URL")
                .unwrap_or_else(|_| "about:blank".to_owned());
            let url = CefString::from(start_url.as_str());
            let window_info = WindowInfo {
                windowless_rendering_enabled: 1,
                shared_texture_enabled: 0,
                external_begin_frame_enabled: 0,
                ..Default::default()
            };
            let settings = BrowserSettings {
                windowless_frame_rate: 60,
                background_color: OPAQUE_WHITE,
                ..Default::default()
            };
            let mut client = BrowserClient::new(state);
            browser_host_create_browser(
                Some(&window_info),
                Some(&mut client),
                Some(&url),
                Some(&settings),
                None,
                None,
            );
        }
    }
}

wrap_client! {
    struct BrowserClient {
        state: Arc<BrowserHostState>,
    }

    impl Client {
        fn life_span_handler(&self) -> Option<LifeSpanHandler> {
            Some(LifeSpanHandlerImpl::new(self.state.clone()))
        }

        fn render_handler(&self) -> Option<RenderHandler> {
            Some(RenderHandlerImpl::new(self.state.clone()))
        }

        fn display_handler(&self) -> Option<DisplayHandler> {
            Some(DisplayHandlerImpl::new(self.state.clone()))
        }

        fn load_handler(&self) -> Option<LoadHandler> {
            Some(LoadHandlerImpl::new(self.state.clone()))
        }

        fn request_handler(&self) -> Option<RequestHandler> {
            Some(RequestHandlerImpl::new(self.state.clone()))
        }

        fn download_handler(&self) -> Option<DownloadHandler> {
            Some(DownloadHandlerImpl::new())
        }
    }
}

wrap_display_handler! {
    struct DisplayHandlerImpl {
        state: Arc<BrowserHostState>,
    }

    impl DisplayHandler {
        fn on_address_change(
            &self,
            browser: Option<&mut Browser>,
            frame: Option<&mut Frame>,
            url: Option<&CefString>,
        ) {
            if frame.as_deref().is_some_and(|frame| frame.is_main() == 0) {
                return;
            }
            let (Some(browser), Some(url)) = (browser, url) else {
                return;
            };
            self.state
                .update_address(&route_id_for_browser(browser), url.to_string());
        }

        fn on_title_change(&self, browser: Option<&mut Browser>, title: Option<&CefString>) {
            let Some(browser) = browser else { return };
            self.state.update_title(
                &route_id_for_browser(browser),
                title.map(ToString::to_string).unwrap_or_default(),
            );
        }

        fn on_console_message(
            &self,
            browser: Option<&mut Browser>,
            level: LogSeverity,
            message: Option<&CefString>,
            source: Option<&CefString>,
            line: i32,
        ) -> i32 {
            let Some(browser) = browser else { return 0 };
            self.state.record_console(
                &route_id_for_browser(browser),
                json!({
                    "level": format!("{level:?}"),
                    "message": message.map(ToString::to_string).unwrap_or_default(),
                    "source": source.map(ToString::to_string).unwrap_or_default(),
                    "line": line,
                }),
            );
            0
        }
    }
}

wrap_load_handler! {
    struct LoadHandlerImpl {
        state: Arc<BrowserHostState>,
    }

    impl LoadHandler {
        fn on_loading_state_change(
            &self,
            browser: Option<&mut Browser>,
            is_loading: i32,
            can_go_back: i32,
            can_go_forward: i32,
        ) {
            let Some(browser) = browser else { return };
            self.state.update_loading(
                &route_id_for_browser(browser),
                is_loading != 0,
                can_go_back != 0,
                can_go_forward != 0,
            );
        }

        fn on_load_start(
            &self,
            browser: Option<&mut Browser>,
            frame: Option<&mut Frame>,
            transition_type: TransitionType,
        ) {
            if frame.as_deref().is_some_and(|frame| frame.is_main() == 0) {
                return;
            }
            let (Some(browser), Some(frame)) = (browser, frame) else {
                return;
            };
            self.state.record_network(
                &route_id_for_browser(browser),
                json!({
                    "phase": "start",
                    "url": frame_url(frame),
                    "transition": format!("{transition_type:?}"),
                }),
            );
        }

        fn on_load_end(
            &self,
            browser: Option<&mut Browser>,
            frame: Option<&mut Frame>,
            http_status_code: i32,
        ) {
            if frame.as_deref().is_some_and(|frame| frame.is_main() == 0) {
                return;
            }
            let (Some(browser), Some(frame)) = (browser, frame) else {
                return;
            };
            self.state.record_network(
                &route_id_for_browser(browser),
                json!({
                    "phase": "end",
                    "url": frame_url(frame),
                    "status": http_status_code,
                }),
            );
        }

        fn on_load_error(
            &self,
            browser: Option<&mut Browser>,
            frame: Option<&mut Frame>,
            error_code: Errorcode,
            error_text: Option<&CefString>,
            failed_url: Option<&CefString>,
        ) {
            if frame.as_deref().is_some_and(|frame| frame.is_main() == 0) {
                return;
            }
            let Some(browser) = browser else { return };
            let route_id = route_id_for_browser(browser);
            self.state.record_network(
                &route_id,
                json!({
                    "phase": "error",
                    "url": failed_url.map(ToString::to_string).unwrap_or_default(),
                    "error": format!("{error_code:?}"),
                    "message": error_text.map(ToString::to_string).unwrap_or_default(),
                }),
            );
            self.state.update_loading(
                &route_id,
                false,
                browser.can_go_back() != 0,
                browser.can_go_forward() != 0,
            );
        }
    }
}

wrap_request_handler! {
    struct RequestHandlerImpl {
        state: Arc<BrowserHostState>,
    }

    impl RequestHandler {
        fn on_render_process_terminated(
            &self,
            browser: Option<&mut Browser>,
            status: TerminationStatus,
            error_code: i32,
            error_string: Option<&CefString>,
        ) {
            let Some(browser) = browser else { return };
            let route_id = route_id_for_browser(browser);
            self.state.report_crash(
                &route_id,
                format!(
                    "CEF renderer {status:?} ({error_code}): {}",
                    error_string.map(ToString::to_string).unwrap_or_default()
                ),
            );
            browser.reload();
        }
    }
}

wrap_download_handler! {
    struct DownloadHandlerImpl;

    impl DownloadHandler {
        fn on_before_download(
            &self,
            _browser: Option<&mut Browser>,
            _download_item: Option<&mut DownloadItem>,
            suggested_name: Option<&CefString>,
            callback: Option<&mut BeforeDownloadCallback>,
        ) -> i32 {
            let directory = download_directory();
            if let Err(error) = std::fs::create_dir_all(&directory) {
                tracing::warn!(error = %error, "无法创建浏览器下载目录");
                return 0;
            }
            let path = directory.join(safe_download_name(suggested_name));
            let path_value = CefString::from(path.to_string_lossy().as_ref());
            if let Some(callback) = callback {
                callback.cont(Some(&path_value), 0);
                return 1;
            }
            0
        }
    }
}

wrap_life_span_handler! {
    struct LifeSpanHandlerImpl {
        state: Arc<BrowserHostState>,
    }

    impl LifeSpanHandler {
        fn on_before_popup(
            &self,
            browser: Option<&mut Browser>,
            _frame: Option<&mut Frame>,
            _popup_id: i32,
            target_url: Option<&CefString>,
            _target_frame_name: Option<&CefString>,
            _target_disposition: WindowOpenDisposition,
            _user_gesture: i32,
            _popup_features: Option<&PopupFeatures>,
            window_info: Option<&mut WindowInfo>,
            client: Option<&mut Option<Client>>,
            settings: Option<&mut BrowserSettings>,
            _extra_info: Option<&mut Option<DictionaryValue>>,
            _no_javascript_access: Option<&mut i32>,
        ) -> i32 {
            let Some(url) = target_url.map(ToString::to_string) else {
                return 1;
            };
            let route_id = format!("browser-tab-{}", uuid::Uuid::now_v7());
            if let Some(browser) = browser {
                let parent_route = route_id_for_browser(browser);
                let _ = self
                    .state
                    .register_popup_route(route_id.clone(), &parent_route, url);
                PENDING_ROUTE_IDS.with(|routes| routes.borrow_mut().push_back(route_id.clone()));
                if let Some(window_info) = window_info {
                    window_info.windowless_rendering_enabled = 1;
                    window_info.shared_texture_enabled = 0;
                    window_info.external_begin_frame_enabled = 0;
                }
                if let Some(client) = client {
                    *client = Some(BrowserClient::new(self.state.clone()));
                }
                if let Some(settings) = settings {
                    settings.windowless_frame_rate = 60;
                    settings.background_color = OPAQUE_WHITE;
                }
                tracing::debug!(
                    parent_route = %parent_route,
                    route_id = %route_id,
                    "CEF popup converted to a new browser route"
                );
                return 0;
            }
            1
        }

        fn on_after_created(&self, browser: Option<&mut Browser>) {
            if let Some(browser) = browser {
                UI_BROWSERS.with(|browsers| {
                    let route_id = PENDING_ROUTE_IDS
                        .with(|routes| routes.borrow_mut().pop_front())
                        .unwrap_or_else(|| format!("__cef_{}", browser.identifier()));
                    browsers.borrow_mut().insert(route_id, browser.clone());
                });
            }
        }

        fn on_before_close(&self, browser: Option<&mut Browser>) {
            if let Some(browser) = browser {
                UI_BROWSERS.with(|browsers| {
                    browsers
                        .borrow_mut()
                        .retain(|_, candidate| candidate.identifier() != browser.identifier());
                });
            }
        }
    }
}

wrap_render_handler! {
    struct RenderHandlerImpl {
        state: Arc<BrowserHostState>,
    }

    impl RenderHandler {
        fn view_rect(&self, browser: Option<&mut Browser>, rect: Option<&mut Rect>) {
            if let Some(rect) = rect {
                let route_id = browser
                    .as_ref()
                    .map(|browser| route_id_for_browser(browser))
                    .unwrap_or_else(|| "cef-main".to_owned());
                let (width, height, _) = self.state.route_dimensions(&route_id);
                rect.width = width as i32;
                rect.height = height as i32;
            }
        }

        fn screen_info(
            &self,
            browser: Option<&mut Browser>,
            screen_info: Option<&mut ScreenInfo>,
        ) -> i32 {
            if let Some(screen_info) = screen_info {
                let route_id = browser
                    .as_ref()
                    .map(|browser| route_id_for_browser(browser))
                    .unwrap_or_else(|| "cef-main".to_owned());
                let (_, _, scale_factor) = self.state.route_dimensions(&route_id);
                screen_info.device_scale_factor = scale_factor as f32;
                return 1;
            }
            0
        }

        #[cfg(feature = "accelerated-osr")]
        fn on_accelerated_paint(
            &self,
            browser: Option<&mut Browser>,
            type_: PaintElementType,
            _dirty_rects: Option<&[Rect]>,
            info: Option<&AcceleratedPaintInfo>,
        ) {
            let Some(info) = info else { return };
            if type_ != PaintElementType::default() {
                return;
            }
            let route_id = browser
                .as_ref()
                .map(|browser| route_id_for_browser(browser))
                .unwrap_or_else(|| "cef-main".to_owned());
            let (_, _, scale_factor) = self.state.route_dimensions(&route_id);
            let frame = onpeople_types::BrowserFrame {
                route_id,
                sequence: info.extra.capture_counter,
                width: info.extra.coded_size.width.max(1) as u32,
                height: info.extra.coded_size.height.max(1) as u32,
                scale_factor,
                surface_kind: if cfg!(target_os = "macos") {
                    "iosurface".to_owned()
                } else if cfg!(windows) {
                    "d3d11-shared-texture".to_owned()
                } else {
                    "shared-texture".to_owned()
                },
                surface_handle: accelerated_surface_handle(info),
                damage_rects: Vec::new(),
            };
            let _ = self.state.emit_frame_and_wait(frame);
        }

        fn on_paint(
            &self,
            browser: Option<&mut Browser>,
            type_: PaintElementType,
            dirty_rects: Option<&[Rect]>,
            buffer: *const u8,
            width: i32,
            height: i32,
        ) {
            #[cfg(target_os = "macos")]
            {
                if type_ != PaintElementType::default()
                    || buffer.is_null()
                    || width <= 0
                    || height <= 0
                {
                    return;
                }
                let route_id = browser
                    .as_ref()
                    .map(|browser| route_id_for_browser(browser))
                    .unwrap_or_else(|| "cef-main".to_owned());
                let scale_factor = self.state.route_dimensions(&route_id).2;
                if let Some(frame) = software_iosurface_frame(
                    route_id,
                    buffer,
                    width as u32,
                    height as u32,
                    dirty_rects,
                    scale_factor,
                ) {
                    let _ = self.state.emit_frame_and_wait(frame);
                }
            }
        }
    }
}

#[cfg(target_os = "macos")]
#[allow(unsafe_code, deprecated)]
fn software_iosurface_frame(
    route_id: String,
    buffer: *const u8,
    width: u32,
    height: u32,
    dirty_rects: Option<&[Rect]>,
    scale_factor: f64,
) -> Option<onpeople_types::BrowserFrame> {
    use objc2_core_foundation::{CFBoolean, CFDictionary, CFNumber, CFType};
    use objc2_io_surface::{
        IOSurfaceLockOptions, IOSurfaceRef, kIOSurfaceAllocSize, kIOSurfaceBytesPerElement,
        kIOSurfaceBytesPerRow, kIOSurfaceHeight, kIOSurfaceIsGlobal, kIOSurfacePixelFormat,
        kIOSurfaceWidth,
    };

    const BGRA_PIXEL_FORMAT: i32 = i32::from_be_bytes(*b"BGRA");
    let source_row_bytes = usize::try_from(width).ok()?.checked_mul(4)?;
    // Metal validates IOSurface row strides with a device-dependent linear
    // texture alignment. Apple GPUs currently require at most 256 bytes, so
    // use that conservative alignment instead of a tightly packed stride.
    // A non-aligned stride makes newTextureWithDescriptor abort the process.
    let surface_row_bytes = source_row_bytes.checked_add(255)? & !255;
    let source_size = surface_row_bytes.checked_mul(usize::try_from(height).ok()?)?;

    SOFTWARE_SURFACES.with(|surfaces| {
        let mut surfaces = surfaces.borrow_mut();
        let needs_surface = surfaces
            .get(&route_id)
            .is_none_or(|current| current.width != width || current.height != height);
        if needs_surface {
            let width_value = CFNumber::new_isize(width as isize);
            let height_value = CFNumber::new_isize(height as isize);
            let row_bytes_value = CFNumber::new_isize(surface_row_bytes as isize);
            let element_bytes_value = CFNumber::new_isize(4);
            let alloc_size_value = CFNumber::new_isize(source_size as isize);
            let pixel_format_value = CFNumber::new_i32(BGRA_PIXEL_FORMAT);
            let keys: [&CFType; 7] = unsafe {
                [
                    kIOSurfaceWidth.as_ref(),
                    kIOSurfaceHeight.as_ref(),
                    kIOSurfaceBytesPerRow.as_ref(),
                    kIOSurfaceBytesPerElement.as_ref(),
                    kIOSurfaceAllocSize.as_ref(),
                    kIOSurfacePixelFormat.as_ref(),
                    kIOSurfaceIsGlobal.as_ref(),
                ]
            };
            let values: [&CFType; 7] = [
                width_value.as_ref(),
                height_value.as_ref(),
                row_bytes_value.as_ref(),
                element_bytes_value.as_ref(),
                alloc_size_value.as_ref(),
                pixel_format_value.as_ref(),
                CFBoolean::new(true).as_ref(),
            ];
            let properties = CFDictionary::<CFType, CFType>::from_slices(&keys, &values);
            let surface = unsafe { IOSurfaceRef::new(properties.as_ref()) }?;
            surfaces.insert(
                route_id.clone(),
                SoftwareSurface {
                    surface,
                    width,
                    height,
                    sequence: 0,
                },
            );
        }

        let current = surfaces.get_mut(&route_id)?;
        let lock_options = IOSurfaceLockOptions::empty();
        if unsafe { current.surface.lock(lock_options, std::ptr::null_mut()) } != 0 {
            return None;
        }
        let destination_row_bytes = current.surface.bytes_per_row();
        let destination = current.surface.base_address().as_ptr().cast::<u8>();
        for row in 0..height as usize {
            // The products are bounded by the validated source and IOSurface
            // allocations. Do not return early while the surface is locked.
            let source_offset = row * source_row_bytes;
            let destination_offset = row * destination_row_bytes;
            unsafe {
                std::ptr::copy_nonoverlapping(
                    buffer.add(source_offset),
                    destination.add(destination_offset),
                    source_row_bytes,
                );
            }
        }
        if unsafe { current.surface.unlock(lock_options, std::ptr::null_mut()) } != 0 {
            return None;
        }
        current.sequence = current.sequence.saturating_add(1);
        Some(onpeople_types::BrowserFrame {
            route_id,
            sequence: current.sequence,
            width,
            height,
            scale_factor,
            surface_kind: "iosurface".to_owned(),
            surface_handle: format!("iosurface:{}", current.surface.id()),
            damage_rects: dirty_rects
                .unwrap_or_default()
                .iter()
                .filter_map(|rect| {
                    Some([
                        u32::try_from(rect.x.max(0)).ok()?,
                        u32::try_from(rect.y.max(0)).ok()?,
                        u32::try_from(rect.width.max(0)).ok()?,
                        u32::try_from(rect.height.max(0)).ok()?,
                    ])
                })
                .collect(),
        })
    })
}

pub fn run() -> Result<(), AppError> {
    #[cfg(target_os = "macos")]
    let _cef_library = load_macos_cef_library()?;
    // CEF helpers execute this binary too. They must exit through
    // `execute_process` before the browser profile, SQLite storage, cookie
    // encryption or any other browser-process-owned state is initialized.
    let args = Args::new();
    let main_args = args.as_main_args();
    let _ = api_hash(sys::CEF_API_VERSION_LAST, 0);
    // On macOS CEF's real Chromium sandbox has an explicit process-wide
    // bootstrap step for helper processes. The context must remain alive for
    // the complete helper lifetime. Skipping it lets cef_initialize appear
    // to succeed in the Browser Process, but GPU/Renderer/Network helpers
    // trap in cef_execute_process.
    // Development may explicitly disable the CEF sandbox; release builds do
    // not take that path.
    #[cfg(target_os = "macos")]
    let is_helper_process = std::env::args().any(|argument| argument.starts_with("--type="));
    #[cfg(target_os = "macos")]
    let _sandbox = if is_helper_process && std::env::var_os("ONPEOPLE_CEF_NO_SANDBOX").is_none() {
        let mut sandbox = cef::sandbox::Sandbox::new();
        sandbox.initialize(main_args);
        Some(sandbox)
    } else {
        None
    };
    let app_state = Arc::new(Mutex::new(None));
    let mut app = BrowserApp::new(Arc::clone(&app_state));
    let process = execute_process(Some(main_args), Some(&mut app), std::ptr::null_mut());
    if process >= 0 {
        return if process == 0 {
            Ok(())
        } else {
            Err(AppError::new(
                ErrorCode::ProcessFailed,
                format!("CEF 子进程退出，状态码 {process}"),
            ))
        };
    }

    // Only the main Browser Process reaches this point.
    let profile = std::env::var_os("ONPEOPLE_CEF_PROFILE")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("cef-profile"));
    std::fs::create_dir_all(&profile).map_err(AppError::storage)?;
    #[cfg(target_os = "macos")]
    let _instance_lock = acquire_browser_host_instance_lock(&profile)?;
    // The host owns the authoritative browser route metadata. Open the same
    // SQLite data root as the shell so a host restart can restore tabs,
    // history metadata and the active route instead of starting from an empty
    // in-memory mirror.
    let storage_root = profile
        .parent()
        .map(PathBuf::from)
        .unwrap_or_else(|| profile.clone());
    let storage = onpeople_storage::Storage::open(Some(storage_root))?;
    let state = Arc::new(BrowserHostState::with_storage(profile.clone(), storage));
    *app_state
        .lock()
        .map_err(|_| AppError::internal("CEF Browser Process 状态锁定失败"))? =
        Some(Arc::clone(&state));
    let controller = CefController::new();
    state.set_controller(Arc::new(controller));
    let config = IpcConfig::from_environment(&profile)?;
    let state_for_ipc = Arc::clone(&state);
    std::thread::Builder::new()
        .name("browser-ipc".to_owned())
        .spawn(move || {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build();
            if let Ok(runtime) = runtime {
                let ipc = BrowserIpc::new(config, state_for_ipc);
                let _ = runtime.block_on(ipc.serve());
            }
        })
        .map_err(AppError::storage)?;
    let cache_path = profile
        .canonicalize()
        .map_err(AppError::storage)?
        .to_string_lossy()
        .into_owned();
    let log_path = profile.join("cef.log").to_string_lossy().into_owned();
    let host_bundle = std::env::current_exe()
        .ok()
        .and_then(|path| {
            let macos = path.parent()?;
            let contents = macos.parent()?;
            Some(contents.parent()?.to_path_buf())
        })
        .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("app"));
    // CEF's macOS sandbox requires a distribution-signed host and helpers.
    // Isolated/ad-hoc preview bundles explicitly opt out; release bundles keep
    // the sandbox enabled and are signed as a unit by the release pipeline.
    let sandbox_disabled = std::env::var_os("ONPEOPLE_CEF_NO_SANDBOX").is_some();
    let mut settings = Settings {
        no_sandbox: i32::from(sandbox_disabled),
        // CEF only supports the threaded browser message loop on Windows
        // and Linux. macOS must run CefRunMessageLoop on its main thread.
        multi_threaded_message_loop: i32::from(!cfg!(target_os = "macos")),
        windowless_rendering_enabled: 1,
        background_color: OPAQUE_WHITE,
        root_cache_path: CefString::from(cache_path.as_str()),
        cache_path: CefString::from(cache_path.as_str()),
        persist_session_cookies: 1,
        log_file: CefString::from(log_path.as_str()),
        log_severity: if sandbox_disabled {
            LogSeverity::INFO
        } else {
            LogSeverity::WARNING
        },
        ..Default::default()
    };
    if let Some(host_bundle) = host_bundle {
        let framework_path =
            host_bundle.join("Contents/Frameworks/Chromium Embedded Framework.framework");
        let resources_path = host_bundle.join("Contents/Resources");
        settings.framework_dir_path = CefString::from(framework_path.to_string_lossy().as_ref());
        settings.main_bundle_path = CefString::from(host_bundle.to_string_lossy().as_ref());
        settings.resources_dir_path = CefString::from(resources_path.to_string_lossy().as_ref());
    }
    let initialized = initialize(
        Some(main_args),
        Some(&settings),
        Some(&mut app),
        std::ptr::null_mut(),
    );
    if initialized == 0 {
        return Err(AppError::internal("CEF 初始化失败"));
    }
    // The IPC socket is intentionally live before this point, but readiness
    // is not advertised until CEF initialization has completed successfully.
    state.set_ready();
    #[cfg(target_os = "macos")]
    run_message_loop();
    #[cfg(not(target_os = "macos"))]
    loop {
        std::thread::park_timeout(Duration::from_secs(60));
    }
    #[cfg(target_os = "macos")]
    shutdown();
    #[cfg(target_os = "macos")]
    Ok(())
}

#[cfg(target_os = "macos")]
struct BrowserHostInstanceLock {
    _listener: std::os::unix::net::UnixListener,
    path: PathBuf,
}

#[cfg(target_os = "macos")]
impl Drop for BrowserHostInstanceLock {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

#[cfg(target_os = "macos")]
fn acquire_browser_host_instance_lock(profile: &Path) -> Result<BrowserHostInstanceLock, AppError> {
    use sha2::{Digest, Sha256};
    use std::os::unix::net::{UnixListener, UnixStream};

    // AF_UNIX paths on macOS are limited to 104 bytes. The Application
    // Support Profile path already approaches that limit, so keep the socket
    // in the system temporary directory and derive a stable per-Profile name.
    let canonical_profile = profile.canonicalize().map_err(AppError::storage)?;
    let digest = format!(
        "{:x}",
        Sha256::digest(canonical_profile.to_string_lossy().as_bytes())
    );
    let path = std::env::temp_dir().join(format!("onpeople-browser-host-{}.sock", &digest[..20]));
    match UnixListener::bind(&path) {
        Ok(listener) => Ok(BrowserHostInstanceLock {
            _listener: listener,
            path,
        }),
        Err(error) if error.kind() == std::io::ErrorKind::AddrInUse => {
            if UnixStream::connect(&path).is_ok() {
                return Err(AppError::new(
                    ErrorCode::Conflict,
                    "Browser Host 已在运行，拒绝启动重复实例",
                ));
            }
            std::fs::remove_file(&path).map_err(AppError::storage)?;
            let listener = UnixListener::bind(&path).map_err(|error| {
                AppError::new(ErrorCode::Conflict, "无法获取 Browser Host 单例锁")
                    .context("cause", error)
            })?;
            Ok(BrowserHostInstanceLock {
                _listener: listener,
                path,
            })
        }
        Err(error) => Err(
            AppError::new(ErrorCode::Conflict, "无法获取 Browser Host 单例锁")
                .context("cause", error),
        ),
    }
}

#[cfg(target_os = "macos")]
fn load_macos_cef_library() -> Result<cef::library_loader::LibraryLoader, AppError> {
    let executable = std::env::current_exe().map_err(AppError::storage)?;
    let helper = std::env::args().any(|argument| argument.starts_with("--type="));
    let framework = executable
        .parent()
        .ok_or_else(|| AppError::internal("无法解析 CEF 可执行文件目录"))?
        .join(if helper { "../../.." } else { "../Frameworks" })
        .join("Chromium Embedded Framework.framework/Chromium Embedded Framework");
    if !framework.is_file() {
        return Err(AppError::new(
            ErrorCode::BrowserUnavailable,
            "CEF Framework 未随浏览器宿主安装",
        )
        .context("path", framework.to_string_lossy()));
    }
    let loader = cef::library_loader::LibraryLoader::new(&executable, helper);
    if !loader.load() {
        return Err(AppError::new(
            ErrorCode::BrowserUnavailable,
            "无法加载 CEF Framework",
        ));
    }
    Ok(loader)
}
