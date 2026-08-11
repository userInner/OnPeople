use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use thiserror::Error;
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(export)]
pub enum ErrorCode {
    InvalidRequest,
    NotFound,
    Conflict,
    PermissionDenied,
    WorkspaceBoundary,
    RuntimeUnavailable,
    RuntimeProtocol,
    RuntimeTimeout,
    ProcessFailed,
    Network,
    RateLimited,
    Authentication,
    Storage,
    Migration,
    Keychain,
    Cancelled,
    Unsupported,
    Internal,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, Error)]
#[error("{message}")]
#[ts(export)]
pub struct AppError {
    pub code: ErrorCode,
    pub message: String,
    pub retryable: bool,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub context: BTreeMap<String, String>,
}

impl AppError {
    #[must_use]
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            retryable: false,
            context: BTreeMap::new(),
        }
    }

    #[must_use]
    pub const fn retryable(mut self, value: bool) -> Self {
        self.retryable = value;
        self
    }

    #[must_use]
    pub fn context(mut self, key: impl Into<String>, value: impl std::fmt::Display) -> Self {
        let value = value.to_string();
        self.context.insert(key.into(), redact(&value));
        self
    }

    #[must_use]
    pub fn invalid(message: impl std::fmt::Display) -> Self {
        Self::new(ErrorCode::InvalidRequest, message.to_string())
    }

    #[must_use]
    pub fn storage(error: impl std::fmt::Display) -> Self {
        Self::new(ErrorCode::Storage, "无法读写 OnPeople 数据").context("cause", error.to_string())
    }

    #[must_use]
    pub fn network(error: impl std::fmt::Display) -> Self {
        Self::new(ErrorCode::Network, "网络请求失败")
            .retryable(true)
            .context("cause", error.to_string())
    }

    #[must_use]
    pub fn internal(error: impl std::fmt::Display) -> Self {
        Self::new(ErrorCode::Internal, "OnPeople 内部服务发生错误")
            .context("cause", error.to_string())
    }
}

fn redact(value: &str) -> String {
    let lower = value.to_ascii_lowercase();
    if lower.contains("bearer ")
        || lower.contains("api_key")
        || lower.contains("apikey")
        || lower.contains("password")
        || lower.contains("secret")
        || lower.contains("token=")
    {
        "[REDACTED]".to_owned()
    } else {
        value.chars().take(512).collect()
    }
}

impl From<std::io::Error> for AppError {
    fn from(value: std::io::Error) -> Self {
        Self::storage(value)
    }
}
