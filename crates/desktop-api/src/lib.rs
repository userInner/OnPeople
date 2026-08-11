mod dispatcher;
mod host;
mod protocol;

pub use dispatcher::DesktopDispatcher;
pub use host::DesktopHost;
pub use protocol::{
    AgentIdRequest, AgentListRequest, AgentMessageRequest, AgentProfileIdRequest,
    AgentProfileSaveRequest, ApprovalDecision, AuthorizedProjectAction, BrowserAction,
    BrowserActionRequest, BrowserAnnotationDeleteRequest, BrowserCommandRequest,
    BrowserHostOperation, BrowserRouteRequest, CloudGroupSelectRequest, CloudLoginRequest,
    CloudPayloadRequest, CloudRedeemRequest, CloudRegisterRequest, CloudRegistrationCodeRequest,
    ConnectorOauthCompleteRequest, ContextRequest, DESKTOP_PROTOCOL_VERSION, DesktopBrowserCommand,
    DesktopCapabilities, DesktopEvent, DesktopMethod, DesktopRecoveryRequired, DesktopRequest,
    DesktopResponse, EffectiveConfig, EffectiveConfigRequest, EventReplay, EventReplayRequest,
    ExtensionsListRequest, ExtensionsSnapshot, FileListRequest, FilePreview, FilePreviewRequest,
    FileSearchRequest, GeneratedImage, GitHunkMutationRequest, GitPullRequestRequest,
    GitReviewStartRequest, GitReviewSubmitRequest, HookCreateRequest, HookDefinition,
    HookListRequest, LiveCloseRequest, LiveCreateRequest, LocalArtifactRequest,
    MemoryDeleteRequest, MemoryLifecycle, MemoryListRequest, MemorySaveRequest, MemorySaveResult,
    MemorySettingsRequest, MemoryState, ModelCatalog, ModelValidation, ModelValidationRequest,
    NewTaskRequest, PluginCatalogSyncRequest, PluginIdRequest, PluginPayloadRequest,
    PolicySaveRequest, PolicyState, ProjectActionAuthorizeRequest, ProjectPathRequest,
    ProjectUpdateRequest, QueuedTaskMessage, QuickLauncherRequest, RuntimeSnapshotRequest,
    ScheduledTaskFromTextRequest, SchedulerMarkReadRequest, SecretDeleteRequest,
    SecretDeleteResult, SecretList, SecretSaveRequest, SecretSaveResult, ShellAppUpdateCheck,
    ShellAppUpdateDownload, ShellAppUpdateInstall, ShellEditorOpenRequest, ShellExternalUrlRequest,
    ShellFileSelection, ShellFileSelectionRequest, ShellGeneratedImageCopy,
    ShellGeneratedImageRequest, ShellGeneratedImageReveal, ShellHostOperation,
    ShellMicrophoneAccess, ShellOpenTaskWindowRequest, ShellOpenedPath, ShellOpenedUrl,
    ShellPickDownloadDirectoryRequest, ShellProjectRequest, ShellThreadRequest, ShellThreadReveal,
    SkillEnabledRequest, SkillEnabledState, TaskApprovalResolution, TaskApprovalResolveRequest,
    TaskCancelRequest, TaskCancellation, TaskHandle, TaskInputResolution, TaskInputResolveRequest,
    TaskQueueDeletion, TaskQueueItemRequest, TaskQueueRequest, TaskQueueSteerReceipt, TaskRecovery,
    TaskResumeRequest, TaskSnapshot, TaskSnapshotRequest, TaskStartRequest, TaskState,
    TaskSteerReceipt, TaskSteerRequest, TerminalContextMenu, TerminalContextMenuRequest,
    TerminalFocusRequest, TerminalFocusState, TerminalReadyState, ThreadAutoNameRequest,
    UsagePriceRequest, WorktreePathRequest, export_types, should_forward_desktop_event,
};
