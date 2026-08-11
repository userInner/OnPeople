import type { AgentStatus } from "../bindings/AgentStatus";
import type { DesktopCapabilities } from "../bindings/DesktopCapabilities";
import type { DesktopEvent } from "../bindings/DesktopEvent";
import type { DesktopMethod } from "../bindings/DesktopMethod";
import type { DesktopRequest } from "../bindings/DesktopRequest";
import type { DesktopResponse } from "../bindings/DesktopResponse";
import type { Preferences } from "../bindings/Preferences";
import type { RuntimeDiagnostics } from "../bindings/RuntimeDiagnostics";
import type { RuntimeSnapshot } from "../bindings/RuntimeSnapshot";
import type { SchedulerSnapshot } from "../bindings/SchedulerSnapshot";
import type { JsonValue } from "../bindings/serde_json/JsonValue";
import type { ThreadFilters } from "../bindings/ThreadFilters";
import type { ThreadList } from "../bindings/ThreadList";
import type { TaskCancelRequest } from "../bindings/TaskCancelRequest";
import type { TaskCancellation } from "../bindings/TaskCancellation";
import type { TaskHandle } from "../bindings/TaskHandle";
import type { TaskRecovery } from "../bindings/TaskRecovery";
import type { TaskResumeRequest } from "../bindings/TaskResumeRequest";
import type { TaskSnapshot } from "../bindings/TaskSnapshot";
import type { TaskSnapshotRequest } from "../bindings/TaskSnapshotRequest";
import type { TaskStartRequest } from "../bindings/TaskStartRequest";

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
