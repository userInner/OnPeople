import type { AgentStatus } from "../bindings/AgentStatus";
import type { QueuedTaskMessage } from "../bindings/QueuedTaskMessage";
import type { DesktopCapabilities } from "../bindings/DesktopCapabilities";
import type { DesktopEvent } from "../bindings/DesktopEvent";
import type { DesktopMethod } from "../bindings/DesktopMethod";
import type { DesktopRequest } from "../bindings/DesktopRequest";
import type { DesktopResponse } from "../bindings/DesktopResponse";
import type { EventReplay } from "../bindings/EventReplay";
import type { EventReplayRequest } from "../bindings/EventReplayRequest";
import type { AuthorizedProjectAction } from "../bindings/AuthorizedProjectAction";
import type { FileListRequest } from "../bindings/FileListRequest";
import type { FilePreview } from "../bindings/FilePreview";
import type { FilePreviewRequest } from "../bindings/FilePreviewRequest";
import type { FileSearchRequest } from "../bindings/FileSearchRequest";
import type { GeneratedImage } from "../bindings/GeneratedImage";
import type { GitHunkMutationRequest } from "../bindings/GitHunkMutationRequest";
import type { GitPullRequestRequest } from "../bindings/GitPullRequestRequest";
import type { GitReviewStartRequest } from "../bindings/GitReviewStartRequest";
import type { GitReviewSubmitRequest } from "../bindings/GitReviewSubmitRequest";
import type { LocalArtifactRequest } from "../bindings/LocalArtifactRequest";
import type { ProjectActionAuthorizeRequest } from "../bindings/ProjectActionAuthorizeRequest";
import type { TerminalFocusRequest } from "../bindings/TerminalFocusRequest";
import type { TerminalFocusState } from "../bindings/TerminalFocusState";
import type { TerminalReadyState } from "../bindings/TerminalReadyState";
import type { TerminalContextMenu } from "../bindings/TerminalContextMenu";
import type { TerminalContextMenuRequest } from "../bindings/TerminalContextMenuRequest";
import type { GitCommitRequest } from "../bindings/GitCommitRequest";
import type { GitFileRequest } from "../bindings/GitFileRequest";
import type { GitMutationRequest } from "../bindings/GitMutationRequest";
import type { GitPushRequest } from "../bindings/GitPushRequest";
import type { GitRequest } from "../bindings/GitRequest";
import type { TerminalIdRequest } from "../bindings/TerminalIdRequest";
import type { TerminalResizeRequest } from "../bindings/TerminalResizeRequest";
import type { TerminalStartRequest } from "../bindings/TerminalStartRequest";
import type { TerminalWriteRequest } from "../bindings/TerminalWriteRequest";
import type { WorktreeRequest } from "../bindings/WorktreeRequest";
import type { Preferences } from "../bindings/Preferences";
import type { RuntimeDiagnostics } from "../bindings/RuntimeDiagnostics";
import type { RuntimeSnapshot } from "../bindings/RuntimeSnapshot";
import type { SchedulerSnapshot } from "../bindings/SchedulerSnapshot";
import type { JsonValue } from "../bindings/serde_json/JsonValue";
import type { ThreadFilters } from "../bindings/ThreadFilters";
import type { ThreadList } from "../bindings/ThreadList";
import type { TaskCancelRequest } from "../bindings/TaskCancelRequest";
import type { TaskCancellation } from "../bindings/TaskCancellation";
import type { TaskApprovalResolution } from "../bindings/TaskApprovalResolution";
import type { TaskApprovalResolveRequest } from "../bindings/TaskApprovalResolveRequest";
import type { TaskHandle } from "../bindings/TaskHandle";
import type { TaskInputResolution } from "../bindings/TaskInputResolution";
import type { TaskInputResolveRequest } from "../bindings/TaskInputResolveRequest";
import type { TaskQueueDeletion } from "../bindings/TaskQueueDeletion";
import type { TaskQueueItemRequest } from "../bindings/TaskQueueItemRequest";
import type { TaskQueueRequest } from "../bindings/TaskQueueRequest";
import type { TaskQueueSteerReceipt } from "../bindings/TaskQueueSteerReceipt";
import type { TaskRecovery } from "../bindings/TaskRecovery";
import type { TaskResumeRequest } from "../bindings/TaskResumeRequest";
import type { TaskSnapshot } from "../bindings/TaskSnapshot";
import type { TaskSnapshotRequest } from "../bindings/TaskSnapshotRequest";
import type { TaskStartRequest } from "../bindings/TaskStartRequest";
import type { TaskSteerReceipt } from "../bindings/TaskSteerReceipt";
import type { TaskSteerRequest } from "../bindings/TaskSteerRequest";
import type {
  FileEntry,
  FileSearchResult,
  GitDiff,
  GitState,
  ProjectAction,
  TerminalSession,
} from "../types";

export const DESKTOP_PROTOCOL_VERSION = 1;

export interface DesktopMethodMap {
  "system.capabilities": {
    params: Record<string, never>;
    result: DesktopCapabilities;
  };
  "runtime.status": {
    params: Record<string, never>;
    result: AgentStatus;
  };
  "runtime.start": {
    params: Record<string, never>;
    result: void;
  };
  "runtime.stop": {
    params: Record<string, never>;
    result: void;
  };
  "runtime.snapshot": {
    params: { threadId: string | null };
    result: RuntimeSnapshot;
  };
  "runtime.diagnostics": {
    params: Record<string, never>;
    result: RuntimeDiagnostics;
  };
  "event.replay": {
    params: EventReplayRequest;
    result: EventReplay;
  };
  "preferences.get": {
    params: Record<string, never>;
    result: Preferences;
  };
  "preferences.save": {
    params: { preferences: Preferences };
    result: Preferences;
  };
  "thread.list": {
    params: ThreadFilters;
    result: ThreadList;
  };
  "scheduler.get": {
    params: Record<string, never>;
    result: SchedulerSnapshot;
  };
  "task.start": {
    params: TaskStartRequest;
    result: TaskHandle;
  };
  "task.cancel": {
    params: TaskCancelRequest;
    result: TaskCancellation;
  };
  "task.snapshot": {
    params: TaskSnapshotRequest;
    result: TaskSnapshot;
  };
  "task.resume": {
    params: TaskResumeRequest;
    result: TaskRecovery;
  };
  "task.queue": {
    params: TaskQueueRequest;
    result: QueuedTaskMessage;
  };
  "task.queue.delete": {
    params: TaskQueueItemRequest;
    result: TaskQueueDeletion;
  };
  "task.steer": {
    params: TaskSteerRequest;
    result: TaskSteerReceipt;
  };
  "task.queue.steer": {
    params: TaskQueueItemRequest;
    result: TaskQueueSteerReceipt;
  };
  "task.approval.resolve": {
    params: TaskApprovalResolveRequest;
    result: TaskApprovalResolution;
  };
  "task.input.resolve": {
    params: TaskInputResolveRequest;
    result: TaskInputResolution;
  };
  "terminal.start": {
    params: TerminalStartRequest;
    result: TerminalSession;
  };
  "terminal.write": { params: TerminalWriteRequest; result: void };
  "terminal.resize": { params: TerminalResizeRequest; result: void };
  "terminal.terminate": { params: TerminalIdRequest; result: void };
  "terminal.ready": {
    params: TerminalIdRequest;
    result: TerminalReadyState;
  };
  "terminal.focus": {
    params: TerminalFocusRequest;
    result: TerminalFocusState;
  };
  "terminal.context-menu": {
    params: TerminalContextMenuRequest;
    result: TerminalContextMenu;
  };
  "file.list": { params: FileListRequest; result: FileEntry[] };
  "file.search": { params: FileSearchRequest; result: FileSearchResult };
  "file.preview": { params: FilePreviewRequest; result: FilePreview };
  "file.artifact.preview": {
    params: LocalArtifactRequest;
    result: FilePreview;
  };
  "file.generated-image.read": {
    params: LocalArtifactRequest;
    result: GeneratedImage;
  };
  "file.project-actions": { params: GitRequest; result: ProjectAction[] };
  "file.project-action.authorize": {
    params: ProjectActionAuthorizeRequest;
    result: AuthorizedProjectAction;
  };
  "git.state": { params: GitRequest; result: GitState };
  "git.diff": { params: GitFileRequest; result: GitDiff };
  "git.mutate": { params: GitMutationRequest; result: GitState };
  "git.commit": { params: GitCommitRequest; result: GitState };
  "git.push": { params: GitPushRequest; result: GitState };
  "git.initialize": { params: GitRequest; result: GitState };
  "git.hunks": { params: GitFileRequest; result: JsonValue };
  "git.hunk.mutate": { params: GitHunkMutationRequest; result: GitState };
  "git.pull-request.prepare": {
    params: GitPullRequestRequest;
    result: JsonValue;
  };
  "git.review.start": { params: GitReviewStartRequest; result: JsonValue };
  "git.review.submit": { params: GitReviewSubmitRequest; result: JsonValue };
  "git.worktree": { params: WorktreeRequest; result: JsonValue };
}

type MethodName = keyof DesktopMethodMap & DesktopMethod;

export type DesktopTransport = (
  request: DesktopRequest,
) => Promise<DesktopResponse>;
export type DesktopEventTransport = (
  handler: (event: DesktopEvent) => void,
) => Promise<() => void>;

export interface DesktopApiClient {
  request<M extends MethodName>(
    method: M,
    params: DesktopMethodMap[M]["params"],
  ): Promise<DesktopMethodMap[M]["result"]>;
  subscribe(handler: (event: DesktopEvent) => void): Promise<() => void>;
}

function defaultRequestId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `desktop-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createDesktopApiClient(
  transport: DesktopTransport,
  createRequestId: () => string = defaultRequestId,
  eventTransport?: DesktopEventTransport,
): DesktopApiClient {
  return {
    async request<M extends MethodName>(
      method: M,
      params: DesktopMethodMap[M]["params"],
    ): Promise<DesktopMethodMap[M]["result"]> {
      const requestId = createRequestId();
      const response = await transport({
        protocolVersion: DESKTOP_PROTOCOL_VERSION,
        requestId,
        method,
        params: params as unknown as JsonValue,
      });

      if (response.protocolVersion !== DESKTOP_PROTOCOL_VERSION) {
        throw {
          code: "UNSUPPORTED",
          message: `桌面协议版本不兼容: client=${DESKTOP_PROTOCOL_VERSION}, server=${response.protocolVersion}`,
          retryable: false,
        };
      }
      if (response.requestId !== requestId) {
        throw {
          code: "RUNTIME_PROTOCOL",
          message: "桌面服务返回了错误的请求标识",
          retryable: true,
        };
      }
      if (!response.ok) {
        throw (
          response.error ?? {
            code: "INTERNAL",
            message: "桌面服务返回了未知错误",
            retryable: false,
          }
        );
      }
      return response.result as DesktopMethodMap[M]["result"];
    },
    subscribe(handler) {
      if (!eventTransport) {
        return Promise.reject({
          code: "RUNTIME_UNAVAILABLE",
          message: "当前桌面适配器不支持事件订阅",
          retryable: true,
        });
      }
      return eventTransport(handler);
    },
  };
}

export function legacySteerResult(
  receipt: TaskSteerReceipt,
): Record<string, unknown> {
  return receipt.result as Record<string, unknown>;
}

export function legacyQueuedSteerResult(
  receipt: TaskQueueSteerReceipt,
): Record<string, unknown> {
  return {
    steered: receipt.steered,
    id: receipt.id,
    result: receipt.result,
  };
}
