export type { AgentStatus } from "./bindings/AgentStatus";
export type { ApprovalDecision } from "./bindings/ApprovalDecision";
export type { AppError } from "./bindings/AppError";
export type { AppUpdateState } from "./bindings/AppUpdateState";
export type { BrowserAnnotation } from "./bindings/BrowserAnnotation";
export type { BrowserBoundsRequest } from "./bindings/BrowserBoundsRequest";
export type { BrowserDeveloperState } from "./bindings/BrowserDeveloperState";
export type { BrowserFrame } from "./bindings/BrowserFrame";
export type { BrowserState } from "./bindings/BrowserState";
export type { CloudAccountState } from "./bindings/CloudAccountState";
export type { DesktopCapabilities } from "./bindings/DesktopCapabilities";
export type { DesktopEvent } from "./bindings/DesktopEvent";
export type { DesktopMethod } from "./bindings/DesktopMethod";
export type { DesktopRequest } from "./bindings/DesktopRequest";
export type { DesktopResponse } from "./bindings/DesktopResponse";
export type { DesktopRecoveryRequired } from "./bindings/DesktopRecoveryRequired";
export type { EventEnvelope } from "./bindings/EventEnvelope";
export type { EventReplay } from "./bindings/EventReplay";
export type { EventReplayRequest } from "./bindings/EventReplayRequest";
export type { FileEntry } from "./bindings/FileEntry";
export type { FileSearchResult } from "./bindings/FileSearchResult";
export type { GitDiff } from "./bindings/GitDiff";
export type { GitState } from "./bindings/GitState";
export type { Goal } from "./bindings/Goal";
export type { LiveStatus } from "./bindings/LiveStatus";
export type { ModelDescriptor } from "./bindings/ModelDescriptor";
export type { Policy } from "./bindings/Policy";
export type { Preferences } from "./bindings/Preferences";
export type { ProjectAction } from "./bindings/ProjectAction";
export type { PromptSubmission } from "./bindings/PromptSubmission";
export type { QueuedTaskMessage } from "./bindings/QueuedTaskMessage";
export type { ProviderKind } from "./bindings/ProviderKind";
export type { ProviderSettings } from "./bindings/ProviderSettings";
export type { RuntimeDiagnostics } from "./bindings/RuntimeDiagnostics";
export type { RuntimeSnapshot } from "./bindings/RuntimeSnapshot";
export type { ScheduledTask } from "./bindings/ScheduledTask";
export type { ScheduledRun } from "./bindings/ScheduledRun";
export type { SchedulerSnapshot } from "./bindings/SchedulerSnapshot";
export type { ShellAppUpdateCheck } from "./bindings/ShellAppUpdateCheck";
export type { ShellAppUpdateDownload } from "./bindings/ShellAppUpdateDownload";
export type { ShellAppUpdateInstall } from "./bindings/ShellAppUpdateInstall";
export type { ShellEditorOpenRequest } from "./bindings/ShellEditorOpenRequest";
export type { ShellExternalUrlRequest } from "./bindings/ShellExternalUrlRequest";
export type { ShellFileSelection } from "./bindings/ShellFileSelection";
export type { ShellFileSelectionRequest } from "./bindings/ShellFileSelectionRequest";
export type { ShellGeneratedImageCopy } from "./bindings/ShellGeneratedImageCopy";
export type { ShellGeneratedImageRequest } from "./bindings/ShellGeneratedImageRequest";
export type { ShellGeneratedImageReveal } from "./bindings/ShellGeneratedImageReveal";
export type { ShellMicrophoneAccess } from "./bindings/ShellMicrophoneAccess";
export type { ShellOpenedPath } from "./bindings/ShellOpenedPath";
export type { ShellOpenedUrl } from "./bindings/ShellOpenedUrl";
export type { ShellOpenTaskWindowRequest } from "./bindings/ShellOpenTaskWindowRequest";
export type { ShellPickDownloadDirectoryRequest } from "./bindings/ShellPickDownloadDirectoryRequest";
export type { ShellProjectRequest } from "./bindings/ShellProjectRequest";
export type { ShellThreadRequest } from "./bindings/ShellThreadRequest";
export type { ShellThreadReveal } from "./bindings/ShellThreadReveal";
export type { StreamEnvelope } from "./bindings/StreamEnvelope";
export type { TaskCancelRequest } from "./bindings/TaskCancelRequest";
export type { TaskCancellation } from "./bindings/TaskCancellation";
export type { TaskApprovalResolution } from "./bindings/TaskApprovalResolution";
export type { TaskApprovalResolveRequest } from "./bindings/TaskApprovalResolveRequest";
export type { TaskHandle } from "./bindings/TaskHandle";
export type { TaskInputResolution } from "./bindings/TaskInputResolution";
export type { TaskInputResolveRequest } from "./bindings/TaskInputResolveRequest";
export type { TaskQueueDeletion } from "./bindings/TaskQueueDeletion";
export type { TaskQueueItemRequest } from "./bindings/TaskQueueItemRequest";
export type { TaskQueueRequest } from "./bindings/TaskQueueRequest";
export type { TaskQueueSteerReceipt } from "./bindings/TaskQueueSteerReceipt";
export type { TaskRecovery } from "./bindings/TaskRecovery";
export type { TaskResumeRequest } from "./bindings/TaskResumeRequest";
export type { TaskSnapshot } from "./bindings/TaskSnapshot";
export type { TaskSnapshotRequest } from "./bindings/TaskSnapshotRequest";
export type { TaskStartRequest } from "./bindings/TaskStartRequest";
export type { TaskState } from "./bindings/TaskState";
export type { TaskSteerReceipt } from "./bindings/TaskSteerReceipt";
export type { TaskSteerRequest } from "./bindings/TaskSteerRequest";
export type { TerminalExit } from "./bindings/TerminalExit";
export type { TerminalSession } from "./bindings/TerminalSession";
export type { ThreadList } from "./bindings/ThreadList";
export type { ThreadSummary } from "./bindings/ThreadSummary";
export type { WorktreeSummary } from "./bindings/WorktreeSummary";

export type ToolView =
  | "activity"
  | "browser"
  | "terminal"
  | "git"
  | "files"
  | "manage";

export interface LocalArtifactPreviewRequest {
  id: string;
  path: string;
  threadId: string | null;
}

export interface LocalArtifactPreview extends Record<string, unknown> {
  name?: string;
  path?: string;
  absolutePath?: string;
  kind?: "text" | "image" | "pdf" | "audio" | "video" | "binary";
  mimeType?: string;
  size?: number | bigint;
  content?: string;
  dataUrl?: string;
  message?: string;
}

export type PrimaryView =
  | "tasks"
  | "pull-requests"
  | "sites"
  | "scheduled"
  | "plugins";

export type SettingsRoute =
  | "general"
  | "models"
  | "import"
  | "profile"
  | "appearance"
  | "voice"
  | "config"
  | "personalization"
  | "shortcuts"
  | "usage"
  | "account"
  | "snapshots"
  | "plugins"
  | "browser"
  | "computer"
  | "hooks"
  | "connections"
  | "git"
  | "environment"
  | "worktrees"
  | "archived";

export type TimelineKind =
  | "message"
  | "reasoning"
  | "plan"
  | "command"
  | "file-change"
  | "tool"
  | "approval"
  | "user-input"
  | "notice";

export interface UserInputOption {
  label: string;
  description?: string;
}

export interface UserInputQuestion {
  id: string;
  header: string;
  question: string;
  isOther: boolean;
  isSecret: boolean;
  options: UserInputOption[];
}

export interface TimelineAttachment {
  path: string;
  name: string;
  kind: "image" | "file";
}

export interface TimelineItem {
  id: string;
  /** The Codex turn that owns this item; used to reconcile optimistic and streamed items. */
  turnId?: string | undefined;
  role: "user" | "assistant" | "tool" | "system" | "error";
  title?: string | undefined;
  text: string;
  pending?: boolean | undefined;
  kind?: TimelineKind | undefined;
  status?: string | undefined;
  meta?: string | undefined;
  requestId?: string | undefined;
  approvalMethod?: string | undefined;
  approvalDecision?: string | undefined;
  userInputQuestions?: UserInputQuestion[] | undefined;
  userInputAnswers?: Record<string, string[]> | undefined;
  queueId?: string | undefined;
  delivery?: "pending" | "queued" | "running" | "sent" | "failed" | undefined;
  generatedImagePath?: string | undefined;
  /** Local files explicitly attached by the user. */
  attachments?: TimelineAttachment[] | undefined;
  /** Timestamp carried by the app-server event or legacy thread item. */
  timestamp?: string | undefined;
  /** Optional diff summary for a file-change activity row. */
  stats?: TimelineStats | undefined;
  /** Original shell command, kept separate from streamed command output. */
  command?: string | undefined;
  /** Working directory reported by the command execution item. */
  cwd?: string | undefined;
  /** Process exit code when the command has finished. */
  exitCode?: number | undefined;
  /** Command execution duration reported by the runtime. */
  durationMs?: number | undefined;
}

export interface QueuedMessage {
  id: string;
  threadId: string;
  text: string;
  queuedAt?: string | undefined;
  status?: "pending" | "queued" | "steering" | "failed" | undefined;
}

export interface TimelineStats {
  files?: number | undefined;
  added?: number | undefined;
  removed?: number | undefined;
}

export interface PromptOptions {
  images?: string[];
  attachments?: string[];
  capability?: string | null;
  industryPlugin?: string | null;
  mode?: string | null;
  goalTokenBudget?: number | null;
  model?: string | null;
  reasoningEffort?: string | null;
}
