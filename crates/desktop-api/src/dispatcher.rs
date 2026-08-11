use std::sync::Arc;

use onpeople_core_runtime::CoreRuntime;
use onpeople_types::{AppError, ErrorCode, PreferencePatchRequest, ThreadFilters};
use serde::{Serialize, de::DeserializeOwned};
use serde_json::Value;

use crate::{
    DESKTOP_PROTOCOL_VERSION, DesktopCapabilities, DesktopMethod, DesktopRequest, DesktopResponse,
    RuntimeSnapshotRequest,
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
        }
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
}
