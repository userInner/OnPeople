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
    #[serde(rename = "terminal.start")]
    TerminalStart,
    #[serde(rename = "terminal.write")]
    TerminalWrite,
    #[serde(rename = "terminal.resize")]
    TerminalResize,
    #[serde(rename = "terminal.terminate")]
    TerminalTerminate,
    #[serde(rename = "terminal.ready")]
    TerminalReady,
    #[serde(rename = "terminal.focus")]
    TerminalFocus,
    #[serde(rename = "terminal.context-menu")]
    TerminalContextMenu,
    #[serde(rename = "file.list")]
    FileList,
    #[serde(rename = "file.search")]
    FileSearch,
    #[serde(rename = "file.preview")]
    FilePreview,
    #[serde(rename = "file.artifact.preview")]
    FileArtifactPreview,
    #[serde(rename = "file.generated-image.read")]
    FileGeneratedImageRead,
    #[serde(rename = "file.project-actions")]
    FileProjectActions,
    #[serde(rename = "file.project-action.authorize")]
    FileProjectActionAuthorize,
    #[serde(rename = "git.state")]
    GitState,
    #[serde(rename = "git.diff")]
    GitDiff,
    #[serde(rename = "git.mutate")]
    GitMutate,
    #[serde(rename = "git.commit")]
    GitCommit,
    #[serde(rename = "git.push")]
    GitPush,
    #[serde(rename = "git.initialize")]
    GitInitialize,
    #[serde(rename = "git.hunks")]
    GitHunks,
    #[serde(rename = "git.hunk.mutate")]
    GitHunkMutate,
    #[serde(rename = "git.pull-request.prepare")]
    GitPullRequestPrepare,
    #[serde(rename = "git.review.start")]
    GitReviewStart,
    #[serde(rename = "git.review.submit")]
    GitReviewSubmit,
    #[serde(rename = "git.worktree")]
    GitWorktree,
    #[serde(rename = "browser.state")]
    BrowserState,
    #[serde(rename = "browser.restart")]
    BrowserRestart,
    #[serde(rename = "browser.command")]
    BrowserCommand,
    #[serde(rename = "browser.surface.bounds")]
    BrowserSurfaceBounds,
    #[serde(rename = "browser.annotation.list")]
    BrowserAnnotationList,
    #[serde(rename = "browser.annotation.save")]
    BrowserAnnotationSave,
    #[serde(rename = "browser.annotation.delete")]
    BrowserAnnotationDelete,
    #[serde(rename = "browser.action")]
    BrowserAction,
    #[serde(rename = "plugin.install")]
    PluginInstall,
    #[serde(rename = "plugin.uninstall")]
    PluginUninstall,
    #[serde(rename = "plugin.industry.activate")]
    PluginIndustryActivate,
    #[serde(rename = "plugin.industry.deactivate")]
    PluginIndustryDeactivate,
    #[serde(rename = "plugin.mcp.reload")]
    PluginMcpReload,
    #[serde(rename = "plugin.catalog.sync")]
    PluginCatalogSync,
    #[serde(rename = "connector.oauth.start")]
    ConnectorOauthStart,
    #[serde(rename = "connector.oauth.complete")]
    ConnectorOauthComplete,
    #[serde(rename = "connector.disconnect")]
    ConnectorDisconnect,
    #[serde(rename = "shell.deep-links.activate")]
    ShellActivateDeepLinks,
    #[serde(rename = "shell.frontend.ready")]
    ShellFrontendReady,
    #[serde(rename = "shell.task-window.open")]
    ShellOpenTaskWindow,
    #[serde(rename = "shell.microphone.request")]
    ShellRequestMicrophoneAccess,
    #[serde(rename = "shell.cloud-console.open")]
    ShellOpenCloudConsole,
    #[serde(rename = "shell.external-url.open")]
    ShellOpenExternalUrl,
    #[serde(rename = "shell.editor.open")]
    ShellOpenEditor,
    #[serde(rename = "shell.local-artifact.open")]
    ShellOpenLocalArtifact,
    #[serde(rename = "shell.generated-image.reveal")]
    ShellRevealGeneratedImage,
    #[serde(rename = "shell.generated-image.copy")]
    ShellCopyGeneratedImage,
    #[serde(rename = "shell.images.pick")]
    ShellPickImages,
    #[serde(rename = "shell.attachments.pick")]
    ShellPickAttachments,
    #[serde(rename = "shell.image.paste")]
    ShellPasteImage,
    #[serde(rename = "shell.thread.reveal")]
    ShellRevealThread,
    #[serde(rename = "shell.project.reveal")]
    ShellRevealProject,
    #[serde(rename = "shell.download-directory.pick")]
    ShellPickDownloadDirectory,
    #[serde(rename = "shell.scheduler.open")]
    ShellOpenScheduler,
    #[serde(rename = "shell.app-update.state")]
    ShellAppUpdateState,
    #[serde(rename = "shell.app-update.check")]
    ShellAppUpdateCheck,
    #[serde(rename = "shell.app-update.download")]
    ShellAppUpdateDownload,
    #[serde(rename = "shell.app-update.install")]
    ShellAppUpdateInstall,
    #[serde(rename = "shell.app-update.open-download")]
    ShellAppUpdateOpenDownload,
}

impl DesktopMethod {
    pub const ALL: [Self; 86] = [
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
        Self::TerminalStart,
        Self::TerminalWrite,
        Self::TerminalResize,
        Self::TerminalTerminate,
        Self::TerminalReady,
        Self::TerminalFocus,
        Self::TerminalContextMenu,
        Self::FileList,
        Self::FileSearch,
        Self::FilePreview,
        Self::FileArtifactPreview,
        Self::FileGeneratedImageRead,
        Self::FileProjectActions,
        Self::FileProjectActionAuthorize,
        Self::GitState,
        Self::GitDiff,
        Self::GitMutate,
        Self::GitCommit,
        Self::GitPush,
        Self::GitInitialize,
        Self::GitHunks,
        Self::GitHunkMutate,
        Self::GitPullRequestPrepare,
        Self::GitReviewStart,
        Self::GitReviewSubmit,
        Self::GitWorktree,
        Self::BrowserState,
        Self::BrowserRestart,
        Self::BrowserCommand,
        Self::BrowserSurfaceBounds,
        Self::BrowserAnnotationList,
        Self::BrowserAnnotationSave,
        Self::BrowserAnnotationDelete,
        Self::BrowserAction,
        Self::PluginInstall,
        Self::PluginUninstall,
        Self::PluginIndustryActivate,
        Self::PluginIndustryDeactivate,
        Self::PluginMcpReload,
        Self::PluginCatalogSync,
        Self::ConnectorOauthStart,
        Self::ConnectorOauthComplete,
        Self::ConnectorDisconnect,
        Self::ShellActivateDeepLinks,
        Self::ShellFrontendReady,
        Self::ShellOpenTaskWindow,
        Self::ShellRequestMicrophoneAccess,
        Self::ShellOpenCloudConsole,
        Self::ShellOpenExternalUrl,
        Self::ShellOpenEditor,
        Self::ShellOpenLocalArtifact,
        Self::ShellRevealGeneratedImage,
        Self::ShellCopyGeneratedImage,
        Self::ShellPickImages,
        Self::ShellPickAttachments,
        Self::ShellPasteImage,
        Self::ShellRevealThread,
        Self::ShellRevealProject,
        Self::ShellPickDownloadDirectory,
        Self::ShellOpenScheduler,
        Self::ShellAppUpdateState,
        Self::ShellAppUpdateCheck,
        Self::ShellAppUpdateDownload,
        Self::ShellAppUpdateInstall,
        Self::ShellAppUpdateOpenDownload,
    ];

    #[must_use]
    pub const fn requires_host(self) -> bool {
        matches!(
            self,
            Self::BrowserState
                | Self::BrowserRestart
                | Self::BrowserCommand
                | Self::BrowserSurfaceBounds
                | Self::BrowserAnnotationList
                | Self::BrowserAnnotationSave
                | Self::BrowserAnnotationDelete
                | Self::BrowserAction
                | Self::ShellActivateDeepLinks
                | Self::ShellFrontendReady
                | Self::ShellOpenTaskWindow
                | Self::ShellRequestMicrophoneAccess
                | Self::ShellOpenCloudConsole
                | Self::ShellOpenExternalUrl
                | Self::ShellOpenEditor
                | Self::ShellOpenLocalArtifact
                | Self::ShellRevealGeneratedImage
                | Self::ShellCopyGeneratedImage
                | Self::ShellPickImages
                | Self::ShellPickAttachments
                | Self::ShellPasteImage
                | Self::ShellRevealThread
                | Self::ShellRevealProject
                | Self::ShellPickDownloadDirectory
                | Self::ShellOpenScheduler
                | Self::ShellAppUpdateState
                | Self::ShellAppUpdateCheck
                | Self::ShellAppUpdateDownload
                | Self::ShellAppUpdateInstall
                | Self::ShellAppUpdateOpenDownload
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BrowserHostOperation {
    State,
    Restart,
    Command,
    SurfaceBounds,
    AnnotationList,
    AnnotationSave,
    AnnotationDelete,
    Action,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShellHostOperation {
    ActivateDeepLinks,
    FrontendReady,
    OpenTaskWindow,
    RequestMicrophoneAccess,
    OpenCloudConsole,
    OpenExternalUrl,
    OpenEditor,
    OpenLocalArtifact,
    RevealGeneratedImage,
    CopyGeneratedImage,
    PickImages,
    PickAttachments,
    PasteImage,
    RevealThread,
    RevealProject,
    PickDownloadDirectory,
    OpenScheduler,
    AppUpdateState,
    AppUpdateCheck,
    AppUpdateDownload,
    AppUpdateInstall,
    AppUpdateOpenDownload,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct ShellOpenTaskWindowRequest {
    #[serde(default)]
    pub thread_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct ShellExternalUrlRequest {
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct ShellEditorOpenRequest {
    pub cwd: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct ShellGeneratedImageRequest {
    pub image_path: String,
    #[serde(default)]
    pub thread_id: Option<String>,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct ShellFileSelectionRequest {
    #[serde(default)]
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct ShellThreadRequest {
    pub thread_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct ShellProjectRequest {
    pub project_path: String,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct ShellPickDownloadDirectoryRequest {
    #[serde(default)]
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ShellMicrophoneAccess {
    pub granted: bool,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ShellOpenedUrl {
    pub opened: bool,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ShellOpenedPath {
    pub opened: bool,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ShellGeneratedImageReveal {
    pub revealed: bool,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ShellGeneratedImageCopy {
    pub copied: bool,
    pub image: GeneratedImage,
    pub clipboard: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ShellFileSelection {
    pub selected: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ShellThreadReveal {
    pub thread_id: String,
    pub cwd: String,
    pub opened: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ShellAppUpdateCheck {
    pub available: bool,
    pub current_version: String,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub date: Option<String>,
    #[serde(default)]
    pub body: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ShellAppUpdateDownload {
    pub available: bool,
    #[serde(default)]
    pub current_version: Option<String>,
    #[serde(default)]
    pub downloaded: Option<bool>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub bytes: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ShellAppUpdateInstall {
    pub installed: bool,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct BrowserCommandRequest {
    pub command: DesktopBrowserCommand,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "command",
    content = "payload"
)]
#[ts(export)]
pub enum DesktopBrowserCommand {
    CreateRoute {
        route_id: String,
        thread_id: String,
        url: String,
    },
    Navigate {
        route_id: String,
        url: String,
    },
    Back {
        route_id: String,
    },
    Forward {
        route_id: String,
    },
    Reload {
        route_id: String,
    },
    Resize {
        route_id: String,
        width: u32,
        height: u32,
        scale_factor: f64,
        visible: bool,
    },
    Click {
        route_id: String,
        selector: String,
    },
    Fill {
        route_id: String,
        selector: String,
        value: String,
    },
    Select {
        route_id: String,
        selector: String,
        value: String,
    },
    Press {
        route_id: String,
        key: String,
    },
    Scroll {
        route_id: String,
        x: f64,
        y: f64,
    },
    Hover {
        route_id: String,
        selector: String,
    },
    Evaluate {
        route_id: String,
        expression: String,
    },
    DomSnapshot {
        route_id: String,
    },
    VisualSnapshot {
        route_id: String,
    },
    DeveloperInspect {
        route_id: String,
    },
    Pointer {
        route_id: String,
        kind: String,
        x: f64,
        y: f64,
        delta_x: f64,
        delta_y: f64,
        button: i32,
        click_count: i32,
        modifiers: u32,
    },
    Key {
        route_id: String,
        kind: String,
        key_code: i32,
        native_key_code: i32,
        character: String,
        modifiers: u32,
    },
    CloseRoute {
        route_id: String,
    },
}

#[derive(Debug, Default, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct BrowserRouteRequest {
    pub route_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct BrowserAnnotationDeleteRequest {
    pub id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum BrowserAction {
    Navigate,
    Back,
    Forward,
    Reload,
    CaptureVisualSnapshot,
    InspectDeveloperState,
    BeginAnnotation,
    CancelAnnotation,
    SessionStatus,
    OpenSignIn,
    ClearSession,
    ClearAllData,
    ClearSettingsData,
    FillSavedCredential,
    ListImportProfiles,
    ImportProfile,
    Attach,
    ActivateTab,
    DetachTab,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct BrowserActionRequest {
    pub action: BrowserAction,
    #[serde(default)]
    pub payload: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct PluginPayloadRequest {
    pub plugin: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct PluginIdRequest {
    pub plugin_id: String,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct PluginCatalogSyncRequest {
    #[serde(default)]
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct ConnectorOauthCompleteRequest {
    pub state: String,
    #[serde(default)]
    pub code: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
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

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct TerminalFocusRequest {
    pub focused: bool,
    #[serde(default)]
    pub process_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TerminalFocusState {
    pub focused: bool,
    #[serde(default)]
    pub process_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TerminalReadyState {
    pub ready: bool,
    pub process_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct TerminalContextMenuRequest {
    pub process_id: String,
    #[serde(default)]
    pub has_selection: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TerminalContextMenu {
    pub process_id: String,
    pub items: Vec<String>,
    pub has_selection: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct FileListRequest {
    pub cwd: String,
    #[serde(default)]
    pub relative: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct FileSearchRequest {
    pub cwd: String,
    pub query: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct FilePreviewRequest {
    pub cwd: String,
    pub path: String,
    #[serde(default)]
    pub route_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct LocalArtifactRequest {
    pub path: String,
    #[serde(default)]
    pub thread_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FilePreview {
    pub opened: bool,
    pub name: String,
    pub path: String,
    pub absolute_path: String,
    #[ts(type = "number")]
    pub size: u64,
    pub mime_type: String,
    pub kind: String,
    #[serde(default)]
    pub route_id: Option<String>,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub data_url: Option<String>,
    #[serde(default)]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct GeneratedImage {
    pub path: String,
    pub name: String,
    pub mime_type: String,
    pub bytes: usize,
    pub data_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct ProjectActionAuthorizeRequest {
    pub cwd: String,
    pub action_id: String,
    #[serde(default)]
    pub fingerprint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AuthorizedProjectAction {
    pub id: String,
    pub label: String,
    pub command: String,
    pub source: String,
    pub fingerprint: String,
    pub authorized: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct GitHunkMutationRequest {
    pub cwd: String,
    pub patch: String,
    pub action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct GitPullRequestRequest {
    pub cwd: String,
    #[serde(default)]
    pub base: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct GitReviewStartRequest {
    pub cwd: String,
    #[serde(default)]
    pub thread_id: Option<String>,
    #[serde(default)]
    pub target_type: Option<String>,
    #[serde(default)]
    pub value: Option<String>,
    #[serde(default)]
    pub base: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct GitReviewSubmitRequest {
    pub comments: Value,
    #[serde(default)]
    pub thread_id: Option<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub review: Option<Value>,
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
        TerminalFocusRequest,
        TerminalFocusState,
        TerminalReadyState,
        TerminalContextMenuRequest,
        TerminalContextMenu,
        FileListRequest,
        FileSearchRequest,
        FilePreviewRequest,
        LocalArtifactRequest,
        FilePreview,
        GeneratedImage,
        ProjectActionAuthorizeRequest,
        AuthorizedProjectAction,
        GitHunkMutationRequest,
        GitPullRequestRequest,
        GitReviewStartRequest,
        GitReviewSubmitRequest,
        BrowserCommandRequest,
        DesktopBrowserCommand,
        BrowserRouteRequest,
        BrowserAnnotationDeleteRequest,
        BrowserAction,
        BrowserActionRequest,
        PluginPayloadRequest,
        PluginIdRequest,
        PluginCatalogSyncRequest,
        ConnectorOauthCompleteRequest,
        ShellOpenTaskWindowRequest,
        ShellExternalUrlRequest,
        ShellEditorOpenRequest,
        ShellGeneratedImageRequest,
        ShellFileSelectionRequest,
        ShellThreadRequest,
        ShellProjectRequest,
        ShellPickDownloadDirectoryRequest,
        ShellMicrophoneAccess,
        ShellOpenedUrl,
        ShellOpenedPath,
        ShellGeneratedImageReveal,
        ShellGeneratedImageCopy,
        ShellFileSelection,
        ShellThreadReveal,
        ShellAppUpdateCheck,
        ShellAppUpdateDownload,
        ShellAppUpdateInstall,
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
    fn serializes_terminal_file_and_git_method_names() {
        assert_eq!(
            serde_json::to_string(&DesktopMethod::TerminalStart).expect("terminal method"),
            r#""terminal.start""#
        );
        assert_eq!(
            serde_json::to_string(&DesktopMethod::FileArtifactPreview).expect("file method"),
            r#""file.artifact.preview""#
        );
        assert_eq!(
            serde_json::to_string(&DesktopMethod::GitReviewSubmit).expect("git method"),
            r#""git.review.submit""#
        );
    }

    #[test]
    fn serializes_browser_and_extension_contract_names() {
        assert_eq!(
            serde_json::to_string(&DesktopMethod::BrowserSurfaceBounds).expect("serialize method"),
            r#""browser.surface.bounds""#
        );
        assert_eq!(
            serde_json::to_string(&DesktopMethod::ConnectorOauthComplete)
                .expect("serialize method"),
            r#""connector.oauth.complete""#
        );
        assert_eq!(
            serde_json::to_string(&BrowserAction::CaptureVisualSnapshot)
                .expect("serialize browser action"),
            r#""captureVisualSnapshot""#
        );
    }

    #[test]
    fn serializes_native_shell_contract_names() {
        assert_eq!(
            serde_json::to_string(&DesktopMethod::ShellOpenLocalArtifact)
                .expect("serialize shell method"),
            r#""shell.local-artifact.open""#
        );
        assert_eq!(
            serde_json::to_string(&DesktopMethod::ShellAppUpdateDownload)
                .expect("serialize update method"),
            r#""shell.app-update.download""#
        );
        assert_eq!(
            serde_json::to_string(&DesktopMethod::ShellOpenCloudConsole)
                .expect("serialize cloud console method"),
            r#""shell.cloud-console.open""#
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
