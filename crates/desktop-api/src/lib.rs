mod dispatcher;
mod protocol;

pub use dispatcher::DesktopDispatcher;
pub use protocol::{
    DESKTOP_PROTOCOL_VERSION, DesktopCapabilities, DesktopEvent, DesktopMethod, DesktopRequest,
    DesktopResponse, RuntimeSnapshotRequest, TaskCancelRequest, TaskCancellation, TaskHandle,
    TaskSnapshot, TaskSnapshotRequest, TaskStartRequest, TaskState, export_types,
};
