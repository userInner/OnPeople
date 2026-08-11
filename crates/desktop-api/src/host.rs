use std::{future::Future, pin::Pin};

use onpeople_types::AppError;
use serde_json::Value;

use crate::{BrowserHostOperation, ShellHostOperation};

/// Shell-owned capabilities used by the stable desktop protocol.
///
/// `CoreRuntime` and the protocol never depend on Tauri. Tauri, Electron, or a
/// headless test host can implement this port independently.
pub trait DesktopHost: Send + Sync {
    fn browser<'a>(
        &'a self,
        operation: BrowserHostOperation,
        params: Value,
    ) -> Pin<Box<dyn Future<Output = Result<Value, AppError>> + Send + 'a>>;

    fn shell<'a>(
        &'a self,
        operation: ShellHostOperation,
        params: Value,
    ) -> Pin<Box<dyn Future<Output = Result<Value, AppError>> + Send + 'a>>;
}
