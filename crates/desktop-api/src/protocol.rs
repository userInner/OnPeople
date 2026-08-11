use std::path::Path;

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
}

impl DesktopMethod {
    pub const ALL: [Self; 14] = [
        Self::SystemCapabilities,
        Self::RuntimeStatus,
        Self::RuntimeStart,
        Self::RuntimeStop,
        Self::RuntimeSnapshot,
        Self::RuntimeDiagnostics,
        Self::PreferencesGet,
        Self::PreferencesSave,
        Self::ThreadList,
        Self::SchedulerGet,
        Self::TaskStart,
        Self::TaskCancel,
        Self::TaskSnapshot,
        Self::TaskResume,
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
            reconnectable: false,
        }
    }
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
}
