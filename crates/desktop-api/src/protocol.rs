use std::{collections::BTreeMap, path::Path};

use chrono::{DateTime, Utc};
use onpeople_types::{AppError, EventEnvelope, EventKind};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::{Config, TS};

pub const DESKTOP_PROTOCOL_VERSION: u16 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum DesktopMethod {
    #[serde(rename = "system.capabilities")]
    SystemCapabilities,
    #[serde(rename = "runtime.status")]
    RuntimeStatus,
    #[serde(rename = "runtime.start")]
    RuntimeStart,
    #[serde(rename = "runtime.stop")]
    RuntimeStop,
    #[serde(rename = "runtime.snapshot")]
    RuntimeSnapshot,
    #[serde(rename = "runtime.diagnostics")]
    RuntimeDiagnostics,
    #[serde(rename = "event.replay")]
    EventReplay,
    #[serde(rename = "preferences.get")]
    PreferencesGet,
    #[serde(rename = "preferences.save")]
    PreferencesSave,
    #[serde(rename = "thread.list")]
    ThreadList,
    #[serde(rename = "scheduler.get")]
    SchedulerGet,
    #[serde(rename = "task.start")]
    TaskStart,
    #[serde(rename = "task.cancel")]
    TaskCancel,
    #[serde(rename = "task.snapshot")]
    TaskSnapshot,
    #[serde(rename = "task.resume")]
    TaskResume,
    #[serde(rename = "task.queue")]
    TaskQueue,
    #[serde(rename = "task.queue.delete")]
    TaskQueueDelete,
    #[serde(rename = "task.steer")]
    TaskSteer,
    #[serde(rename = "task.queue.steer")]
    TaskQueueSteer,
    #[serde(rename = "task.approval.resolve")]
    TaskApprovalResolve,
    #[serde(rename = "task.input.resolve")]
    TaskInputResolve,
}

impl DesktopMethod {
    pub const ALL: [Self; 21] = [
        Self::SystemCapabilities,
        Self::RuntimeStatus,
        Self::RuntimeStart,
        Self::RuntimeStop,
        Self::RuntimeSnapshot,
        Self::RuntimeDiagnostics,
        Self::EventReplay,
        Self::PreferencesGet,
        Self::PreferencesSave,
        Self::ThreadList,
        Self::SchedulerGet,
        Self::TaskStart,
        Self::TaskCancel,
        Self::TaskSnapshot,
        Self::TaskResume,
        Self::TaskQueue,
        Self::TaskQueueDelete,
        Self::TaskSteer,
        Self::TaskQueueSteer,
        Self::TaskApprovalResolve,
        Self::TaskInputResolve,
    ];
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct DesktopRequest {
    pub protocol_version: u16,
    pub request_id: String,
    pub method: DesktopMethod,
    #[serde(default)]
    pub params: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DesktopResponse {
    pub protocol_version: u16,
    pub request_id: String,
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<AppError>,
}

impl DesktopResponse {
    #[must_use]
    pub fn success(request_id: String, result: Value) -> Self {
        Self {
            protocol_version: DESKTOP_PROTOCOL_VERSION,
            request_id,
            ok: true,
            result: Some(result),
            error: None,
        }
    }

    #[must_use]
    pub fn failure(request_id: String, error: AppError) -> Self {
        Self {
            protocol_version: DESKTOP_PROTOCOL_VERSION,
            request_id,
            ok: false,
            result: None,
            error: Some(error),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DesktopEvent {
    pub protocol_version: u16,
    #[ts(type = "number")]
    pub sequence: u64,
    pub topic: String,
    pub emitted_at: DateTime<Utc>,
    #[serde(default)]
    pub thread_id: Option<String>,
    #[serde(default)]
    pub task_id: Option<String>,
    pub payload: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DesktopCapabilities {
    pub protocol_version: u16,
    pub methods: Vec<DesktopMethod>,
    pub ordered_events: bool,
    pub reconnectable: bool,
}

impl Default for DesktopCapabilities {
    fn default() -> Self {
        Self {
            protocol_version: DESKTOP_PROTOCOL_VERSION,
            methods: DesktopMethod::ALL.to_vec(),
            ordered_events: true,
            // The service exposes event.replay, but shell adapters do not yet
            // provide a transport-level reconnect handshake on every host.
            reconnectable: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct EventReplayRequest {
    #[ts(type = "number")]
    pub after_sequence: u64,
    #[serde(default)]
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct EventReplay {
    pub events: Vec<DesktopEvent>,
    #[serde(default)]
    #[ts(type = "number | null")]
    pub oldest_available_sequence: Option<u64>,
    #[ts(type = "number")]
    pub latest_sequence: u64,
    #[ts(type = "number")]
    pub next_sequence: u64,
    pub requires_snapshot: bool,
    pub has_more: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DesktopRecoveryRequired {
    pub reason: String,
    #[ts(type = "number")]
    pub after_sequence: u64,
    #[serde(default)]
    #[ts(type = "number | null")]
    pub oldest_available_sequence: Option<u64>,
    #[ts(type = "number")]
    pub latest_sequence: u64,
}

/// Returns whether a runtime event belongs to the public desktop event stream.
///
/// Live shell adapters and replay must use this same predicate so reconnecting
/// cannot reveal bookkeeping events that were absent from the live stream.
#[must_use]
pub fn should_forward_desktop_event(event: &EventEnvelope) -> bool {
    if !matches!(event.kind, EventKind::Agent) {
        return true;
    }
    let method = event
        .payload
        .get("method")
        .and_then(Value::as_str)
        .or_else(|| event.payload.get("originalMethod").and_then(Value::as_str))
        .or_else(|| event.payload.get("type").and_then(Value::as_str));
    let Some(method) = method else {
        return true;
    };
    !(method == "fs/changed"
        || method == "skills/changed"
        || method.starts_with("mcpServer/")
        || method.starts_with("account/rateLimits/")
        || method.starts_with("remoteControl/")
        || method.starts_with("externalAgentConfig/"))
}

impl From<EventEnvelope> for DesktopEvent {
    fn from(event: EventEnvelope) -> Self {
        let task_id = event
            .payload
            .get("taskId")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned);
        Self {
            protocol_version: DESKTOP_PROTOCOL_VERSION,
            sequence: event.sequence,
            topic: event_topic(event.kind).to_owned(),
            emitted_at: event.emitted_at,
            thread_id: event.thread_id,
            task_id,
            payload: event.payload,
        }
    }
}

const fn event_topic(kind: EventKind) -> &'static str {
    match kind {
        EventKind::Agent => "agent",
        EventKind::Runtime => "runtime",
        EventKind::BrowserState => "browser-state",
        EventKind::BrowserNavigation => "browser-navigation",
        EventKind::BrowserPreview => "browser-preview",
        EventKind::BrowserNewTab => "browser-new-tab",
        EventKind::Scheduler => "scheduler",
        EventKind::SchedulerOpen => "scheduler-open",
        EventKind::CloudAccount => "cloud-account",
        EventKind::AppUpdate => "app-update",
        EventKind::Preferences => "preferences",
        EventKind::DeepLink => "deep-link",
        EventKind::CommandPalette => "command-palette",
        EventKind::TerminalMenu => "terminal-menu",
    }
}

#[derive(Debug, Default, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct RuntimeSnapshotRequest {
    #[serde(default)]
    pub thread_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct TaskStartRequest {
    #[serde(default)]
    pub thread_id: Option<String>,
    pub text: String,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub workspace_mode: Option<String>,
    #[serde(default)]
    pub images: Vec<String>,
    #[serde(default)]
    pub attachments: Vec<String>,
    #[serde(default)]
    pub capability: Option<String>,
    #[serde(default)]
    pub mode: Option<String>,
    #[serde(default)]
    pub industry_plugin: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub reasoning_effort: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct TaskCancelRequest {
    pub thread_id: String,
    #[serde(default)]
    pub task_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct TaskSnapshotRequest {
    pub thread_id: String,
    #[serde(default)]
    pub task_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct TaskResumeRequest {
    pub thread_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum TaskState {
    Ready,
    Running,
    Waiting,
    Queued,
    Cancelling,
    Cancelled,
    Failed,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TaskHandle {
    pub task_id: String,
    pub thread_id: String,
    pub state: TaskState,
    pub accepted_at: DateTime<Utc>,
    #[ts(type = "number")]
    pub last_sequence: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TaskSnapshot {
    #[serde(default)]
    pub task_id: Option<String>,
    pub thread_id: String,
    pub state: TaskState,
    pub queued_messages: u32,
    pub pending_approvals: u32,
    #[ts(type = "number")]
    pub last_sequence: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TaskCancellation {
    pub task_id: String,
    pub thread_id: String,
    pub state: TaskState,
    #[ts(type = "number")]
    pub last_sequence: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TaskRecovery {
    pub snapshot: TaskSnapshot,
    pub resume_payload: Value,
    pub timeline: Vec<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct TaskQueueRequest {
    #[serde(default)]
    pub thread_id: Option<String>,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct QueuedTaskMessage {
    pub id: String,
    pub thread_id: String,
    pub text: String,
    pub queued_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct TaskQueueItemRequest {
    #[serde(default)]
    pub thread_id: Option<String>,
    pub queue_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TaskQueueDeletion {
    pub deleted: bool,
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct TaskSteerRequest {
    #[serde(default)]
    pub thread_id: Option<String>,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TaskSteerReceipt {
    pub accepted: bool,
    pub thread_id: String,
    #[serde(default)]
    pub task_id: Option<String>,
    #[ts(type = "number")]
    pub last_sequence: u64,
    pub result: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TaskQueueSteerReceipt {
    pub steered: bool,
    pub accepted: bool,
    pub id: String,
    pub thread_id: String,
    #[serde(default)]
    pub task_id: Option<String>,
    #[ts(type = "number")]
    pub last_sequence: u64,
    pub result: Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ApprovalDecision {
    Accept,
    AcceptForSession,
    Decline,
}

impl ApprovalDecision {
    #[must_use]
    pub const fn as_runtime_value(self) -> &'static str {
        match self {
            Self::Accept => "accept",
            Self::AcceptForSession => "acceptForSession",
            Self::Decline => "decline",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct TaskApprovalResolveRequest {
    pub request_id: String,
    pub decision: ApprovalDecision,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TaskApprovalResolution {
    pub request_id: String,
    pub decision: ApprovalDecision,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct TaskInputResolveRequest {
    pub request_id: String,
    pub answers: BTreeMap<String, Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TaskInputResolution {
    pub request_id: String,
    pub answered: bool,
}

pub fn export_types(output: &Path) -> Result<(), String> {
    std::fs::create_dir_all(output).map_err(|error| error.to_string())?;
    let config = Config::default().with_out_dir(output);
    macro_rules! export {
        ($($type:ty),+ $(,)?) => {
            $(<$type as TS>::export(&config).map_err(|error| error.to_string())?;)+
        };
    }
    export!(
        DesktopMethod,
        DesktopRequest,
        DesktopResponse,
        DesktopEvent,
        DesktopCapabilities,
        EventReplayRequest,
        EventReplay,
        DesktopRecoveryRequired,
        RuntimeSnapshotRequest,
        TaskStartRequest,
        TaskCancelRequest,
        TaskSnapshotRequest,
        TaskResumeRequest,
        TaskState,
        TaskHandle,
        TaskSnapshot,
        TaskCancellation,
        TaskRecovery,
        TaskQueueRequest,
        QueuedTaskMessage,
        TaskQueueItemRequest,
        TaskQueueDeletion,
        TaskSteerRequest,
        TaskSteerReceipt,
        TaskQueueSteerReceipt,
        ApprovalDecision,
        TaskApprovalResolveRequest,
        TaskApprovalResolution,
        TaskInputResolveRequest,
        TaskInputResolution,
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_stable_method_names() {
        assert_eq!(
            serde_json::to_string(&DesktopMethod::RuntimeSnapshot).expect("serialize method"),
            r#""runtime.snapshot""#
        );
    }

    #[test]
    fn serializes_interaction_contract_names_and_decisions() {
        assert_eq!(
            serde_json::to_string(&DesktopMethod::TaskApprovalResolve).expect("serialize method"),
            r#""task.approval.resolve""#
        );
        assert_eq!(
            serde_json::to_string(&ApprovalDecision::AcceptForSession).expect("serialize decision"),
            r#""acceptForSession""#
        );
    }

    #[test]
    fn response_preserves_request_identity() {
        let response = DesktopResponse::success("request-42".to_owned(), Value::Null);
        assert_eq!(response.protocol_version, DESKTOP_PROTOCOL_VERSION);
        assert_eq!(response.request_id, "request-42");
        assert!(response.ok);
    }

    #[test]
    fn desktop_event_preserves_runtime_ordering() {
        let emitted_at = Utc::now();
        let event = DesktopEvent::from(EventEnvelope {
            sequence: 41,
            kind: EventKind::Agent,
            emitted_at,
            window_label: Some("main".to_owned()),
            thread_id: Some("thread-1".to_owned()),
            payload: serde_json::json!({ "taskId": "task-1", "method": "turn/started" }),
        });

        assert_eq!(event.sequence, 41);
        assert_eq!(event.topic, "agent");
        assert_eq!(event.thread_id.as_deref(), Some("thread-1"));
        assert_eq!(event.task_id.as_deref(), Some("task-1"));
        assert_eq!(event.emitted_at, emitted_at);
    }

    #[test]
    fn desktop_event_filter_hides_only_internal_agent_bookkeeping() {
        let event = |method: &str| EventEnvelope {
            sequence: 1,
            kind: EventKind::Agent,
            emitted_at: Utc::now(),
            window_label: Some("main".to_owned()),
            thread_id: None,
            payload: serde_json::json!({ "method": method }),
        };

        assert!(!should_forward_desktop_event(&event("fs/changed")));
        assert!(!should_forward_desktop_event(&event("mcpServer/updated")));
        assert!(should_forward_desktop_event(&event("turn/started")));
        let truncated_internal = EventEnvelope {
            payload: serde_json::json!({
                "type": "event-history-truncated",
                "originalMethod": "skills/changed"
            }),
            ..event("turn/started")
        };
        assert!(!should_forward_desktop_event(&truncated_internal));
    }
}
