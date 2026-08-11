use std::sync::Arc;

use onpeople_core_runtime::{CoreRuntime, MAX_EVENT_REPLAY_LIMIT};
use onpeople_types::{AppError, ErrorCode, PreferencePatchRequest, ThreadFilters};
use serde::{Serialize, de::DeserializeOwned};
use serde_json::{Value, json};

use crate::{
    BrowserActionRequest, BrowserAnnotationDeleteRequest, BrowserCommandRequest,
    BrowserHostOperation, BrowserRouteRequest, ConnectorOauthCompleteRequest,
    DESKTOP_PROTOCOL_VERSION, DesktopCapabilities, DesktopEvent, DesktopHost, DesktopMethod,
    DesktopRequest, DesktopResponse, EventReplay, EventReplayRequest, PluginCatalogSyncRequest,
    PluginIdRequest, PluginPayloadRequest, QueuedTaskMessage, RuntimeSnapshotRequest,
    TaskApprovalResolution, TaskApprovalResolveRequest, TaskCancelRequest, TaskCancellation,
    TaskHandle, TaskInputResolution, TaskInputResolveRequest, TaskQueueDeletion,
    TaskQueueItemRequest, TaskQueueRequest, TaskQueueSteerReceipt, TaskRecovery, TaskResumeRequest,
    TaskSnapshot, TaskSnapshotRequest, TaskStartRequest, TaskState, TaskSteerReceipt,
    TaskSteerRequest, should_forward_desktop_event,
};

#[derive(Clone)]
pub struct DesktopDispatcher {
    runtime: Arc<CoreRuntime>,
}

impl DesktopDispatcher {
    #[must_use]
    pub const fn new(runtime: Arc<CoreRuntime>) -> Self {
        Self { runtime }
    }

    pub async fn dispatch(&self, request: DesktopRequest) -> DesktopResponse {
        self.dispatch_inner(request, None).await
    }

    /// Dispatches a request with access to shell-owned capabilities.
    /// Headless callers keep using [`Self::dispatch`].
    pub async fn dispatch_with_host(
        &self,
        request: DesktopRequest,
        host: &dyn DesktopHost,
    ) -> DesktopResponse {
        self.dispatch_inner(request, Some(host)).await
    }

    async fn dispatch_inner(
        &self,
        request: DesktopRequest,
        host: Option<&dyn DesktopHost>,
    ) -> DesktopResponse {
        let request_id = request.request_id.clone();
        if request.protocol_version != DESKTOP_PROTOCOL_VERSION {
            return DesktopResponse::failure(
                request_id,
                AppError::new(
                    ErrorCode::Unsupported,
                    format!(
                        "桌面协议版本不兼容: client={}, server={DESKTOP_PROTOCOL_VERSION}",
                        request.protocol_version
                    ),
                )
                .context("clientVersion", request.protocol_version)
                .context("serverVersion", DESKTOP_PROTOCOL_VERSION),
            );
        }

        match self
            .dispatch_method(request.method, request.params, host)
            .await
        {
            Ok(result) => DesktopResponse::success(request_id, result),
            Err(error) => DesktopResponse::failure(request_id, error),
        }
    }

    async fn dispatch_method(
        &self,
        method: DesktopMethod,
        params: Value,
        host: Option<&dyn DesktopHost>,
    ) -> Result<Value, AppError> {
        match method {
            DesktopMethod::SystemCapabilities => {
                let mut capabilities = DesktopCapabilities::default();
                if host.is_none() {
                    capabilities
                        .methods
                        .retain(|method| !method.requires_host());
                }
                to_value(capabilities)
            }
            DesktopMethod::RuntimeStatus => to_value(self.runtime.agent_status()?),
            DesktopMethod::RuntimeStart => {
                self.runtime.start().await?;
                Ok(Value::Null)
            }
            DesktopMethod::RuntimeStop => {
                self.runtime.stop().await;
                Ok(Value::Null)
            }
            DesktopMethod::RuntimeSnapshot => {
                let request: RuntimeSnapshotRequest = parse_params(params)?;
                to_value(self.runtime.runtime_snapshot(request.thread_id.as_deref()))
            }
            DesktopMethod::RuntimeDiagnostics => to_value(self.runtime.runtime_diagnostics()),
            DesktopMethod::EventReplay => {
                let request: EventReplayRequest = parse_params(params)?;
                let limit = request
                    .limit
                    .map_or(256, |value| value as usize)
                    .min(MAX_EVENT_REPLAY_LIMIT);
                if limit == 0 {
                    return Err(AppError::invalid("event.replay limit 必须大于 0"));
                }
                let window = self
                    .runtime
                    .event_replay_window(request.after_sequence, limit);
                let events = window
                    .events
                    .into_iter()
                    .filter(should_forward_desktop_event)
                    .map(DesktopEvent::from)
                    .collect::<Vec<_>>();
                let latest_sequence = window.newest_sequence.unwrap_or(0);
                let oldest_available_sequence = window.oldest_sequence;
                let requires_snapshot = window.contains_truncated
                    || oldest_available_sequence
                        .is_some_and(|oldest| request.after_sequence.saturating_add(1) < oldest);
                to_value(EventReplay {
                    events,
                    oldest_available_sequence,
                    latest_sequence,
                    next_sequence: window.scanned_cursor,
                    requires_snapshot,
                    has_more: window.has_more,
                })
            }
            DesktopMethod::PreferencesGet => to_value(self.runtime.preferences()?),
            DesktopMethod::PreferencesSave => {
                let request: PreferencePatchRequest = parse_params(params)?;
                to_value(self.runtime.save_preferences(request)?)
            }
            DesktopMethod::ThreadList => {
                let filters: ThreadFilters = parse_params(params)?;
                to_value(self.runtime.list_threads(filters).await?)
            }
            DesktopMethod::SchedulerGet => to_value(self.runtime.scheduler_snapshot()),
            DesktopMethod::TaskStart => {
                let request: TaskStartRequest = parse_params(params)?;
                let submission = self
                    .runtime
                    .send_prompt(onpeople_types::SendPromptRequest {
                        thread_id: request.thread_id,
                        text: request.text,
                        cwd: request.cwd,
                        workspace_mode: request.workspace_mode,
                        images: request.images,
                        attachments: request.attachments,
                        capability: request.capability,
                        mode: request.mode,
                        industry_plugin: request.industry_plugin,
                        model: request.model,
                        reasoning_effort: request.reasoning_effort,
                    })
                    .await?;
                to_value(TaskHandle {
                    task_id: submission.turn_id,
                    thread_id: submission.thread_id,
                    state: if submission.queued {
                        TaskState::Queued
                    } else {
                        TaskState::Running
                    },
                    accepted_at: chrono::Utc::now(),
                    last_sequence: self.runtime.event_cursor(),
                })
            }
            DesktopMethod::TaskCancel => {
                let request: TaskCancelRequest = parse_params(params)?;
                if request.thread_id.trim().is_empty() {
                    return Err(AppError::invalid("缺少 threadId"));
                }
                let active = self.runtime.runtime_snapshot(None);
                let task_id = request.task_id.or_else(|| {
                    (active.thread_id.as_deref() == Some(request.thread_id.as_str()))
                        .then_some(active.turn_id)
                        .flatten()
                });
                let task_id = task_id.ok_or_else(|| AppError::invalid("没有可中断的任务"))?;
                self.runtime
                    .interrupt(&json!({
                        "threadId": request.thread_id,
                        "turnId": task_id,
                    }))
                    .await?;
                to_value(TaskCancellation {
                    task_id,
                    thread_id: request.thread_id,
                    state: TaskState::Cancelling,
                    last_sequence: self.runtime.event_cursor(),
                })
            }
            DesktopMethod::TaskSnapshot => {
                let request: TaskSnapshotRequest = parse_params(params)?;
                to_value(task_snapshot(&self.runtime, request)?)
            }
            DesktopMethod::TaskResume => {
                let request: TaskResumeRequest = parse_params(params)?;
                if request.thread_id.trim().is_empty() {
                    return Err(AppError::invalid("缺少 threadId"));
                }
                let resume_payload = self.runtime.resume_thread(&request.thread_id).await?;
                let timeline = resume_payload
                    .get("onpeopleTimelineItems")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
                let snapshot = task_snapshot(
                    &self.runtime,
                    TaskSnapshotRequest {
                        thread_id: request.thread_id,
                        task_id: None,
                    },
                )?;
                to_value(TaskRecovery {
                    snapshot,
                    resume_payload,
                    timeline,
                })
            }
            DesktopMethod::TaskQueue => {
                let request: TaskQueueRequest = parse_params(params)?;
                let queued = self
                    .runtime
                    .queue_message(request.thread_id.as_deref(), &request.text)?;
                let queued: QueuedTaskMessage = parse_result(queued)?;
                to_value(queued)
            }
            DesktopMethod::TaskQueueDelete => {
                let request: TaskQueueItemRequest = parse_params(params)?;
                let deleted = self
                    .runtime
                    .delete_queued_message(request.thread_id.as_deref(), &request.queue_id)?;
                let deleted: TaskQueueDeletion = parse_result(deleted)?;
                to_value(deleted)
            }
            DesktopMethod::TaskSteer => {
                let request: TaskSteerRequest = parse_params(params)?;
                let thread_id = resolve_interaction_thread(&self.runtime, request.thread_id)?;
                let result = self
                    .runtime
                    .steer_turn(Some(&thread_id), &request.text)
                    .await?;
                to_value(TaskSteerReceipt {
                    accepted: true,
                    task_id: active_task_id(&self.runtime, &thread_id),
                    thread_id,
                    last_sequence: self.runtime.event_cursor(),
                    result,
                })
            }
            DesktopMethod::TaskQueueSteer => {
                let request: TaskQueueItemRequest = parse_params(params)?;
                let thread_id = resolve_interaction_thread(&self.runtime, request.thread_id)?;
                let result = self
                    .runtime
                    .steer_queued_message(Some(&thread_id), &request.queue_id)
                    .await?;
                let inner_result = result.get("result").cloned().unwrap_or(Value::Null);
                to_value(TaskQueueSteerReceipt {
                    accepted: true,
                    steered: result
                        .get("steered")
                        .and_then(Value::as_bool)
                        .unwrap_or(true),
                    id: request.queue_id,
                    task_id: active_task_id(&self.runtime, &thread_id),
                    thread_id,
                    last_sequence: self.runtime.event_cursor(),
                    result: inner_result,
                })
            }
            DesktopMethod::TaskApprovalResolve => {
                let request: TaskApprovalResolveRequest = parse_params(params)?;
                self.runtime
                    .resolve_approval(&request.request_id, request.decision.as_runtime_value())
                    .await?;
                to_value(TaskApprovalResolution {
                    request_id: request.request_id,
                    decision: request.decision,
                })
            }
            DesktopMethod::TaskInputResolve => {
                let request: TaskInputResolveRequest = parse_params(params)?;
                self.runtime
                    .resolve_user_input(&request.request_id, to_value(&request.answers)?)
                    .await?;
                to_value(TaskInputResolution {
                    request_id: request.request_id,
                    answered: true,
                })
            }
            DesktopMethod::BrowserState => {
                parse_empty(params)?;
                call_host(host, BrowserHostOperation::State, json!({})).await
            }
            DesktopMethod::BrowserRestart => {
                parse_empty(params)?;
                call_host(host, BrowserHostOperation::Restart, json!({})).await
            }
            DesktopMethod::BrowserCommand => {
                let request: BrowserCommandRequest = parse_params(params)?;
                call_host(host, BrowserHostOperation::Command, request.command).await
            }
            DesktopMethod::BrowserSurfaceBounds => {
                let request: onpeople_types::BrowserBoundsRequest = parse_params(params)?;
                call_host(
                    host,
                    BrowserHostOperation::SurfaceBounds,
                    to_value(request)?,
                )
                .await
            }
            DesktopMethod::BrowserAnnotationList => {
                let request: BrowserRouteRequest = parse_params(params)?;
                call_host(
                    host,
                    BrowserHostOperation::AnnotationList,
                    to_value(request)?,
                )
                .await
            }
            DesktopMethod::BrowserAnnotationSave => {
                let annotation: onpeople_types::BrowserAnnotation = parse_params(params)?;
                call_host(
                    host,
                    BrowserHostOperation::AnnotationSave,
                    to_value(annotation)?,
                )
                .await
            }
            DesktopMethod::BrowserAnnotationDelete => {
                let request: BrowserAnnotationDeleteRequest = parse_params(params)?;
                call_host(
                    host,
                    BrowserHostOperation::AnnotationDelete,
                    to_value(request)?,
                )
                .await
            }
            DesktopMethod::BrowserAction => {
                let request: BrowserActionRequest = parse_params(params)?;
                call_host(host, BrowserHostOperation::Action, to_value(request)?).await
            }
            DesktopMethod::PluginInstall => {
                let request: PluginPayloadRequest = parse_params(params)?;
                self.runtime.install_plugin(&to_value(request.plugin)?)
            }
            DesktopMethod::PluginUninstall => {
                let request: PluginIdRequest = parse_params(params)?;
                self.runtime
                    .uninstall_plugin(&json!({ "pluginId": request.plugin_id }))
            }
            DesktopMethod::PluginIndustryActivate => {
                let request: PluginPayloadRequest = parse_params(params)?;
                self.runtime
                    .activate_industry_plugin(&to_value(request.plugin)?)
            }
            DesktopMethod::PluginIndustryDeactivate => {
                let request: PluginIdRequest = parse_params(params)?;
                self.runtime
                    .deactivate_industry_plugin(&json!({ "pluginId": request.plugin_id }))
            }
            DesktopMethod::PluginMcpReload => {
                parse_empty(params)?;
                self.runtime.reload_mcp()
            }
            DesktopMethod::PluginCatalogSync => {
                let request: PluginCatalogSyncRequest = parse_params(params)?;
                self.runtime
                    .sync_plugin_catalog(&json!({ "url": request.url }))
                    .await
            }
            DesktopMethod::ConnectorOauthStart => {
                let request: PluginIdRequest = parse_params(params)?;
                self.runtime
                    .start_connector_oauth(&json!({ "pluginId": request.plugin_id }))
            }
            DesktopMethod::ConnectorOauthComplete => {
                let request: ConnectorOauthCompleteRequest = parse_params(params)?;
                self.runtime
                    .complete_connector_oauth(&to_value(request)?)
                    .await
            }
            DesktopMethod::ConnectorDisconnect => {
                let request: PluginIdRequest = parse_params(params)?;
                self.runtime
                    .disconnect_connector(&json!({ "pluginId": request.plugin_id }))
            }
        }
    }
}

async fn call_host(
    host: Option<&dyn DesktopHost>,
    operation: BrowserHostOperation,
    params: Value,
) -> Result<Value, AppError> {
    let host = host.ok_or_else(|| {
        AppError::new(ErrorCode::Unsupported, "当前桌面适配器不支持浏览器宿主能力")
    })?;
    host.browser(operation, params).await
}

fn resolve_interaction_thread(
    runtime: &CoreRuntime,
    requested: Option<String>,
) -> Result<String, AppError> {
    requested
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .or_else(|| runtime.runtime_snapshot(None).thread_id)
        .ok_or_else(|| AppError::invalid("没有正在运行的任务"))
}

fn active_task_id(runtime: &CoreRuntime, thread_id: &str) -> Option<String> {
    let snapshot = runtime.runtime_snapshot(None);
    (snapshot.thread_id.as_deref() == Some(thread_id))
        .then_some(snapshot.turn_id)
        .flatten()
}

fn task_snapshot(
    runtime: &CoreRuntime,
    request: TaskSnapshotRequest,
) -> Result<TaskSnapshot, AppError> {
    if request.thread_id.trim().is_empty() {
        return Err(AppError::invalid("缺少 threadId"));
    }
    let runtime_snapshot = runtime.runtime_snapshot(None);
    let is_active_thread =
        runtime_snapshot.thread_id.as_deref() == Some(request.thread_id.as_str());
    let task_id = if is_active_thread {
        runtime_snapshot.turn_id.clone()
    } else {
        None
    };
    let state = if !is_active_thread || task_id.is_none() {
        TaskState::Ready
    } else if let Some(expected) = request.task_id.as_deref() {
        if task_id.as_deref() == Some(expected) {
            task_state(&runtime_snapshot.state)
        } else {
            TaskState::Unknown
        }
    } else {
        task_state(&runtime_snapshot.state)
    };
    Ok(TaskSnapshot {
        task_id,
        thread_id: request.thread_id,
        state,
        queued_messages: runtime_snapshot.queued_messages,
        pending_approvals: runtime_snapshot.pending_approvals,
        last_sequence: runtime.event_cursor(),
    })
}

fn task_state(runtime_state: &str) -> TaskState {
    match runtime_state {
        "working" => TaskState::Running,
        "queued" => TaskState::Queued,
        "waiting-approval" | "waiting-input" | "recovering" => TaskState::Waiting,
        "unavailable" => TaskState::Failed,
        "ready" | "stopped" => TaskState::Ready,
        _ => TaskState::Unknown,
    }
}

fn parse_params<T: DeserializeOwned>(params: Value) -> Result<T, AppError> {
    serde_json::from_value(params)
        .map_err(|error| AppError::invalid("桌面 API 参数无效").context("cause", error))
}

fn parse_empty(params: Value) -> Result<(), AppError> {
    let fields: std::collections::BTreeMap<String, Value> = parse_params(params)?;
    if fields.is_empty() {
        Ok(())
    } else {
        Err(AppError::invalid("桌面 API 参数无效"))
    }
}

fn parse_result<T: DeserializeOwned>(result: Value) -> Result<T, AppError> {
    serde_json::from_value(result)
        .map_err(|error| AppError::internal("CoreRuntime 返回了无效结果").context("cause", error))
}

fn to_value(value: impl Serialize) -> Result<Value, AppError> {
    serde_json::to_value(value).map_err(AppError::internal)
}

#[cfg(test)]
mod tests {
    use super::*;
    use onpeople_storage::Storage;
    use serde_json::json;
    use std::sync::Mutex;

    #[derive(Default)]
    struct FakeDesktopHost {
        calls: Mutex<Vec<(BrowserHostOperation, Value)>>,
    }

    impl DesktopHost for FakeDesktopHost {
        fn browser<'a>(
            &'a self,
            operation: BrowserHostOperation,
            params: Value,
        ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Value, AppError>> + Send + 'a>>
        {
            Box::pin(async move {
                self.calls
                    .lock()
                    .expect("fake host calls")
                    .push((operation, params));
                Ok(
                    json!({ "hostReady": true, "hostStatus": "ready", "activeRouteId": null, "tabs": [], "profilePath": "/tmp/profile" }),
                )
            })
        }
    }

    #[test]
    fn rejects_invalid_params_without_exposing_payload() {
        let error = parse_params::<RuntimeSnapshotRequest>(json!({ "unknown": true }))
            .expect_err("unknown fields must be rejected");
        assert_eq!(error.code, ErrorCode::InvalidRequest);
        assert_eq!(error.message, "桌面 API 参数无效");
    }

    #[tokio::test]
    async fn dispatches_a_versioned_request_to_core_runtime() {
        let temporary = tempfile::tempdir().expect("temporary data root");
        let storage =
            Storage::open_empty(temporary.path().join("data")).expect("open empty storage");
        let runtime = Arc::new(
            CoreRuntime::new(storage, temporary.path().join("runtime"))
                .expect("create core runtime"),
        );
        let dispatcher = DesktopDispatcher::new(Arc::clone(&runtime));

        let response = dispatcher
            .dispatch(DesktopRequest {
                protocol_version: DESKTOP_PROTOCOL_VERSION,
                request_id: "contract-1".to_owned(),
                method: DesktopMethod::PreferencesGet,
                params: json!({}),
            })
            .await;

        assert!(response.ok, "unexpected response: {response:?}");
        assert_eq!(response.request_id, "contract-1");
        assert_eq!(
            response
                .result
                .as_ref()
                .and_then(|value| value.get("theme"))
                .and_then(Value::as_str),
            Some("system")
        );
        runtime.stop().await;
    }

    #[tokio::test]
    async fn browser_methods_require_and_use_a_shell_host_port() {
        let temporary = tempfile::tempdir().expect("temporary data root");
        let storage =
            Storage::open_empty(temporary.path().join("data")).expect("open empty storage");
        let runtime = Arc::new(
            CoreRuntime::new(storage, temporary.path().join("runtime"))
                .expect("create core runtime"),
        );
        let dispatcher = DesktopDispatcher::new(Arc::clone(&runtime));
        let request = || DesktopRequest {
            protocol_version: DESKTOP_PROTOCOL_VERSION,
            request_id: "browser-state-1".to_owned(),
            method: DesktopMethod::BrowserState,
            params: json!({}),
        };

        let unsupported = dispatcher.dispatch(request()).await;
        assert!(!unsupported.ok);
        assert_eq!(
            unsupported.error.as_ref().map(|error| error.code),
            Some(ErrorCode::Unsupported)
        );

        let host = FakeDesktopHost::default();
        let response = dispatcher.dispatch_with_host(request(), &host).await;
        assert!(response.ok, "unexpected response: {response:?}");
        {
            let calls = host.calls.lock().expect("fake host calls");
            assert_eq!(calls.len(), 1);
            assert_eq!(calls[0].0, BrowserHostOperation::State);
        }
        runtime.stop().await;
    }

    #[tokio::test]
    async fn task_snapshot_is_ready_for_an_inactive_thread() {
        let temporary = tempfile::tempdir().expect("temporary data root");
        let storage =
            Storage::open_empty(temporary.path().join("data")).expect("open empty storage");
        let runtime = Arc::new(
            CoreRuntime::new(storage, temporary.path().join("runtime"))
                .expect("create core runtime"),
        );
        let dispatcher = DesktopDispatcher::new(Arc::clone(&runtime));

        let response = dispatcher
            .dispatch(DesktopRequest {
                protocol_version: DESKTOP_PROTOCOL_VERSION,
                request_id: "task-snapshot-1".to_owned(),
                method: DesktopMethod::TaskSnapshot,
                params: json!({ "threadId": "thread-1", "taskId": null }),
            })
            .await;

        assert!(response.ok, "unexpected response: {response:?}");
        assert_eq!(
            response
                .result
                .as_ref()
                .and_then(|value| value.get("state"))
                .and_then(Value::as_str),
            Some("ready")
        );
        runtime.stop().await;
    }

    #[tokio::test]
    async fn event_replay_rejects_zero_limit_and_reports_an_empty_window() {
        let temporary = tempfile::tempdir().expect("temporary data root");
        let storage =
            Storage::open_empty(temporary.path().join("data")).expect("open empty storage");
        let runtime = Arc::new(
            CoreRuntime::new(storage, temporary.path().join("runtime"))
                .expect("create core runtime"),
        );
        let dispatcher = DesktopDispatcher::new(Arc::clone(&runtime));

        let rejected = dispatcher
            .dispatch(DesktopRequest {
                protocol_version: DESKTOP_PROTOCOL_VERSION,
                request_id: "replay-zero".to_owned(),
                method: DesktopMethod::EventReplay,
                params: json!({ "afterSequence": 0, "limit": 0 }),
            })
            .await;
        assert!(!rejected.ok);
        assert_eq!(
            rejected.error.as_ref().map(|error| error.code),
            Some(ErrorCode::InvalidRequest)
        );

        let response = dispatcher
            .dispatch(DesktopRequest {
                protocol_version: DESKTOP_PROTOCOL_VERSION,
                request_id: "replay-empty".to_owned(),
                method: DesktopMethod::EventReplay,
                params: json!({ "afterSequence": 0, "limit": null }),
            })
            .await;
        assert!(response.ok, "unexpected response: {response:?}");
        let replay: EventReplay = serde_json::from_value(response.result.expect("replay result"))
            .expect("typed replay result");
        assert!(replay.events.is_empty());
        assert_eq!(replay.latest_sequence, 0);
        assert_eq!(replay.next_sequence, 0);
        assert!(!replay.requires_snapshot);
        assert!(!replay.has_more);
        runtime.stop().await;
    }

    #[tokio::test]
    async fn task_queue_and_delete_use_typed_contracts() {
        let temporary = tempfile::tempdir().expect("temporary data root");
        let storage =
            Storage::open_empty(temporary.path().join("data")).expect("open empty storage");
        let runtime = Arc::new(
            CoreRuntime::new(storage, temporary.path().join("runtime"))
                .expect("create core runtime"),
        );
        let dispatcher = DesktopDispatcher::new(Arc::clone(&runtime));

        let queued = dispatcher
            .dispatch(DesktopRequest {
                protocol_version: DESKTOP_PROTOCOL_VERSION,
                request_id: "task-queue-1".to_owned(),
                method: DesktopMethod::TaskQueue,
                params: json!({ "threadId": "thread-1", "text": "继续检查" }),
            })
            .await;
        assert!(queued.ok, "unexpected response: {queued:?}");
        let queued: QueuedTaskMessage =
            serde_json::from_value(queued.result.expect("queue result"))
                .expect("typed queue result");
        assert_eq!(queued.thread_id, "thread-1");
        assert_eq!(queued.text, "继续检查");

        let deleted = dispatcher
            .dispatch(DesktopRequest {
                protocol_version: DESKTOP_PROTOCOL_VERSION,
                request_id: "task-queue-delete-1".to_owned(),
                method: DesktopMethod::TaskQueueDelete,
                params: json!({ "threadId": "thread-1", "queueId": queued.id }),
            })
            .await;
        assert!(deleted.ok, "unexpected response: {deleted:?}");
        assert_eq!(
            deleted
                .result
                .as_ref()
                .and_then(|value| value.get("deleted"))
                .and_then(Value::as_bool),
            Some(true)
        );
        runtime.stop().await;
    }

    #[test]
    fn maps_runtime_states_to_stable_task_states() {
        assert_eq!(task_state("working"), TaskState::Running);
        assert_eq!(task_state("waiting-approval"), TaskState::Waiting);
        assert_eq!(task_state("queued"), TaskState::Queued);
        assert_eq!(task_state("unexpected"), TaskState::Unknown);
    }
}
