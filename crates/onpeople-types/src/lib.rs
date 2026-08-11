mod api;
mod domain;
mod error;
mod events;

pub use api::*;
pub use domain::*;
pub use error::*;
pub use events::*;

use std::path::Path;

use ts_rs::{Config, TS};

pub fn export_types(output: &Path) -> Result<(), String> {
    std::fs::create_dir_all(output).map_err(|error| error.to_string())?;
    let config = Config::default().with_out_dir(output);
    macro_rules! export {
        ($($type:ty),+ $(,)?) => {
            $(<$type as TS>::export(&config).map_err(|error| error.to_string())?;)+
        };
    }
    export!(
        AppError,
        ErrorCode,
        EmptyRequest,
        IdRequest,
        ThreadRequest,
        ThreadMutationRequest,
        TextRequest,
        PathRequest,
        ThreadFilters,
        SendPromptRequest,
        GoalRequest,
        GoalUpdateRequest,
        ProviderRequest,
        SaveProviderRequest,
        ReasoningRequest,
        TerminalStartRequest,
        TerminalIdRequest,
        TerminalWriteRequest,
        TerminalResizeRequest,
        GitRequest,
        GitFileRequest,
        GitMutationRequest,
        GitCommitRequest,
        GitPushRequest,
        WorktreeRequest,
        ScheduledTaskRequest,
        ScheduledTaskMutationRequest,
        PreferencePatchRequest,
        AgentStatus,
        CapabilityStatus,
        RuntimeSnapshot,
        RuntimeDiagnostics,
        Goal,
        GoalStatus,
        Preferences,
        ProviderSettings,
        ProviderKind,
        ModelDescriptor,
        ThreadSummary,
        ThreadList,
        ProjectSummary,
        PromptSubmission,
        TerminalSession,
        TerminalExit,
        GitState,
        GitFileState,
        GitDiff,
        WorktreeSummary,
        ScheduledTask,
        ScheduledRun,
        SchedulerSnapshot,
        AgentProfile,
        AgentTask,
        MemoryRecord,
        UsageSnapshot,
        SecretMetadata,
        CloudAccountState,
        LiveStatus,
        AppUpdateState,
        FileEntry,
        FileSearchResult,
        ProjectAction,
        ExtensionSnapshot,
        Policy,
        EventEnvelope,
        EventKind,
        StreamEnvelope,
        StreamKind,
    );
    Ok(())
}
