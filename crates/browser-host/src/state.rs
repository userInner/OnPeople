use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc::SyncSender,
    },
    time::Duration,
};

use chrono::Utc;
use onpeople_storage::Storage;
use onpeople_types::{
    AppError, BrowserAnnotation, BrowserDeveloperState, BrowserFrame, BrowserImportResult,
    BrowserState, BrowserTab, ErrorCode,
};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::sync::broadcast;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "command",
    content = "payload"
)]
pub enum BrowserCommand {
    /// Lightweight lifecycle handshake. A socket can exist before CEF has
    /// completed initialization, so callers must require `ready: true`.
    Ping,
    CreateRoute {
        route_id: String,
        thread_id: String,
        url: String,
    },
    Navigate {
        route_id: String,
        url: String,
    },
    Back {
        route_id: String,
    },
    Forward {
        route_id: String,
    },
    Reload {
        route_id: String,
    },
    Resize {
        route_id: String,
        width: u32,
        height: u32,
        scale_factor: f64,
        visible: bool,
    },
    Click {
        route_id: String,
        selector: String,
    },
    Fill {
        route_id: String,
        selector: String,
        value: String,
    },
    Select {
        route_id: String,
        selector: String,
        value: String,
    },
    Upload {
        route_id: String,
        selector: String,
        paths: Vec<String>,
    },
    Press {
        route_id: String,
        key: String,
    },
    Scroll {
        route_id: String,
        x: f64,
        y: f64,
    },
    Hover {
        route_id: String,
        selector: String,
    },
    Wait {
        route_id: String,
        expression: String,
        timeout_ms: u64,
    },
    Evaluate {
        route_id: String,
        expression: String,
    },
    DomSnapshot {
        route_id: String,
    },
    VisualSnapshot {
        route_id: String,
    },
    FrameSnapshot {
        route_id: String,
    },
    FrameConsumed {
        route_id: String,
        sequence: u64,
    },
    DeveloperInspect {
        route_id: String,
    },
    StateSnapshot,
    ActivateRoute {
        route_id: String,
    },
    Pointer {
        route_id: String,
        kind: String,
        x: f64,
        y: f64,
        delta_x: f64,
        delta_y: f64,
        button: i32,
        click_count: i32,
        modifiers: u32,
    },
    Key {
        route_id: String,
        kind: String,
        key_code: i32,
        native_key_code: i32,
        character: String,
        modifiers: u32,
    },
    CloseRoute {
        route_id: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RouteState {
    tab: BrowserTab,
    history: Vec<String>,
    history_index: usize,
    width: u32,
    height: u32,
    scale_factor: f64,
    visible: bool,
}

type FrameWaiters = Arc<Mutex<HashMap<(String, u64), SyncSender<()>>>>;

#[derive(Clone)]
pub struct BrowserHostState {
    profile_path: PathBuf,
    storage: Option<Storage>,
    routes: Arc<Mutex<HashMap<String, RouteState>>>,
    active_route_id: Arc<Mutex<Option<String>>>,
    frames: Arc<Mutex<HashMap<String, BrowserFrame>>>,
    frame_waiters: FrameWaiters,
    developer_console: Arc<Mutex<HashMap<String, Vec<Value>>>>,
    developer_network: Arc<Mutex<HashMap<String, Vec<Value>>>>,
    annotations: Arc<Mutex<HashMap<String, BrowserAnnotation>>>,
    controller: Arc<Mutex<Option<Arc<dyn BrowserController>>>>,
    cef_ready: Arc<AtomicBool>,
    events: broadcast::Sender<BrowserHostEvent>,
}

#[derive(Debug, Clone)]
pub enum BrowserHostEvent {
    State(BrowserState),
    Frame(BrowserFrame),
    Navigation { route_id: String, url: String },
    NewTab { route_id: String, url: String },
    Crash { route_id: String, message: String },
}

pub trait BrowserController: Send + Sync {
    fn execute(&self, command: BrowserCommand) -> Result<Value, AppError>;
}

impl BrowserHostState {
    #[must_use]
    pub fn new(profile_path: PathBuf) -> Self {
        let (events, _) = broadcast::channel(1_024);
        Self {
            profile_path,
            storage: None,
            routes: Arc::new(Mutex::new(HashMap::new())),
            active_route_id: Arc::new(Mutex::new(None)),
            frames: Arc::new(Mutex::new(HashMap::new())),
            frame_waiters: Arc::new(Mutex::new(HashMap::new())),
            developer_console: Arc::new(Mutex::new(HashMap::new())),
            developer_network: Arc::new(Mutex::new(HashMap::new())),
            annotations: Arc::new(Mutex::new(HashMap::new())),
            controller: Arc::new(Mutex::new(None)),
            cef_ready: Arc::new(AtomicBool::new(false)),
            events,
        }
    }

    #[must_use]
    pub fn with_storage(profile_path: PathBuf, storage: Storage) -> Self {
        let state = Self {
            profile_path,
            storage: Some(storage),
            routes: Arc::new(Mutex::new(HashMap::new())),
            active_route_id: Arc::new(Mutex::new(None)),
            frames: Arc::new(Mutex::new(HashMap::new())),
            frame_waiters: Arc::new(Mutex::new(HashMap::new())),
            developer_console: Arc::new(Mutex::new(HashMap::new())),
            developer_network: Arc::new(Mutex::new(HashMap::new())),
            annotations: Arc::new(Mutex::new(HashMap::new())),
            controller: Arc::new(Mutex::new(None)),
            cef_ready: Arc::new(AtomicBool::new(false)),
            events: broadcast::channel(1_024).0,
        };
        state.restore_metadata();
        state
    }

    #[must_use]
    pub fn subscribe(&self) -> broadcast::Receiver<BrowserHostEvent> {
        self.events.subscribe()
    }

    pub fn set_controller(&self, controller: Arc<dyn BrowserController>) {
        *self.controller.lock() = Some(controller);
        self.emit_state();
    }

    /// Mark CEF ready only after `cef::initialize` has succeeded. The IPC
    /// listener is intentionally allowed to exist before this point so that
    /// the shell can distinguish a live-but-starting host from a dead one.
    pub fn set_ready(&self) {
        self.cef_ready.store(true, Ordering::Release);
        self.emit_state();
    }

    #[must_use]
    pub fn is_ready(&self) -> bool {
        self.cef_ready.load(Ordering::Acquire) && self.controller.lock().is_some()
    }

    fn execute_controller(&self, command: BrowserCommand) -> Result<Value, AppError> {
        let controller = self.controller.lock().clone().ok_or_else(|| {
            AppError::new(ErrorCode::BrowserUnavailable, "CEF 浏览器控制器尚未初始化")
        })?;
        controller.execute(command)
    }

    pub fn apply(&self, command: BrowserCommand) -> Result<Value, AppError> {
        match command {
            BrowserCommand::Ping => Ok(json!({ "ready": self.is_ready() })),
            BrowserCommand::CreateRoute {
                route_id,
                thread_id,
                url,
            } => {
                validate_route(&route_id)?;
                validate_url(&url)?;
                // A host restart restores route metadata before CEF is ready.
                // Rehydration sends CreateRoute again; keep that metadata so
                // history, title and the previous viewport are not erased.
                let existing = self.routes.lock().get(&route_id).cloned();
                let (controller_thread_id, controller_url) = if let Some(route) = existing {
                    (route.tab.thread_id, route.tab.url)
                } else {
                    let tab = BrowserTab {
                        route_id: route_id.clone(),
                        thread_id: thread_id.clone(),
                        url: url.clone(),
                        title: String::new(),
                        favicon_url: None,
                        loading: true,
                        can_go_back: false,
                        can_go_forward: false,
                        crashed: false,
                    };
                    self.routes.lock().insert(
                        route_id.clone(),
                        RouteState {
                            tab,
                            history: vec![url.clone()],
                            history_index: 0,
                            width: 1_280,
                            height: 720,
                            scale_factor: 1.0,
                            visible: true,
                        },
                    );
                    (thread_id, url)
                };
                let controller_command = BrowserCommand::CreateRoute {
                    route_id: route_id.clone(),
                    thread_id: controller_thread_id,
                    url: controller_url,
                };
                *self.active_route_id.lock() = Some(route_id.clone());
                self.persist_route(&route_id);
                self.persist_active_route();
                self.emit_state();
                self.execute_controller(controller_command)
            }
            BrowserCommand::Navigate { route_id, url } => {
                validate_url(&url)?;
                let controller_command = BrowserCommand::Navigate {
                    route_id: route_id.clone(),
                    url: url.clone(),
                };
                let mut routes = self.routes.lock();
                let route = routes
                    .get_mut(&route_id)
                    .ok_or_else(|| AppError::new(ErrorCode::NotFound, "浏览器路由不存在"))?;
                route.history.truncate(route.history_index + 1);
                route.history.push(url.clone());
                route.history_index += 1;
                route.tab.url = url.clone();
                route.tab.loading = true;
                route.tab.can_go_back = route.history_index > 0;
                route.tab.can_go_forward = false;
                let route_id_for_persist = route.tab.route_id.clone();
                drop(routes);
                let _ = self
                    .events
                    .send(BrowserHostEvent::Navigation { route_id, url });
                self.persist_route(&route_id_for_persist);
                self.emit_state();
                self.execute_controller(controller_command)
            }
            BrowserCommand::Back { route_id } => self.step_history(&route_id, -1),
            BrowserCommand::Forward { route_id } => self.step_history(&route_id, 1),
            BrowserCommand::Reload { route_id } => {
                let route = self
                    .routes
                    .lock()
                    .get(&route_id)
                    .cloned()
                    .ok_or_else(|| AppError::new(ErrorCode::NotFound, "浏览器路由不存在"))?;
                let _ = self.events.send(BrowserHostEvent::Navigation {
                    route_id: route_id.clone(),
                    url: route.tab.url.clone(),
                });
                self.execute_controller(BrowserCommand::Reload { route_id })
            }
            BrowserCommand::Resize {
                route_id,
                width,
                height,
                scale_factor,
                visible,
            } => {
                let mut routes = self.routes.lock();
                let route = routes
                    .get_mut(&route_id)
                    .ok_or_else(|| AppError::new(ErrorCode::NotFound, "浏览器路由不存在"))?;
                route.width = width.clamp(1, 8_192);
                route.height = height.clamp(1, 8_192);
                route.scale_factor = scale_factor.clamp(0.5, 4.0);
                route.visible = visible;
                drop(routes);
                self.execute_controller(BrowserCommand::Resize {
                    route_id,
                    width,
                    height,
                    scale_factor,
                    visible,
                })
            }
            BrowserCommand::CloseRoute { route_id } => {
                let removed = self.routes.lock().remove(&route_id).is_some();
                self.frames.lock().remove(&route_id);
                if removed {
                    if let Some(storage) = &self.storage {
                        let _ = storage.delete_metadata(&format!("browser.tab.{route_id}"));
                    }
                    let replacement = self.routes.lock().keys().min().cloned();
                    let mut active_route_id = self.active_route_id.lock();
                    if active_route_id.as_deref() == Some(route_id.as_str()) {
                        *active_route_id = replacement;
                    }
                    drop(active_route_id);
                    self.persist_active_route();
                }
                self.emit_state();
                if removed {
                    self.execute_controller(BrowserCommand::CloseRoute { route_id })
                } else {
                    Ok(json!({ "closed": false }))
                }
            }
            BrowserCommand::Evaluate {
                route_id,
                expression,
            } => {
                ensure_route(&self.routes, &route_id)?;
                if expression.len() > 50_000 {
                    return Err(AppError::invalid("浏览器表达式过长"));
                }
                self.execute_controller(BrowserCommand::Evaluate {
                    route_id,
                    expression,
                })
            }
            BrowserCommand::DomSnapshot { route_id } => {
                self.route(&route_id)?;
                self.execute_controller(BrowserCommand::DomSnapshot { route_id })
            }
            BrowserCommand::VisualSnapshot { route_id } => {
                self.route(&route_id)?;
                let result = self.execute_controller(BrowserCommand::VisualSnapshot {
                    route_id: route_id.clone(),
                })?;
                if !result.is_null() {
                    return Ok(result);
                }
                let frame = self.frames.lock().get(&route_id).cloned().ok_or_else(|| {
                    AppError::new(ErrorCode::Unsupported, "CEF 视觉快照尚未有可用的加速帧")
                })?;
                serde_json::to_value(frame).map_err(AppError::internal)
            }
            BrowserCommand::FrameSnapshot { route_id } => {
                let frame = self.frames.lock().get(&route_id).cloned();
                serde_json::to_value(frame).map_err(AppError::internal)
            }
            BrowserCommand::FrameConsumed { route_id, sequence } => {
                let consumed = self
                    .frames
                    .lock()
                    .get(&route_id)
                    .is_some_and(|frame| frame.sequence == sequence);
                if consumed {
                    self.frames.lock().remove(&route_id);
                }
                if let Some(waiter) = self.frame_waiters.lock().remove(&(route_id, sequence)) {
                    let _ = waiter.send(());
                }
                Ok(json!({ "consumed": consumed }))
            }
            BrowserCommand::DeveloperInspect { route_id } => {
                let state = self.developer_state(&route_id)?;
                self.controller
                    .lock()
                    .as_ref()
                    .map(|_| BrowserCommand::DeveloperInspect {
                        route_id: route_id.clone(),
                    })
                    .map_or_else(
                        || serde_json::to_value(state).map_err(AppError::internal),
                        |command| self.execute_controller(command),
                    )
            }
            BrowserCommand::StateSnapshot => {
                serde_json::to_value(self.state()).map_err(AppError::internal)
            }
            BrowserCommand::ActivateRoute { route_id } => {
                serde_json::to_value(self.activate_route(&route_id)?).map_err(AppError::internal)
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
                self.route(&route_id)?;
                if !x.is_finite()
                    || !y.is_finite()
                    || !delta_x.is_finite()
                    || !delta_y.is_finite()
                    || !matches!(kind.as_str(), "move" | "down" | "up" | "wheel" | "leave")
                {
                    return Err(AppError::invalid("浏览器指针事件无效"));
                }
                self.execute_controller(BrowserCommand::Pointer {
                    route_id,
                    kind,
                    x: x.clamp(-32_768.0, 32_768.0),
                    y: y.clamp(-32_768.0, 32_768.0),
                    delta_x: delta_x.clamp(-32_768.0, 32_768.0),
                    delta_y: delta_y.clamp(-32_768.0, 32_768.0),
                    button: button.clamp(0, 2),
                    click_count: click_count.clamp(1, 3),
                    modifiers,
                })
            }
            BrowserCommand::Key {
                route_id,
                kind,
                key_code,
                native_key_code,
                character,
                modifiers,
            } => {
                self.route(&route_id)?;
                if !matches!(kind.as_str(), "down" | "up") || character.chars().count() > 2 {
                    return Err(AppError::invalid("浏览器键盘事件无效"));
                }
                self.execute_controller(BrowserCommand::Key {
                    route_id,
                    kind,
                    key_code,
                    native_key_code,
                    character,
                    modifiers,
                })
            }
            BrowserCommand::Click { route_id, selector } => {
                self.route(&route_id)?;
                if selector.trim().is_empty() {
                    return Err(AppError::invalid("浏览器选择器不能为空"));
                }
                self.execute_controller(BrowserCommand::Click { route_id, selector })
            }
            BrowserCommand::Hover { route_id, selector } => {
                self.route(&route_id)?;
                if selector.trim().is_empty() {
                    return Err(AppError::invalid("浏览器选择器不能为空"));
                }
                self.execute_controller(BrowserCommand::Hover { route_id, selector })
            }
            BrowserCommand::Fill {
                route_id,
                selector,
                value,
            } => {
                self.route(&route_id)?;
                if selector.trim().is_empty() || value.len() > 100_000 {
                    return Err(AppError::invalid("浏览器填充参数无效"));
                }
                self.execute_controller(BrowserCommand::Fill {
                    route_id,
                    selector,
                    value,
                })
            }
            BrowserCommand::Select {
                route_id,
                selector,
                value,
            } => {
                self.route(&route_id)?;
                if selector.trim().is_empty() || value.len() > 100_000 {
                    return Err(AppError::invalid("浏览器选择参数无效"));
                }
                self.execute_controller(BrowserCommand::Select {
                    route_id,
                    selector,
                    value,
                })
            }
            BrowserCommand::Upload {
                route_id,
                selector,
                paths,
            } => {
                self.route(&route_id)?;
                if selector.trim().is_empty() || paths.is_empty() || paths.len() > 20 {
                    return Err(AppError::invalid("浏览器上传参数无效"));
                }
                let root = std::env::var_os("ONPEOPLE_WORKSPACE_ROOT")
                    .map(PathBuf::from)
                    .or_else(|| std::env::current_dir().ok())
                    .ok_or_else(|| AppError::invalid("浏览器工作区未配置"))?
                    .canonicalize()
                    .map_err(AppError::storage)?;
                let mut validated = Vec::with_capacity(paths.len());
                for path in paths {
                    let path = PathBuf::from(path)
                        .canonicalize()
                        .map_err(|_| AppError::invalid("上传文件不存在或不可访问"))?;
                    if !path.starts_with(&root) || !path.is_file() {
                        return Err(AppError::new(
                            ErrorCode::PermissionDenied,
                            "上传文件必须位于当前工作区",
                        ));
                    }
                    validated.push(path.to_string_lossy().into_owned());
                }
                self.execute_controller(BrowserCommand::Upload {
                    route_id,
                    selector,
                    paths: validated,
                })
            }
            BrowserCommand::Press { route_id, key } => {
                self.route(&route_id)?;
                if key.len() > 100 {
                    return Err(AppError::invalid("按键名称无效"));
                }
                self.execute_controller(BrowserCommand::Press { route_id, key })
            }
            BrowserCommand::Scroll { route_id, x, y } => {
                self.route(&route_id)?;
                if !x.is_finite() || !y.is_finite() {
                    return Err(AppError::invalid("滚动坐标无效"));
                }
                self.execute_controller(BrowserCommand::Scroll { route_id, x, y })
            }
            BrowserCommand::Wait {
                route_id,
                expression,
                timeout_ms,
            } => {
                self.route(&route_id)?;
                self.execute_controller(BrowserCommand::Wait {
                    route_id,
                    expression,
                    timeout_ms: timeout_ms.min(120_000),
                })
            }
        }
    }

    #[must_use]
    pub fn state(&self) -> BrowserState {
        let host_ready = self.is_ready();
        let routes = self.routes.lock();
        let active_route_id = self
            .active_route_id
            .lock()
            .clone()
            .filter(|route_id| routes.contains_key(route_id))
            .or_else(|| routes.keys().min().cloned());
        let mut tabs = routes
            .values()
            .map(|route| route.tab.clone())
            .collect::<Vec<_>>();
        tabs.sort_by(|left, right| left.route_id.cmp(&right.route_id));
        BrowserState {
            host_ready,
            host_status: if host_ready {
                "ready".to_owned()
            } else {
                "starting".to_owned()
            },
            host_error: None,
            host_error_kind: None,
            active_route_id,
            tabs,
            profile_path: self.profile_path.to_string_lossy().into_owned(),
        }
    }

    pub fn activate_route(&self, route_id: &str) -> Result<BrowserState, AppError> {
        ensure_route(&self.routes, route_id)?;
        *self.active_route_id.lock() = Some(route_id.to_owned());
        self.persist_active_route();
        let state = self.state();
        let _ = self.events.send(BrowserHostEvent::State(state.clone()));
        Ok(state)
    }

    pub fn save_annotation(
        &self,
        mut annotation: BrowserAnnotation,
    ) -> Result<BrowserAnnotation, AppError> {
        if annotation.id.is_empty() {
            annotation.id = Uuid::now_v7().to_string();
        }
        annotation.created_at = Utc::now();
        self.annotations
            .lock()
            .insert(annotation.id.clone(), annotation.clone());
        if let Some(storage) = &self.storage {
            storage.put_metadata(
                &format!("browser.annotation.{}", annotation.id),
                &serde_json::to_value(&annotation).map_err(AppError::internal)?,
            )?;
        }
        Ok(annotation)
    }

    #[must_use]
    pub fn annotations(&self, route_id: &str) -> Vec<BrowserAnnotation> {
        self.annotations
            .lock()
            .values()
            .filter(|annotation| annotation.route_id == route_id)
            .cloned()
            .collect()
    }

    pub fn delete_annotation(&self, id: &str) -> bool {
        let removed = self.annotations.lock().remove(id).is_some();
        if removed {
            if let Some(storage) = &self.storage {
                let _ = storage.delete_metadata(&format!("browser.annotation.{id}"));
            }
        }
        removed
    }

    #[must_use]
    pub fn import_result() -> BrowserImportResult {
        BrowserImportResult {
            cookies: 0,
            storage_files: 0,
            credentials: 0,
            skipped: 0,
        }
    }

    fn route(&self, route_id: &str) -> Result<RouteState, AppError> {
        self.routes
            .lock()
            .get(route_id)
            .cloned()
            .ok_or_else(|| AppError::new(ErrorCode::NotFound, "浏览器路由不存在"))
    }

    fn step_history(&self, route_id: &str, direction: i32) -> Result<Value, AppError> {
        let mut routes = self.routes.lock();
        let route = routes
            .get_mut(route_id)
            .ok_or_else(|| AppError::new(ErrorCode::NotFound, "浏览器路由不存在"))?;
        let next = route.history_index as i32 + direction;
        if next < 0 || next >= route.history.len() as i32 {
            return Ok(json!({ "changed": false }));
        }
        route.history_index = usize::try_from(next)
            .map_err(|_| AppError::new(ErrorCode::InvalidRequest, "浏览器历史索引无效"))?;
        route.tab.url = route.history[route.history_index].clone();
        route.tab.can_go_back = route.history_index > 0;
        route.tab.can_go_forward = route.history_index + 1 < route.history.len();
        let url = route.tab.url.clone();
        drop(routes);
        self.persist_route(route_id);
        let command = if direction < 0 {
            BrowserCommand::Back {
                route_id: route_id.to_owned(),
            }
        } else {
            BrowserCommand::Forward {
                route_id: route_id.to_owned(),
            }
        };
        let _ = self.execute_controller(command)?;
        Ok(json!({ "changed": true, "url": url }))
    }

    fn emit_state(&self) {
        let _ = self.events.send(BrowserHostEvent::State(self.state()));
    }

    /// The shell uses this to publish lifecycle state while retaining its
    /// cached remote `BrowserState` as the source of truth for tabs.
    pub fn publish_state(&self, state: BrowserState) {
        let _ = self.events.send(BrowserHostEvent::State(state));
    }

    fn persist_route(&self, route_id: &str) {
        let Some(storage) = &self.storage else { return };
        let Some(route) = self.routes.lock().get(route_id).cloned() else {
            return;
        };
        if let Ok(value) = serde_json::to_value(route) {
            let _ = storage.put_metadata(&format!("browser.tab.{route_id}"), &value);
        }
    }

    fn persist_active_route(&self) {
        let Some(storage) = &self.storage else { return };
        let value = self.active_route_id.lock().clone();
        let _ = storage.put_metadata("browser.activeRouteId", &json!(value));
    }

    fn restore_metadata(&self) {
        let Some(storage) = &self.storage else { return };
        let Ok(items) = storage.metadata_prefix("browser.annotation.") else {
            return;
        };
        for (_, value) in items {
            if let Ok(annotation) = serde_json::from_value::<BrowserAnnotation>(value) {
                self.annotations
                    .lock()
                    .insert(annotation.id.clone(), annotation);
            }
        }
        let Ok(items) = storage.metadata_prefix("browser.tab.") else {
            return;
        };
        for (_, value) in items {
            let route = serde_json::from_value::<RouteState>(value.clone()).or_else(|_| {
                serde_json::from_value::<BrowserTab>(value).map(|tab| RouteState {
                    history: vec![tab.url.clone()],
                    history_index: 0,
                    width: 1_280,
                    height: 720,
                    scale_factor: 1.0,
                    visible: true,
                    tab,
                })
            });
            let Ok(route) = route else { continue };
            self.routes.lock().insert(route.tab.route_id.clone(), route);
        }
        if let Ok(Some(value)) = storage.get_metadata("browser.activeRouteId") {
            *self.active_route_id.lock() = value.as_str().map(ToOwned::to_owned);
        }
    }

    pub fn emit_frame_internal(&self, frame: BrowserFrame) -> bool {
        self.frames
            .lock()
            .insert(frame.route_id.clone(), frame.clone());
        self.events.send(BrowserHostEvent::Frame(frame)).is_ok()
    }

    /// Publish one accelerated frame and keep its CEF-owned `IOSurface` alive
    /// until the native shell has copied it into its Metal layer. CEF releases
    /// the source surface immediately after `OnAcceleratedPaint` returns, so
    /// an asynchronous surface-ID handoff is otherwise inherently racy.
    pub fn emit_frame_and_wait(&self, frame: BrowserFrame) -> bool {
        let key = (frame.route_id.clone(), frame.sequence);
        if frame.sequence <= 3 {
            eprintln!(
                "[onpeople-browser-host] accelerated frame route={} sequence={} handle={}",
                frame.route_id, frame.sequence, frame.surface_handle
            );
        }
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        self.frames
            .lock()
            .insert(frame.route_id.clone(), frame.clone());
        self.frame_waiters.lock().insert(key.clone(), sender);
        // An embedded shell consumes the broadcast directly. The standalone
        // Browser Host is consumed over IPC via FrameSnapshot/FrameConsumed,
        // so the absence of an in-process broadcast receiver is not an error.
        let _ = self.events.send(BrowserHostEvent::Frame(frame));
        let consumed = receiver.recv_timeout(Duration::from_millis(750)).is_ok();
        self.frame_waiters.lock().remove(&key);
        if !consumed {
            eprintln!(
                "[onpeople-browser-host] accelerated frame lease timed out route={} sequence={}",
                key.0, key.1
            );
            self.frames.lock().remove(&key.0);
        } else if key.1 <= 3 {
            eprintln!(
                "[onpeople-browser-host] accelerated frame lease consumed route={} sequence={}",
                key.0, key.1
            );
        }
        consumed
    }

    pub fn emit_new_tab(&self, route_id: String, url: String) -> bool {
        self.events
            .send(BrowserHostEvent::NewTab { route_id, url })
            .is_ok()
    }

    pub fn register_popup_route(
        &self,
        route_id: String,
        parent_route_id: &str,
        url: String,
    ) -> bool {
        let thread_id = self
            .routes
            .lock()
            .get(parent_route_id)
            .map(|route| route.tab.thread_id.clone())
            .unwrap_or_else(|| "main".to_owned());
        self.routes.lock().insert(
            route_id.clone(),
            RouteState {
                tab: BrowserTab {
                    route_id: route_id.clone(),
                    thread_id,
                    url: url.clone(),
                    title: String::new(),
                    favicon_url: None,
                    loading: true,
                    can_go_back: false,
                    can_go_forward: false,
                    crashed: false,
                },
                history: vec![url.clone()],
                history_index: 0,
                width: 1_280,
                height: 720,
                scale_factor: 1.0,
                visible: true,
            },
        );
        *self.active_route_id.lock() = Some(route_id.clone());
        self.emit_state();
        let _ = self.emit_new_tab(route_id, url);
        true
    }

    pub fn update_address(&self, route_id: &str, url: String) {
        if validate_url(&url).is_err() {
            return;
        }
        let mut routes = self.routes.lock();
        let Some(route) = routes.get_mut(route_id) else {
            return;
        };
        if route.tab.url != url {
            route.history.truncate(route.history_index + 1);
            route.history.push(url.clone());
            route.history_index = route.history.len().saturating_sub(1);
            route.tab.url = url.clone();
        }
        route.tab.can_go_back = route.history_index > 0;
        route.tab.can_go_forward = route.history_index + 1 < route.history.len();
        drop(routes);
        let _ = self.events.send(BrowserHostEvent::Navigation {
            route_id: route_id.to_owned(),
            url,
        });
        self.emit_state();
    }

    pub fn update_title(&self, route_id: &str, title: String) {
        if let Some(route) = self.routes.lock().get_mut(route_id) {
            route.tab.title = title.chars().take(512).collect();
        }
        self.emit_state();
    }

    pub fn update_loading(
        &self,
        route_id: &str,
        loading: bool,
        can_go_back: bool,
        can_go_forward: bool,
    ) {
        if let Some(route) = self.routes.lock().get_mut(route_id) {
            route.tab.loading = loading;
            route.tab.can_go_back = can_go_back;
            route.tab.can_go_forward = can_go_forward;
            if loading {
                route.tab.crashed = false;
            }
        }
        self.emit_state();
    }

    pub fn report_crash(&self, route_id: &str, message: String) {
        if let Some(route) = self.routes.lock().get_mut(route_id) {
            route.tab.loading = false;
            route.tab.crashed = true;
        }
        let _ = self.events.send(BrowserHostEvent::Crash {
            route_id: route_id.to_owned(),
            message,
        });
        self.emit_state();
    }

    pub fn report_host_crash(&self, message: String) {
        let _ = self.events.send(BrowserHostEvent::Crash {
            route_id: "browser".to_owned(),
            message,
        });
    }

    pub fn record_console(&self, route_id: &str, value: Value) {
        let mut console = self.developer_console.lock();
        let values = console.entry(route_id.to_owned()).or_default();
        values.push(value);
        if values.len() > 500 {
            values.drain(..values.len() - 500);
        }
    }

    pub fn record_network(&self, route_id: &str, value: Value) {
        let mut network = self.developer_network.lock();
        let values = network.entry(route_id.to_owned()).or_default();
        values.push(value);
        if values.len() > 500 {
            values.drain(..values.len() - 500);
        }
    }

    pub fn developer_state(&self, route_id: &str) -> Result<BrowserDeveloperState, AppError> {
        let route = self.route(route_id)?;
        Ok(BrowserDeveloperState {
            url: route.tab.url,
            console: self
                .developer_console
                .lock()
                .get(route_id)
                .cloned()
                .unwrap_or_default(),
            network: self
                .developer_network
                .lock()
                .get(route_id)
                .cloned()
                .unwrap_or_default(),
        })
    }

    #[must_use]
    pub fn route_dimensions(&self, route_id: &str) -> (u32, u32, f64) {
        self.routes
            .lock()
            .get(route_id)
            .map(|route| (route.width, route.height, route.scale_factor))
            .unwrap_or((1_280, 720, 1.0))
    }
}

fn ensure_route(
    routes: &Arc<Mutex<HashMap<String, RouteState>>>,
    route_id: &str,
) -> Result<(), AppError> {
    if routes.lock().contains_key(route_id) {
        Ok(())
    } else {
        Err(AppError::new(ErrorCode::NotFound, "浏览器路由不存在"))
    }
}

fn validate_route(route_id: &str) -> Result<(), AppError> {
    if route_id.len() <= 120
        && route_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "-_.".contains(character))
    {
        Ok(())
    } else {
        Err(AppError::invalid("浏览器路由 ID 无效"))
    }
}

fn validate_url(value: &str) -> Result<(), AppError> {
    let url = url::Url::parse(value).map_err(|_| AppError::invalid("浏览器地址无效"))?;
    if !matches!(url.scheme(), "http" | "https" | "file" | "about") {
        return Err(AppError::new(
            ErrorCode::PermissionDenied,
            "浏览器只允许 HTTP、HTTPS、file 和 about 地址",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use onpeople_types::AppError;
    use serde_json::{Value, json};

    use super::{BrowserCommand, BrowserController, BrowserFrame, BrowserHostState};

    struct AcceptingController;

    impl BrowserController for AcceptingController {
        fn execute(&self, _command: BrowserCommand) -> Result<Value, AppError> {
            Ok(json!({ "ok": true }))
        }
    }

    #[test]
    fn accelerated_frame_snapshot_is_retained_per_route() {
        let state = BrowserHostState::new(std::path::PathBuf::from("/tmp/onpeople-test-profile"));
        state.emit_frame_internal(BrowserFrame {
            route_id: "route-a".to_owned(),
            sequence: 7,
            width: 640,
            height: 480,
            scale_factor: 2.0,
            surface_kind: "iosurface".to_owned(),
            surface_handle: "surface-7".to_owned(),
            damage_rects: vec![[0, 0, 640, 480]],
        });
        let value = state
            .apply(BrowserCommand::FrameSnapshot {
                route_id: "route-a".to_owned(),
            })
            .expect("frame snapshot");
        assert_eq!(value["surfaceHandle"], "surface-7");
        assert_eq!(value["width"], 640);
    }

    #[test]
    fn keeps_an_explicit_active_tab_across_activation_and_close() {
        let state = BrowserHostState::new(std::path::PathBuf::from("/tmp/onpeople-test-profile"));
        state.set_controller(Arc::new(AcceptingController));
        state
            .apply(BrowserCommand::CreateRoute {
                route_id: "route-a".to_owned(),
                thread_id: "thread".to_owned(),
                url: "about:blank".to_owned(),
            })
            .expect("first route");
        state
            .apply(BrowserCommand::CreateRoute {
                route_id: "route-b".to_owned(),
                thread_id: "thread".to_owned(),
                url: "https://example.com".to_owned(),
            })
            .expect("second route");
        assert_eq!(state.state().active_route_id.as_deref(), Some("route-b"));

        state
            .activate_route("route-a")
            .expect("activate first route");
        assert_eq!(state.state().active_route_id.as_deref(), Some("route-a"));
        state
            .apply(BrowserCommand::CloseRoute {
                route_id: "route-a".to_owned(),
            })
            .expect("close active route");
        assert_eq!(state.state().active_route_id.as_deref(), Some("route-b"));
    }

    #[test]
    fn ping_only_reports_ready_after_cef_initialization() {
        let state = BrowserHostState::new(std::path::PathBuf::from("/tmp/onpeople-test-profile"));
        state.set_controller(Arc::new(AcceptingController));
        assert_eq!(state.apply(BrowserCommand::Ping).unwrap()["ready"], false);
        state.set_ready();
        assert_eq!(state.apply(BrowserCommand::Ping).unwrap()["ready"], true);
        assert_eq!(state.state().host_status, "ready");
    }

    #[test]
    fn rehydrating_an_existing_route_keeps_navigation_history() {
        let state = BrowserHostState::new(std::path::PathBuf::from("/tmp/onpeople-test-profile"));
        state.set_controller(Arc::new(AcceptingController));
        state
            .apply(BrowserCommand::CreateRoute {
                route_id: "route-history".to_owned(),
                thread_id: "thread".to_owned(),
                url: "about:blank".to_owned(),
            })
            .unwrap();
        state
            .apply(BrowserCommand::Navigate {
                route_id: "route-history".to_owned(),
                url: "https://example.com/first".to_owned(),
            })
            .unwrap();
        state
            .apply(BrowserCommand::CreateRoute {
                route_id: "route-history".to_owned(),
                thread_id: "thread".to_owned(),
                url: "about:blank".to_owned(),
            })
            .unwrap();
        let tab = state
            .state()
            .tabs
            .into_iter()
            .find(|tab| tab.route_id == "route-history")
            .unwrap();
        assert_eq!(tab.url, "https://example.com/first");
        assert!(tab.can_go_back);
    }

    #[test]
    fn cef_callbacks_update_tabs_popups_and_developer_details() {
        let state = BrowserHostState::new(std::path::PathBuf::from("/tmp/onpeople-test-profile"));
        state.set_controller(Arc::new(AcceptingController));
        state
            .apply(BrowserCommand::CreateRoute {
                route_id: "route-parent".to_owned(),
                thread_id: "thread-7".to_owned(),
                url: "about:blank".to_owned(),
            })
            .expect("parent route");
        state.update_address("route-parent", "https://example.com/docs".to_owned());
        state.update_title("route-parent", "Example Docs".to_owned());
        state.update_loading("route-parent", false, true, false);
        state.record_console(
            "route-parent",
            json!({ "level": "INFO", "message": "ready" }),
        );
        state.record_network("route-parent", json!({ "phase": "end", "status": 200 }));
        assert!(state.register_popup_route(
            "route-popup".to_owned(),
            "route-parent",
            "https://example.com/popup".to_owned(),
        ));

        let snapshot = state.state();
        let parent = snapshot
            .tabs
            .iter()
            .find(|tab| tab.route_id == "route-parent")
            .expect("parent tab");
        assert_eq!(parent.title, "Example Docs");
        assert_eq!(parent.url, "https://example.com/docs");
        assert!(!parent.loading);
        assert!(parent.can_go_back);
        let popup = snapshot
            .tabs
            .iter()
            .find(|tab| tab.route_id == "route-popup")
            .expect("popup tab");
        assert_eq!(popup.thread_id, "thread-7");
        let developer = state
            .developer_state("route-parent")
            .expect("developer state");
        assert_eq!(developer.console.len(), 1);
        assert_eq!(developer.network.len(), 1);
    }
}
