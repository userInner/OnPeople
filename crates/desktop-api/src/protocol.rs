use std::path::Path;

use chrono::{DateTime, Utc};
use onpeople_types::AppError;
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
}

impl DesktopMethod {
    pub const ALL: [Self; 10] = [
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
            ordered_events: false,
            reconnectable: false,
        }
    }
}

#[derive(Debug, Default, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct RuntimeSnapshotRequest {
    #[serde(default)]
    pub thread_id: Option<String>,
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
}
