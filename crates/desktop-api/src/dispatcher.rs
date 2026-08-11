use std::sync::Arc;

use onpeople_core_runtime::CoreRuntime;
use onpeople_types::{AppError, ErrorCode, PreferencePatchRequest, ThreadFilters};
use serde::{Serialize, de::DeserializeOwned};
use serde_json::{Value, json};

use crate::{
    DESKTOP_PROTOCOL_VERSION, DesktopCapabilities, DesktopMethod, DesktopRequest, DesktopResponse,
    RuntimeSnapshotRequest, TaskCancelRequest, TaskCancellation, TaskHandle, TaskRecovery,
    TaskResumeRequest, TaskSnapshot, TaskSnapshotRequest, TaskStartRequest, TaskState,
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

        match self.dispatch_method(request.method, request.params).await {
            Ok(result) => DesktopResponse::success(request_id, result),
            Err(error) => DesktopResponse::failure(request_id, error),
        }
    }

    async fn dispatch_method(
        &self,
        method: DesktopMethod,
        params: Value,
    ) -> Result<Value, AppError> {
        match method {
            DesktopMethod::SystemCapabilities => to_value(DesktopCapabilities::default()),
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
        }
    }
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

fn to_value(value: impl Serialize) -> Result<Value, AppError> {
    serde_json::to_value(value).map_err(AppError::internal)
}

#[cfg(test)]
mod tests {
    use super::*;
    use onpeople_storage::Storage;
    use serde_json::json;

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

    #[test]
    fn maps_runtime_states_to_stable_task_states() {
        assert_eq!(task_state("working"), TaskState::Running);
        assert_eq!(task_state("waiting-approval"), TaskState::Waiting);
        assert_eq!(task_state("queued"), TaskState::Queued);
        assert_eq!(task_state("unexpected"), TaskState::Unknown);
    }
}
