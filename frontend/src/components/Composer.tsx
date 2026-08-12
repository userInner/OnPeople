import {
  BookOpen,
  ArrowUp,
  Check,
  CornerDownRight,
  ChevronLeft,
  ChevronDown,
  FileText,
  FileSpreadsheet,
  Folder,
  Goal,
  Globe2,
  Hand,
  Image,
  LoaderCircle,
  Mic,
  Monitor,
  MoreHorizontal,
  Paperclip,
  Plus,
  Presentation,
  Puzzle,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Square,
  TerminalSquare,
  Trash2,
  RotateCcw,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { desktopClient } from "../lib/desktopClient";
import {
  matchingSlashCommands,
  slashQuery,
  type SlashCommand,
  type SlashCommandId,
} from "../lib/slashCommands";
import { useWorkbenchStore } from "../store/workbenchStore";
import type { ModelDescriptor, ProjectAction } from "../types";
import { IconButton } from "./IconButton";
import { LiveCallPanel } from "./LiveCallPanel";
import { useLiveConversation } from "./LiveConversation";

const modes = [
  { id: "agent", label: "Agent", description: "自主执行任务并使用工具" },
  { id: "plan", label: "计划", description: "先分析并给出执行计划" },
  { id: "goal", label: "目标", description: "持续追求结果，直到完成或受阻" },
] as const;

const efforts = [
  { id: "low", label: "轻度" },
  { id: "medium", label: "中" },
  { id: "high", label: "高" },
  { id: "xhigh", label: "极高" },
] as const;

const speeds = [
  { id: "fast", label: "快速" },
  { id: "standard", label: "标准" },
] as const;

const imageFilePattern = /\.(png|jpe?g|webp|gif|heic|avif)$/i;

function classifyAttachmentPaths(paths: readonly string[]): {
  images: string[];
  attachments: string[];
} {
  const unique = [...new Set(paths.map((path) => path.trim()).filter(Boolean))];
  return {
    images: unique.filter((path) => imageFilePattern.test(path)),
    attachments: unique.filter((path) => !imageFilePattern.test(path)),
  };
}

function clipboardContainsFiles(data: DataTransfer): boolean {
  if (data.files.length > 0) return true;
  if ([...data.items].some((item) => item.kind === "file")) return true;
  if (
    [...data.types].some((type) => type === "Files" || type === "text/uri-list")
  ) {
    return true;
  }
  const text = data.getData("text/plain").trim();
  return (
    /^file:\/\//i.test(text) ||
    /^@[^\n]+\.(?:pdf|docx?|xlsx?|pptx?|pages|numbers|key|zip|rar|7z|csv|txt|md|png|jpe?g|webp)$/i.test(
      text,
    )
  );
}

const accessModes = [
  {
    id: "request",
    label: "请求批准",
    chipLabel: "工作区访问",
    description: "编辑外部文件和使用互联网时始终询问",
    sandbox: "workspace-write",
    approvalPolicy: "on-request",
  },
  {
    id: "auto",
    label: "替我审批",
    chipLabel: "替我审批",
    description: "仅对检测到的风险操作请求批准",
    sandbox: "workspace-write",
    approvalPolicy: "untrusted",
  },
  {
    id: "full",
    label: "完全访问",
    chipLabel: "完全访问",
    description: "不受限制地访问互联网和您电脑上的任何文件",
    sandbox: "danger-full-access",
    approvalPolicy: "never",
  },
] as const;

type AccessMode = (typeof accessModes)[number]["id"];

type ModelMenuPage = "root" | "model" | "effort" | "speed";

// macOS WebKit does not guarantee whether the Enter that confirms an IME
// candidate arrives before or after compositionend. Keep a short, one-shot
// guard for the latter order; a second deliberate Enter still sends normally.
// Electron/macOS can deliver the Enter that accepts a Chinese/Japanese IME
// candidate after compositionend, especially while the candidate window is
// animating. Codex rejects composing/229 key events first; this longer one-shot
// guard covers Electron's delayed post-composition Enter without changing the
// normal second-Enter-to-send behavior.
const IME_ENTER_GUARD_MS = 1_500;

const visibleOnPeopleModels = [
  { id: "gpt-5.6-sol", name: "GPT5.6 sol" },
  { id: "gpt-5.6-terra", name: "GPT5.6 terra" },
  { id: "gpt-5.6-luna", name: "GPT5.6 luna" },
] as const;
const defaultOnPeopleModelId = "gpt-5.6-luna";

const capabilityLabels: Record<string, string> = {
  "computer-use": "电脑操控",
  "image-generation": "图像生成",
  documents: "Documents",
  pdf: "PDF",
  spreadsheets: "Spreadsheets",
  presentations: "Presentations",
  "template-creator": "Template Creator",
  sites: "Sites",
  visualize: "Visualize",
};

const productivityPlugins = [
  {
    id: "documents",
    name: "Documents",
    description: "创建和检查文档",
    icon: FileText,
  },
  {
    id: "pdf",
    name: "PDF",
    description: "读取、创建和检查 PDF",
    icon: BookOpen,
  },
  {
    id: "spreadsheets",
    name: "Spreadsheets",
    description: "创建和分析电子表格",
    icon: FileSpreadsheet,
  },
  {
    id: "presentations",
    name: "Presentations",
    description: "创建和检查演示文稿",
    icon: Presentation,
  },
  {
    id: "template-creator",
    name: "Template Creator",
    description: "创建和应用可复用模板",
    icon: Puzzle,
  },
  {
    id: "sites",
    name: "Sites",
    description: "创建独立响应式网页",
    icon: Globe2,
  },
  {
    id: "visualize",
    name: "Visualize",
    description: "创建交互式数据图表",
    icon: Sparkles,
  },
] as const;

function accessModeFromPolicy(policy?: {
  sandbox?: string;
  approvalPolicy?: string;
}): AccessMode {
  if (/danger|full/i.test(policy?.sandbox ?? "")) return "full";
  if (
    policy?.approvalPolicy === "on-failure" ||
    policy?.approvalPolicy === "untrusted"
  )
    return "auto";
  return "request";
}

interface QuickLauncherFile extends Record<string, unknown> {
  kind: "file";
  path: string;
  label: string;
}

interface IndustryPlugin extends Record<string, unknown> {
  id: string;
  name: string;
  active: boolean;
}

export function Composer() {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<(typeof modes)[number]["id"]>("agent");
  const [modeOpen, setModeOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [workspaceQuery, setWorkspaceQuery] = useState("");
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [accessMode, setAccessMode] = useState<AccessMode>("request");
  const [modelMenuPage, setModelMenuPage] = useState<ModelMenuPage>("root");
  const [speed, setSpeed] = useState<(typeof speeds)[number]["id"]>(() => {
    try {
      return window.localStorage.getItem("onpeople:response-speed") ===
        "standard"
        ? "standard"
        : "fast";
    } catch {
      return "fast";
    }
  });
  const [toolsOpen, setToolsOpen] = useState(false);
  const [toolsQuery, setToolsQuery] = useState("");
  const [toolsLoading, setToolsLoading] = useState(false);
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [quickFiles, setQuickFiles] = useState<QuickLauncherFile[]>([]);
  const [projectActions, setProjectActions] = useState<ProjectAction[]>([]);
  const [capability, setCapability] = useState<string | null>(null);
  const [industryPlugins, setIndustryPlugins] = useState<IndustryPlugin[]>([]);
  const [industryPlugin, setIndustryPlugin] = useState<IndustryPlugin | null>(
    null,
  );
  const [modelSelection, setModelSelection] = useState<{
    threadId: string | null;
    value: string;
  } | null>(null);
  const [models, setModels] = useState<ModelDescriptor[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [effortSelection, setEffortSelection] = useState<{
    threadId: string | null;
    value: string;
  } | null>(null);
  const [goalTokenBudget, setGoalTokenBudget] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [images, setImages] = useState<string[]>([]);
  const [attachmentDragActive, setAttachmentDragActive] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [queueMenuId, setQueueMenuId] = useState<string | null>(null);
  const [slashSelection, setSlashSelection] = useState(0);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const lastImeEnterAt = useRef(Number.NEGATIVE_INFINITY);
  const suppressImeEnterUntil = useRef(Number.NEGATIVE_INFINITY);
  const industryPluginRef = useRef<IndustryPlugin | null>(null);
  const sendPrompt = useWorkbenchStore((state) => state.sendPrompt);
  const queueMessage = useWorkbenchStore((state) => state.queueMessage);
  const queuedMessages = useWorkbenchStore((state) => state.queuedMessages);
  const deleteQueuedMessage = useWorkbenchStore(
    (state) => state.deleteQueuedMessage,
  );
  const steerQueuedMessage = useWorkbenchStore(
    (state) => state.steerQueuedMessage,
  );
  const interrupt = useWorkbenchStore((state) => state.interrupt);
  const runtime = useWorkbenchStore((state) => state.runtime);
  const status = useWorkbenchStore((state) => state.status);
  const selectedThreadId = useWorkbenchStore((state) => state.selectedThreadId);
  const selectedThread = useWorkbenchStore((state) =>
    state.threadList.threads.find(
      (thread) => thread.id === state.selectedThreadId,
    ),
  );
  const preferences = useWorkbenchStore((state) => state.preferences);
  const draftCwd = useWorkbenchStore((state) => state.draftCwd);
  const threads = useWorkbenchStore((state) => state.threadList.threads);
  const projects = useWorkbenchStore((state) => state.threadList.projects);
  const newTask = useWorkbenchStore((state) => state.newTask);
  const refreshThreads = useWorkbenchStore((state) => state.refreshThreads);
  const setPrimaryView = useWorkbenchStore((state) => state.setPrimaryView);
  const setToolView = useWorkbenchStore((state) => state.setToolView);
  const live = useLiveConversation(preferences.liveVoice);

  const working = [
    "working",
    "running",
    "waiting-approval",
    "waiting-input",
    "queued",
  ].includes(runtime?.state ?? "");
  const runtimeActivityLabel =
    runtime?.state === "waiting-approval"
      ? "等待你批准"
      : runtime?.state === "waiting-input"
        ? "等待你回答"
        : runtime?.state === "queued"
          ? "等待开始"
          : "正在工作";
  const hasDraftContent =
    Boolean(text.trim()) || images.length > 0 || attachments.length > 0;
  const selectedMode = modes.find((item) => item.id === mode) ?? modes[0];
  const selectedModel =
    modelSelection?.threadId === selectedThreadId ? modelSelection.value : "";
  const configuredModelId =
    selectedModel ||
    selectedThread?.model ||
    status?.provider.model ||
    defaultOnPeopleModelId;
  const modelId = visibleOnPeopleModels.some(
    (model) => model.id === configuredModelId,
  )
    ? configuredModelId
    : defaultOnPeopleModelId;
  const effort =
    effortSelection?.threadId === selectedThreadId
      ? effortSelection.value
      : selectedThread?.reasoningEffort || "high";
  const modelName =
    visibleOnPeopleModels.find((model) => model.id === modelId)?.name ??
    "GPT5.6 luna";
  const effortName = efforts.find((item) => item.id === effort)?.label ?? "高";
  const speedName = speeds.find((item) => item.id === speed)?.label ?? "快速";
  const compactModelName = modelName
    .replace(/^GPT/i, "")
    .replace(/\bsol\b/i, "Sol")
    .replace(/\bterra\b/i, "Terra")
    .replace(/\bluna\b/i, "Luna");
  const selectedAccessMode =
    accessModes.find((item) => item.id === accessMode) ?? accessModes[0];
  const fullAccess = accessMode === "full";
  const accessLabel = selectedAccessMode.chipLabel;
  const activeGoal = status?.goal?.status === "active" ? status.goal : null;
  const policySandbox = status?.policy.sandbox;
  const policyApproval = status?.policy.approvalPolicy;
  const setSettingsOpen = useWorkbenchStore((state) => state.setSettingsOpen);
  const activeCwd =
    selectedThread?.cwd ?? selectedThread?.projectPath ?? draftCwd ?? "";
  const workspaceOptions = (() => {
    const entries = new Map<string, { path: string; name: string }>();
    for (const project of projects) {
      if (!project.hidden && project.path) {
        entries.set(project.path, { path: project.path, name: project.name });
      }
    }
    for (const thread of [...threads].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    )) {
      const path = thread.projectPath ?? thread.cwd;
      if (!path || entries.has(path)) continue;
      entries.set(path, { path, name: workspaceName(path) });
    }
    const query = workspaceQuery.trim().toLocaleLowerCase();
    return [...entries.values()]
      .filter(
        (entry) =>
          !query ||
          entry.name.toLocaleLowerCase().includes(query) ||
          entry.path.toLocaleLowerCase().includes(query),
      )
      .slice(0, 8);
  })();
  const activeWorkspaceName = activeCwd
    ? workspaceName(activeCwd)
    : "选择工作空间";
  const slashMatches = matchingSlashCommands(text, selectedThreadId !== null);
  const slashOpen = !slashDismissed && slashQuery(text) !== null;

  useEffect(() => {
    const element = textarea.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(180, Math.max(46, element.scrollHeight))}px`;
  }, [text]);

  useEffect(() => {
    setSlashSelection(0);
  }, [text]);

  useEffect(() => {
    if (!modeOpen && !modelOpen && !accessOpen && !toolsOpen && !workspaceOpen)
      return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setModeOpen(false);
      setModelOpen(false);
      setModelMenuPage("root");
      setAccessOpen(false);
      setToolsOpen(false);
      setWorkspaceOpen(false);
    };
    const closeOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest(".composer-menu-wrap")
      ) {
        return;
      }
      setModeOpen(false);
      setModelOpen(false);
      setModelMenuPage("root");
      setAccessOpen(false);
      setToolsOpen(false);
      setWorkspaceOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("pointerdown", closeOutside);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("pointerdown", closeOutside);
    };
  }, [accessOpen, modeOpen, modelOpen, toolsOpen, workspaceOpen]);

  const chooseWorkspace = (path?: string) => {
    newTask(path);
    setWorkspaceOpen(false);
    setWorkspaceQuery("");
    setWorkspaceError(null);
  };

  const openLocalFolder = async () => {
    try {
      const path = await desktopClient.pickProject();
      if (!path) return;
      await desktopClient.updateProject(path, "add");
      await refreshThreads();
      chooseWorkspace(path);
    } catch (error) {
      setWorkspaceError(
        error instanceof Error ? error.message : "无法打开本地文件夹",
      );
    }
  };

  useEffect(() => {
    if (policySandbox === undefined && policyApproval === undefined) return;
    setAccessMode(
      accessModeFromPolicy({
        ...(policySandbox === undefined ? {} : { sandbox: policySandbox }),
        ...(policyApproval === undefined
          ? {}
          : { approvalPolicy: policyApproval }),
      }),
    );
  }, [policyApproval, policySandbox]);

  useEffect(() => {
    try {
      window.localStorage.setItem("onpeople:response-speed", speed);
    } catch {
      // Local preference storage is optional in isolated preview windows.
    }
  }, [speed]);

  useEffect(() => {
    if (!toolsOpen) return;
    if (!activeCwd) {
      setQuickFiles([]);
      setProjectActions([]);
      setToolsError("请先选择项目目录");
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(
      () => {
        setToolsLoading(true);
        setToolsError(null);
        void Promise.all([
          desktopClient.getQuickLauncherSuggestions(activeCwd, toolsQuery),
          desktopClient.getProjectActions(activeCwd),
          desktopClient.listExtensions(activeCwd),
        ])
          .then(([suggestions, actions, extensions]) => {
            if (cancelled) return;
            setQuickFiles(suggestions.filter(isQuickLauncherFile));
            setProjectActions(actions);
            const plugins = Array.isArray(extensions.plugins)
              ? extensions.plugins.filter(isIndustryPlugin)
              : [];
            setIndustryPlugins(plugins);
            // Industry plugins are injected explicitly into the current
            // draft from the plus menu. A persisted active plugin is only
            // directory metadata; it must not silently become the default
            // for a new task.
            const selected = industryPluginRef.current;
            industryPluginRef.current = selected
              ? (plugins.find((plugin) => plugin.id === selected.id) ?? null)
              : null;
            setIndustryPlugin(industryPluginRef.current);
          })
          .catch((error) => {
            if (cancelled) return;
            setQuickFiles([]);
            setProjectActions([]);
            setToolsError(
              error instanceof Error ? error.message : "无法读取项目能力",
            );
          })
          .finally(() => {
            if (!cancelled) setToolsLoading(false);
          });
      },
      toolsQuery ? 160 : 0,
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeCwd, toolsOpen, toolsQuery]);

  useEffect(() => {
    if (selectedThreadId !== null) return;
    industryPluginRef.current = null;
    setIndustryPlugin(null);
    setIndustryPlugins((plugins) =>
      plugins.map((plugin) => ({ ...plugin, active: false })),
    );
  }, [selectedThreadId]);

  const loadModels = async () => {
    if (models.length > 0 || modelsLoading) return;
    setModelsLoading(true);
    try {
      const catalog = await desktopClient.discoverModels();
      const values = Array.isArray(catalog.models) ? catalog.models : [];
      const available = values.filter(isModelDescriptor);
      setModels(
        visibleOnPeopleModels.map((choice) => {
          const remote = available.find((model) => model.id === choice.id);
          return {
            id: choice.id,
            provider: "onpeople",
            name: choice.name,
            vision: remote?.vision ?? true,
            reasoningEfforts: remote?.reasoningEfforts ?? [
              "low",
              "medium",
              "high",
            ],
          } satisfies ModelDescriptor;
        }),
      );
    } catch (error) {
      setComposerError(
        error instanceof Error ? error.message : "无法读取可用模型",
      );
    } finally {
      setModelsLoading(false);
    }
  };

  const attachPaths = useCallback((selected: readonly string[]) => {
    const classified = classifyAttachmentPaths(selected);
    setImages((current) => [...new Set([...current, ...classified.images])]);
    setAttachments((current) => [
      ...new Set([...current, ...classified.attachments]),
    ]);
    setComposerError(null);
  }, []);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/webview")
      .then(({ getCurrentWebview }) =>
        getCurrentWebview().onDragDropEvent((event) => {
          if (disposed) return;
          if (event.payload.type === "enter") {
            setAttachmentDragActive(true);
          } else if (event.payload.type === "leave") {
            setAttachmentDragActive(false);
          } else if (event.payload.type === "drop") {
            setAttachmentDragActive(false);
            if (working) {
              setComposerError("请等待当前任务完成后再添加附件。");
              return;
            }
            attachPaths(event.payload.paths);
            window.requestAnimationFrame(() => textarea.current?.focus());
          }
        }),
      )
      .then((dispose) => {
        if (disposed) {
          dispose();
        } else {
          unlisten = dispose;
        }
      })
      .catch(() => {
        // The web renderer has no native drag-drop bridge.
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [attachPaths, working]);

  const submit = async () => {
    const value = text.trim();
    if (!value && images.length === 0 && attachments.length === 0) return;
    setComposerError(null);
    if (working) {
      if (images.length > 0 || attachments.length > 0 || capability) {
        setComposerError(
          "运行中的消息队列暂不支持附件或能力，请等待当前任务完成。",
        );
        return;
      }
      setText("");
      await queueMessage(value);
      textarea.current?.focus();
      return;
    }
    setText("");
    const sentImages = images;
    const sentAttachments = attachments;
    const sentCapability = capability;
    const sentIndustryPlugin = industryPluginRef.current;
    setImages([]);
    setAttachments([]);
    setCapability(null);
    const submission = await sendPrompt(value, {
      images: sentImages,
      attachments: sentAttachments,
      capability: sentCapability,
      industryPlugin: sentIndustryPlugin?.id ?? null,
      mode,
      goalTokenBudget:
        mode === "goal" && Number(goalTokenBudget) > 0
          ? Math.floor(Number(goalTokenBudget))
          : null,
      model: modelId,
      reasoningEffort: effort,
    });
    if (submission) {
      setModelSelection((current) =>
        current?.threadId === selectedThreadId
          ? { ...current, threadId: submission.threadId }
          : current,
      );
      setEffortSelection((current) =>
        current?.threadId === selectedThreadId
          ? { ...current, threadId: submission.threadId }
          : current,
      );
    }
    textarea.current?.focus();
  };

  const addFiles = async (mentionsOnly = false) => {
    try {
      const selected = await desktopClient.pickFiles(true);
      if (mentionsOnly) {
        setAttachments((current) => [...new Set([...current, ...selected])]);
      } else {
        attachPaths(selected);
      }
      textarea.current?.focus();
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : "无法添加文件");
    }
  };

  const pasteFiles = async () => {
    try {
      const selected = await desktopClient.pasteFiles();
      if (selected.length === 0) {
        setComposerError("剪贴板中没有可添加的文件或图片。");
        return;
      }
      attachPaths(selected);
      textarea.current?.focus();
    } catch (error) {
      setComposerError(
        error instanceof Error ? error.message : "无法读取剪贴板附件",
      );
    }
  };

  const addQuickFile = (file: QuickLauncherFile) => {
    const path = absoluteWorkspacePath(activeCwd, file.path);
    setAttachments((current) => [...new Set([...current, path])]);
    setToolsOpen(false);
    textarea.current?.focus();
  };

  const runProjectAction = async (action: ProjectAction) => {
    const confirmed = window.confirm(
      `要在当前项目运行“${action.label}”吗？\n\n${action.command}\n\n来源：${action.source}`,
    );
    if (!confirmed) return;
    setToolsError(null);
    try {
      const authorized = await desktopClient.authorizeProjectAction({
        cwd: activeCwd,
        actionId: action.id,
        fingerprint: action.fingerprint,
      });
      window.dispatchEvent(
        new CustomEvent("onpeople:terminal-command", {
          detail: { command: authorized.command },
        }),
      );
      setToolsOpen(false);
    } catch (error) {
      setToolsError(
        error instanceof Error ? error.message : "项目动作授权失败",
      );
    }
  };

  const toggleIndustryPlugin = async (plugin: IndustryPlugin) => {
    setToolsError(null);
    const previous = industryPluginRef.current;
    const disabling = previous?.id === plugin.id;
    const optimistic = disabling ? null : { ...plugin, active: true };
    industryPluginRef.current = optimistic;
    setIndustryPlugin(optimistic);
    setIndustryPlugins((plugins) =>
      plugins.map((item) => ({
        ...item,
        active: !disabling && item.id === plugin.id,
      })),
    );
    setToolsOpen(false);
    textarea.current?.focus();
    try {
      if (disabling) {
        await desktopClient.deactivateIndustryPlugin(plugin.id);
      } else {
        const value = await desktopClient.activateIndustryPlugin(plugin);
        const active = isIndustryPlugin(value)
          ? value
          : { ...plugin, active: true };
        industryPluginRef.current = active;
        setIndustryPlugin(active);
      }
    } catch (error) {
      industryPluginRef.current = previous;
      setIndustryPlugin(previous);
      setIndustryPlugins((plugins) =>
        plugins.map((item) => ({
          ...item,
          active: previous?.id === item.id,
        })),
      );
      setToolsError(
        error instanceof Error ? error.message : "行业插件状态更新失败",
      );
    }
  };

  const selectEffort = async (value: string) => {
    setEffortSelection({ threadId: selectedThreadId, value });
    setModelOpen(false);
    setModelMenuPage("root");
    if (selectedThreadId) {
      await desktopClient.setThreadReasoningEffort(
        selectedThreadId,
        value,
        modelId,
      );
    }
  };

  const selectAccessMode = async (value: AccessMode) => {
    const selected = accessModes.find((item) => item.id === value);
    if (!selected) return;
    const previous = accessMode;
    setAccessMode(value);
    setAccessOpen(false);
    setComposerError(null);
    try {
      await desktopClient.savePolicy(selectedThreadId ?? "global", {
        ...(status?.policy ?? {
          sandbox: "workspace-write",
          approvalPolicy: "on-request",
          reviewer: "user",
          network: true,
          multiAgent: true,
          maxConcurrentAgents: 4,
        }),
        sandbox: selected.sandbox,
        approvalPolicy: selected.approvalPolicy,
        network: true,
      });
    } catch (error) {
      setAccessMode(previous);
      setComposerError(
        error instanceof Error ? error.message : "权限设置保存失败",
      );
    }
  };

  const selectModel = async (model: ModelDescriptor) => {
    setModelSelection({ threadId: selectedThreadId, value: model.id });
    setModelOpen(false);
    setModelMenuPage("root");
    if (selectedThreadId) {
      await desktopClient.setThreadReasoningEffort(
        selectedThreadId,
        effort,
        model.id,
      );
    }
  };

  const selectSpeed = (value: (typeof speeds)[number]["id"]) => {
    setSpeed(value);
    setModelOpen(false);
    setModelMenuPage("root");
  };

  const resetModelSettings = async () => {
    setModelSelection({
      threadId: selectedThreadId,
      value: defaultOnPeopleModelId,
    });
    setEffortSelection({ threadId: selectedThreadId, value: "high" });
    setSpeed("fast");
    setModelOpen(false);
    setModelMenuPage("root");
    if (selectedThreadId) {
      await desktopClient.setThreadReasoningEffort(
        selectedThreadId,
        "high",
        defaultOnPeopleModelId,
      );
    }
  };

  const toggleVoice = async () => {
    if (live.active || live.busy) await live.end();
    else await live.start(text.trim());
  };

  const closeComposerMenus = () => {
    setModeOpen(false);
    setModelOpen(false);
    setModelMenuPage("root");
    setAccessOpen(false);
    setToolsOpen(false);
    setWorkspaceOpen(false);
  };

  const runSlashCommand = async (command: SlashCommand) => {
    closeComposerMenus();
    setSlashDismissed(true);
    setText("");
    setComposerError(null);

    const requireThread = () => {
      if (selectedThreadId) return selectedThreadId;
      throw new Error(`/${command.id} 需要先打开一个任务`);
    };

    try {
      switch (command.id) {
        case "new":
          newTask();
          break;
        case "model":
          setModelMenuPage("root");
          setModelOpen(true);
          void loadModels();
          break;
        case "permissions":
          setAccessOpen(true);
          break;
        case "agent":
          setMode("agent");
          break;
        case "plan":
          setMode("plan");
          break;
        case "goal":
          setMode("goal");
          break;
        case "compact":
          await desktopClient.compactContext(requireThread());
          break;
        case "memories":
          setSettingsOpen(true, "snapshots");
          break;
        case "plugins":
        case "skills":
          setPrimaryView("plugins");
          break;
        case "mcp":
          setSettingsOpen(true, "connections");
          break;
        case "hooks":
          setSettingsOpen(true, "hooks");
          break;
        case "review":
        case "diff":
          setToolView("git");
          break;
        case "subagents":
          setToolView("activity");
          break;
        case "ps":
        case "status":
          setToolView("manage");
          break;
        case "terminal":
          window.dispatchEvent(new Event("onpeople:open-terminal"));
          break;
        case "fork":
          await desktopClient.forkThread(requireThread());
          await refreshThreads();
          break;
        case "archive":
          await desktopClient.archiveThread(requireThread());
          newTask();
          await refreshThreads();
          break;
        case "fast":
          selectSpeed("fast");
          break;
        case "settings":
          setSettingsOpen(true, "general");
          break;
        default:
          command.id satisfies never;
      }
    } catch (error) {
      setComposerError(
        error instanceof Error ? error.message : `/${command.id} 执行失败`,
      );
    } finally {
      window.requestAnimationFrame(() => textarea.current?.focus());
    }
  };

  const runSelectedSlashCommand = () => {
    const command = slashMatches[slashSelection];
    if (!command) {
      setComposerError("没有匹配的命令；按 Esc 继续输入普通消息");
      return;
    }
    void runSlashCommand(command);
  };

  return (
    <div className="composer-wrap">
      {queuedMessages.length > 0 ? (
        <div className="composer-queue" aria-label="待执行消息">
          {queuedMessages.map((message) => {
            const busy =
              message.status === "pending" || message.status === "steering";
            return (
              <div
                className={`composer-queue-item is-${message.status ?? "queued"}`}
                key={message.id}
              >
                <span className="composer-queue-icon" aria-hidden="true">
                  {busy ? (
                    <LoaderCircle className="spin" size={15} />
                  ) : (
                    <CornerDownRight size={15} />
                  )}
                </span>
                <span className="composer-queue-text" title={message.text}>
                  {message.text}
                </span>
                {message.status === "failed" ? (
                  <span className="composer-queue-failed">排队失败</span>
                ) : null}
                <button
                  type="button"
                  className="composer-queue-guide"
                  disabled={busy || message.status === "failed"}
                  onClick={() => void steerQueuedMessage(message.id)}
                >
                  <CornerDownRight size={14} aria-hidden="true" />
                  <span>引导</span>
                </button>
                <button
                  type="button"
                  className="composer-queue-action"
                  aria-label="删除排队消息"
                  disabled={busy}
                  onClick={() => void deleteQueuedMessage(message.id)}
                >
                  <Trash2 size={15} aria-hidden="true" />
                </button>
                <div className="composer-queue-menu-wrap">
                  <button
                    type="button"
                    className="composer-queue-action"
                    aria-label="更多排队消息操作"
                    aria-expanded={queueMenuId === message.id}
                    onClick={() =>
                      setQueueMenuId((current) =>
                        current === message.id ? null : message.id,
                      )
                    }
                  >
                    <MoreHorizontal size={16} aria-hidden="true" />
                  </button>
                  {queueMenuId === message.id ? (
                    <div className="composer-queue-menu" role="menu">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setText(message.text);
                          setQueueMenuId(null);
                          window.requestAnimationFrame(() =>
                            textarea.current?.focus(),
                          );
                        }}
                      >
                        复制到输入框
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
      <div className={`composer${attachmentDragActive ? " is-dragging" : ""}`}>
        {attachmentDragActive ? (
          <div className="attachment-drop-overlay" aria-hidden="true">
            <Paperclip size={18} />
            <span>松开即可添加文件</span>
          </div>
        ) : null}
        {activeGoal ? (
          <div className="composer-goal" title={activeGoal.objective}>
            <Goal size={13} aria-hidden="true" />
            <strong>进行中的目标</strong>
            <span>{activeGoal.objective}</span>
          </div>
        ) : null}
        <LiveCallPanel {...live} />
        {images.length > 0 ||
        attachments.length > 0 ||
        capability ||
        industryPlugin ? (
          <div className="attachment-strip">
            {capability ? (
              <CapabilityChip
                capability={capability}
                onRemove={() => setCapability(null)}
              />
            ) : null}
            {industryPlugin ? (
              <IndustryPluginChip
                plugin={industryPlugin}
                onRemove={() => void toggleIndustryPlugin(industryPlugin)}
              />
            ) : null}
            {images.map((path) => (
              <AttachmentChip
                key={path}
                path={path}
                image
                onRemove={() =>
                  setImages((current) =>
                    current.filter((item) => item !== path),
                  )
                }
              />
            ))}
            {attachments.map((path) => (
              <AttachmentChip
                key={path}
                path={path}
                onRemove={() =>
                  setAttachments((current) =>
                    current.filter((item) => item !== path),
                  )
                }
              />
            ))}
          </div>
        ) : null}
        <div className="slash-command-wrap">
          {slashOpen ? (
            <div
              className="slash-command-popover"
              role="listbox"
              aria-label="斜杠命令"
            >
              <div className="slash-command-heading">
                <span>命令</span>
                <small>输入以筛选 · Enter 执行 · Esc 关闭</small>
              </div>
              <div className="slash-command-list">
                {slashMatches.length > 0 ? (
                  slashMatches.map((command, index) => (
                    <button
                      type="button"
                      role="option"
                      aria-selected={index === slashSelection}
                      className={index === slashSelection ? "is-selected" : ""}
                      key={command.id}
                      onPointerMove={() => setSlashSelection(index)}
                      onClick={() => void runSlashCommand(command)}
                    >
                      <span className="slash-command-name">/{command.id}</span>
                      <span className="slash-command-copy">
                        <strong>{command.label}</strong>
                        <small>{command.description}</small>
                      </span>
                      <SlashCommandGlyph id={command.id} />
                    </button>
                  ))
                ) : (
                  <div className="slash-command-empty">没有匹配的命令</div>
                )}
              </div>
            </div>
          ) : null}
          <textarea
            ref={textarea}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setSlashDismissed(false);
            }}
            onPaste={(event) => {
              if (!clipboardContainsFiles(event.clipboardData)) return;
              event.preventDefault();
              if (working) {
                setComposerError("请等待当前任务完成后再添加附件。");
                return;
              }
              void pasteFiles();
            }}
            onCompositionStart={() => {
              composing.current = true;
              suppressImeEnterUntil.current = Number.NEGATIVE_INFINITY;
            }}
            onCompositionEnd={() => {
              const now = performance.now();
              composing.current = false;
              // If keydown already arrived while composing, it was consumed by
              // the IME and the next Enter is intentional. Otherwise WebKit may
              // still deliver the candidate-confirming Enter just after this.
              suppressImeEnterUntil.current =
                now - lastImeEnterAt.current <= IME_ENTER_GUARD_MS
                  ? Number.NEGATIVE_INFINITY
                  : now + IME_ENTER_GUARD_MS;
            }}
            onKeyDown={(event) => {
              const now = performance.now();
              const nativeKey = event.nativeEvent as KeyboardEvent;
              const nativeImeEnter =
                composing.current ||
                nativeKey.isComposing ||
                event.keyCode === 229 ||
                nativeKey.keyCode === 229 ||
                nativeKey.which === 229 ||
                event.key === "Process" ||
                event.code === "Process";

              if (nativeImeEnter) {
                lastImeEnterAt.current = now;
                suppressImeEnterUntil.current = Number.NEGATIVE_INFINITY;
                return;
              }

              if (
                event.key === "Enter" &&
                now <= suppressImeEnterUntil.current
              ) {
                event.preventDefault();
                suppressImeEnterUntil.current = Number.NEGATIVE_INFINITY;
                lastImeEnterAt.current = now;
                return;
              }

              if (slashOpen && event.key === "Escape") {
                event.preventDefault();
                setSlashDismissed(true);
                return;
              }

              if (slashOpen && event.key === "ArrowDown") {
                event.preventDefault();
                setSlashSelection((current) =>
                  slashMatches.length > 0
                    ? (current + 1) % slashMatches.length
                    : 0,
                );
                return;
              }

              if (slashOpen && event.key === "ArrowUp") {
                event.preventDefault();
                setSlashSelection((current) =>
                  slashMatches.length > 0
                    ? (current - 1 + slashMatches.length) % slashMatches.length
                    : 0,
                );
                return;
              }

              if (
                slashOpen &&
                (event.key === "Tab" ||
                  (event.key === "Enter" && !event.shiftKey))
              ) {
                event.preventDefault();
                runSelectedSlashCommand();
                return;
              }

              if (event.key !== "Enter" || event.shiftKey) return;

              event.preventDefault();
              void submit();
            }}
            rows={1}
            placeholder={
              working ? "输入下一条消息，发送后加入队列…" : "随心输入"
            }
            aria-label="任务输入"
          />
        </div>
        {composerError ? (
          <div className="composer-error" role="alert">
            {composerError}
          </div>
        ) : null}
        {mode === "goal" && !working && !activeGoal ? (
          <label className="composer-goal-budget">
            <Goal size={12} aria-hidden="true" />
            <span>目标 Token 预算</span>
            <input
              aria-label="目标 Token 预算"
              type="number"
              min="1"
              step="1000"
              value={goalTokenBudget}
              onChange={(event) => setGoalTokenBudget(event.target.value)}
              placeholder="不限"
            />
          </label>
        ) : null}
        <div className="composer-toolbar">
          <div className="composer-tools">
            <div className="composer-menu-wrap">
              <IconButton
                icon={Plus}
                label="添加文件、技能与能力"
                active={toolsOpen}
                onClick={() => {
                  setToolsOpen((value) => !value);
                  setModeOpen(false);
                  setModelOpen(false);
                  setWorkspaceOpen(false);
                }}
              />
              {toolsOpen ? (
                <div
                  className="composer-popover tools-popover"
                  role="menu"
                  aria-label="添加文件、技能与能力"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setToolsOpen(false);
                      void addFiles(false);
                    }}
                  >
                    <Paperclip size={14} aria-hidden="true" />
                    <span>
                      <strong>添加文件或图片</strong>
                      <small>从电脑选择附件</small>
                    </span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMode("plan");
                      setToolsOpen(false);
                    }}
                  >
                    <Goal size={14} aria-hidden="true" />
                    <span>
                      <strong>计划模式</strong>
                      <small>先规划，再等待确认</small>
                    </span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setCapability("computer-use");
                      setToolsOpen(false);
                    }}
                  >
                    <Monitor size={14} aria-hidden="true" />
                    <span>
                      <strong>电脑操控</strong>
                      <small>允许本次任务操作原生应用</small>
                    </span>
                    {capability === "computer-use" ? (
                      <Check size={14} aria-hidden="true" />
                    ) : null}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setCapability("image-generation");
                      setToolsOpen(false);
                    }}
                  >
                    <Sparkles size={14} aria-hidden="true" />
                    <span>
                      <strong>图像生成</strong>
                      <small>为本次任务启用图像能力</small>
                    </span>
                    {capability === "image-generation" ? (
                      <Check size={14} aria-hidden="true" />
                    ) : null}
                  </button>
                  <div
                    className="tools-menu-section"
                    role="group"
                    aria-label="生产力插件"
                  >
                    <div className="tools-menu-heading">插件</div>
                    {productivityPlugins.map((plugin) => {
                      const PluginIcon = plugin.icon;
                      return (
                        <button
                          type="button"
                          key={plugin.id}
                          onClick={() => {
                            setCapability(
                              capability === plugin.id ? null : plugin.id,
                            );
                            setToolsOpen(false);
                            textarea.current?.focus();
                          }}
                        >
                          <PluginIcon size={14} aria-hidden="true" />
                          <span>
                            <strong>{plugin.name}</strong>
                            <small>{plugin.description}</small>
                          </span>
                          {capability === plugin.id ? (
                            <Check size={14} aria-hidden="true" />
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setPrimaryView("plugins");
                      setToolsOpen(false);
                    }}
                  >
                    <Puzzle size={14} aria-hidden="true" />
                    <span>
                      <strong>技能与插件</strong>
                      <small>管理 MCP、技能和扩展</small>
                    </span>
                  </button>
                  {industryPlugins.length > 0 ? (
                    <div
                      className="tools-menu-section"
                      role="group"
                      aria-label="行业插件"
                    >
                      <div className="tools-menu-heading">行业插件</div>
                      {industryPlugins.map((plugin) => (
                        <button
                          type="button"
                          key={plugin.id}
                          onClick={() => void toggleIndustryPlugin(plugin)}
                        >
                          <Puzzle size={14} aria-hidden="true" />
                          <span>
                            <strong>{plugin.name}</strong>
                            <small>
                              {industryPlugin?.id === plugin.id
                                ? "将用于当前任务"
                                : "为任务加载专用工作流"}
                            </small>
                          </span>
                          {industryPlugin?.id === plugin.id ? (
                            <Check size={14} aria-hidden="true" />
                          ) : null}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <div className="tools-search">
                    <Search size={13} aria-hidden="true" />
                    <input
                      value={toolsQuery}
                      onChange={(event) => setToolsQuery(event.target.value)}
                      placeholder="搜索项目文件"
                      aria-label="搜索项目文件"
                    />
                  </div>
                  {toolsLoading ? (
                    <div className="tools-menu-status">正在读取项目…</div>
                  ) : null}
                  {toolsError ? (
                    <div className="tools-menu-status is-error">
                      {toolsError}
                    </div>
                  ) : null}
                  {quickFiles.length > 0 ? (
                    <div
                      className="tools-menu-section"
                      role="group"
                      aria-label="项目文件"
                    >
                      <div className="tools-menu-heading">项目文件</div>
                      {quickFiles.map((file) => (
                        <button
                          type="button"
                          key={file.path}
                          onClick={() => addQuickFile(file)}
                          title={file.path}
                        >
                          <FileText size={14} aria-hidden="true" />
                          <span>
                            <strong>{file.label}</strong>
                            <small>{file.path}</small>
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {projectActions.length > 0 ? (
                    <div
                      className="tools-menu-section"
                      role="group"
                      aria-label="项目动作"
                    >
                      <div className="tools-menu-heading">项目动作</div>
                      {projectActions.map((action) => (
                        <button
                          type="button"
                          key={action.id}
                          onClick={() => void runProjectAction(action)}
                          title={`${action.command}\n${action.source}`}
                        >
                          <TerminalSquare size={14} aria-hidden="true" />
                          <span>
                            <strong>{action.label}</strong>
                            <small>{action.command}</small>
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="composer-menu-wrap">
              <button
                className="mode-selector"
                type="button"
                aria-expanded={modeOpen}
                disabled={working}
                onClick={() => {
                  setModeOpen((value) => !value);
                  setWorkspaceOpen(false);
                }}
              >
                <Goal size={13} aria-hidden="true" />
                <span>{activeGoal ? "目标" : selectedMode.label}</span>
                <ChevronDown size={12} aria-hidden="true" />
              </button>
              {modeOpen ? (
                <div className="composer-popover mode-popover">
                  {modes.map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() => {
                        setMode(item.id);
                        setModeOpen(false);
                      }}
                    >
                      <span>
                        <strong>{item.label}</strong>
                        <small>{item.description}</small>
                      </span>
                      {item.id === mode ? <Check size={14} /> : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
          <div className="composer-submit-tools">
            {working ? (
              <span className="composer-working-status" role="status">
                {runtimeActivityLabel}
              </span>
            ) : null}
            {working ? (
              <span
                className="composer-running-indicator"
                aria-label={runtimeActivityLabel}
              >
                <LoaderCircle className="spin" size={17} aria-hidden="true" />
              </span>
            ) : null}
            <div className="composer-menu-wrap">
              <button
                className="model-selector"
                type="button"
                aria-expanded={modelOpen}
                disabled={working}
                onClick={() => {
                  const next = !modelOpen;
                  setModelOpen(next);
                  setModelMenuPage("root");
                  setWorkspaceOpen(false);
                  if (next) void loadModels();
                }}
              >
                <span>{compactModelName}</span>
                <strong>{effortName}</strong>
                <ChevronDown size={12} />
              </button>
              {modelOpen ? (
                <div
                  className={`composer-popover model-settings-shell${modelMenuPage !== "root" ? " has-submenu" : ""}`}
                >
                  <div className="model-settings-panel model-settings-root-panel">
                    <button
                      type="button"
                      className={`model-settings-row${modelMenuPage === "model" ? " is-selected" : ""}`}
                      aria-current={
                        modelMenuPage === "model" ? "page" : undefined
                      }
                      onClick={() => setModelMenuPage("model")}
                    >
                      <strong>模型</strong>
                      <span>{compactModelName}</span>
                    </button>
                    <button
                      type="button"
                      className={`model-settings-row${modelMenuPage === "effort" ? " is-selected" : ""}`}
                      aria-current={
                        modelMenuPage === "effort" ? "page" : undefined
                      }
                      onClick={() => setModelMenuPage("effort")}
                    >
                      <strong>推理强度</strong>
                      <span>{effortName}</span>
                    </button>
                    <button
                      type="button"
                      className={`model-settings-row${modelMenuPage === "speed" ? " is-selected" : ""}`}
                      aria-current={
                        modelMenuPage === "speed" ? "page" : undefined
                      }
                      onClick={() => setModelMenuPage("speed")}
                    >
                      <strong>速度</strong>
                      <span>{speedName}</span>
                    </button>
                    <div className="model-settings-divider" />
                    <button
                      type="button"
                      className="model-settings-reset"
                      onClick={() => void resetModelSettings()}
                    >
                      <strong>重置为默认设置</strong>
                      <RotateCcw size={16} aria-hidden="true" />
                    </button>
                  </div>
                  {modelMenuPage !== "root" ? (
                    <div className="model-settings-panel model-settings-submenu">
                      <div className="model-settings-submenu-heading">
                        <button
                          type="button"
                          aria-label="返回模型设置"
                          onClick={() => setModelMenuPage("root")}
                        >
                          <ChevronLeft size={16} aria-hidden="true" />
                        </button>
                        <strong>
                          {modelMenuPage === "model"
                            ? "模型"
                            : modelMenuPage === "effort"
                              ? "推理强度"
                              : "速度"}
                        </strong>
                      </div>
                      {modelMenuPage === "model" ? (
                        <div
                          className="model-options"
                          role="group"
                          aria-label="模型"
                        >
                          {modelsLoading ? (
                            <span className="model-loading">
                              正在读取可用模型…
                            </span>
                          ) : null}
                          {models.map((model) => (
                            <button
                              type="button"
                              className="model-option"
                              key={`${model.provider}-${model.id}`}
                              onClick={() => void selectModel(model)}
                            >
                              <strong>{model.name || model.id}</strong>
                              {model.id === modelId ? (
                                <Check size={16} />
                              ) : null}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      {modelMenuPage === "effort"
                        ? efforts.map((item) => (
                            <button
                              type="button"
                              className="model-settings-choice"
                              key={item.id}
                              onClick={() => void selectEffort(item.id)}
                            >
                              <strong>{item.label}</strong>
                              {item.id === effort ? <Check size={16} /> : null}
                            </button>
                          ))
                        : null}
                      {modelMenuPage === "speed"
                        ? speeds.map((item) => (
                            <button
                              type="button"
                              className="model-settings-choice"
                              key={item.id}
                              onClick={() => selectSpeed(item.id)}
                            >
                              <strong>{item.label}</strong>
                              {item.id === speed ? <Check size={16} /> : null}
                            </button>
                          ))
                        : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
            <IconButton
              icon={Mic}
              label={live.active || live.busy ? "结束语音" : "开始语音"}
              active={live.active || live.busy}
              onClick={() => void toggleVoice()}
            />
            <button
              className={`send-button ${working && !text.trim() ? "is-stop" : ""} ${working && text.trim() ? "is-queue" : ""}`}
              type="button"
              onClick={() =>
                working && !text.trim() ? void interrupt() : void submit()
              }
              disabled={!working && !hasDraftContent}
              title={
                working
                  ? text.trim()
                    ? "加入消息队列"
                    : activeGoal
                      ? "暂停目标"
                      : "停止任务"
                  : "发送"
              }
              aria-label={
                working
                  ? text.trim()
                    ? "加入消息队列"
                    : activeGoal
                      ? "暂停目标"
                      : "停止任务"
                  : "发送"
              }
            >
              {working && !text.trim() ? (
                <Square size={13} fill="currentColor" />
              ) : (
                <ArrowUp size={17} />
              )}
            </button>
          </div>
        </div>
      </div>
      <div className="composer-footer">
        <div className="composer-menu-wrap workspace-menu-wrap">
          <button
            className="workspace-selector"
            type="button"
            aria-expanded={workspaceOpen}
            aria-label="选择工作空间"
            title={activeCwd || "选择工作空间"}
            onClick={() => {
              const next = !workspaceOpen;
              setWorkspaceOpen(next);
              setWorkspaceError(null);
              setAccessOpen(false);
              setModeOpen(false);
              setModelOpen(false);
              setToolsOpen(false);
              if (!next) setWorkspaceQuery("");
            }}
          >
            <Folder size={15} aria-hidden="true" />
            <strong>{activeWorkspaceName}</strong>
            <ChevronDown size={13} aria-hidden="true" />
          </button>
          {workspaceOpen ? (
            <div
              className="composer-popover workspace-popover"
              role="menu"
              aria-label="选择工作空间"
            >
              <label className="workspace-search">
                <Search size={16} aria-hidden="true" />
                <input
                  autoFocus
                  type="search"
                  value={workspaceQuery}
                  onChange={(event) => setWorkspaceQuery(event.target.value)}
                  placeholder="搜索工作空间"
                  aria-label="搜索工作空间"
                />
              </label>
              <div className="workspace-list" role="group">
                {workspaceOptions.map((workspace) => (
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={workspace.path === activeCwd}
                    className={
                      workspace.path === activeCwd ? "is-selected" : ""
                    }
                    key={workspace.path}
                    title={workspace.path}
                    onClick={() => chooseWorkspace(workspace.path)}
                  >
                    <Folder size={16} aria-hidden="true" />
                    <span>{workspace.name}</span>
                    {workspace.path === activeCwd ? (
                      <Check size={14} aria-hidden="true" />
                    ) : null}
                  </button>
                ))}
                {workspaceOptions.length === 0 ? (
                  <div className="workspace-empty">没有匹配的工作空间</div>
                ) : null}
              </div>
              <div className="workspace-actions">
                <button type="button" onClick={() => chooseWorkspace()}>
                  <Plus size={16} aria-hidden="true" />
                  <span>新建工作空间</span>
                </button>
                <button type="button" onClick={() => void openLocalFolder()}>
                  <Folder size={16} aria-hidden="true" />
                  <span>打开本地文件夹</span>
                </button>
              </div>
              {workspaceError ? (
                <div className="workspace-error" role="alert">
                  {workspaceError}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="composer-footer-actions">
          <div className="composer-menu-wrap access-menu-wrap">
            <button
              className={`access-selector ${fullAccess ? "is-full" : ""}`}
              type="button"
              aria-expanded={accessOpen}
              disabled={working}
              onClick={() => {
                setAccessOpen((value) => !value);
                setWorkspaceOpen(false);
              }}
              title="设置工作区访问与审批方式"
              aria-label="设置工作区访问与审批方式"
            >
              {fullAccess ? (
                <ShieldAlert size={14} aria-hidden="true" />
              ) : (
                <ShieldCheck size={14} aria-hidden="true" />
              )}
              <span>{accessLabel}</span>
              <ChevronDown size={13} aria-hidden="true" />
            </button>
            {accessOpen ? (
              <div
                className="composer-popover access-popover"
                role="menu"
                aria-label="工作区访问设置"
              >
                <div className="access-popover-heading">
                  应如何批准 OnPeople 操作？
                </div>
                {accessModes.map((item) => {
                  const Icon =
                    item.id === "request"
                      ? Hand
                      : item.id === "auto"
                        ? ShieldCheck
                        : ShieldAlert;
                  return (
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={item.id === accessMode}
                      className={`access-option ${
                        item.id === accessMode ? "is-selected" : ""
                      } ${item.id === "full" ? "is-danger" : ""}`}
                      key={item.id}
                      onClick={() => void selectAccessMode(item.id)}
                    >
                      <Icon size={19} aria-hidden="true" />
                      <span>
                        <strong>{item.label}</strong>
                        <small>{item.description}</small>
                      </span>
                      {item.id === accessMode ? (
                        <Check size={16} aria-hidden="true" />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function workspaceName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function isModelDescriptor(value: unknown): value is ModelDescriptor {
  if (typeof value !== "object" || value === null) return false;
  const model = value as Record<string, unknown>;
  return (
    typeof model.id === "string" &&
    typeof model.name === "string" &&
    typeof model.provider === "string"
  );
}

function isQuickLauncherFile(value: unknown): value is QuickLauncherFile {
  if (typeof value !== "object" || value === null) return false;
  const file = value as Record<string, unknown>;
  return (
    file.kind === "file" &&
    typeof file.path === "string" &&
    typeof file.label === "string"
  );
}

function isIndustryPlugin(value: unknown): value is IndustryPlugin {
  if (typeof value !== "object" || value === null) return false;
  const plugin = value as Record<string, unknown>;
  return (
    typeof plugin.id === "string" &&
    typeof plugin.name === "string" &&
    typeof plugin.active === "boolean"
  );
}

function absoluteWorkspacePath(cwd: string, path: string): string {
  if (/^(?:[A-Za-z]:[\\/]|[\\/])/u.test(path)) return path;
  return `${cwd.replace(/[\\/]+$/u, "")}/${path.replace(/^[\\/]+/u, "")}`;
}

function SlashCommandGlyph({ id }: { id: SlashCommandId }) {
  switch (id) {
    case "model":
    case "fast":
      return <Sparkles size={15} aria-hidden="true" />;
    case "permissions":
      return <ShieldCheck size={15} aria-hidden="true" />;
    case "plan":
    case "goal":
      return <Goal size={15} aria-hidden="true" />;
    case "plugins":
    case "skills":
    case "mcp":
    case "hooks":
      return <Puzzle size={15} aria-hidden="true" />;
    case "review":
    case "diff":
    case "fork":
      return <CornerDownRight size={15} aria-hidden="true" />;
    case "terminal":
    case "ps":
    case "status":
      return <TerminalSquare size={15} aria-hidden="true" />;
    case "archive":
      return <Trash2 size={15} aria-hidden="true" />;
    case "new":
      return <Plus size={15} aria-hidden="true" />;
    case "memories":
      return <BookOpen size={15} aria-hidden="true" />;
    case "agent":
    case "subagents":
    case "compact":
    case "settings":
      return <Sparkles size={15} aria-hidden="true" />;
  }
}

function AttachmentChip({
  path,
  image,
  onRemove,
}: {
  path: string;
  image?: boolean;
  onRemove: () => void;
}) {
  const name = path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
  return (
    <span className="attachment-chip" title={path}>
      {image ? <Image size={13} /> : <FileText size={13} />}
      <span>{name}</span>
      <button type="button" onClick={onRemove} aria-label={`移除 ${name}`}>
        <X size={12} />
      </button>
    </span>
  );
}

function CapabilityChip({
  capability,
  onRemove,
}: {
  capability: string;
  onRemove: () => void;
}) {
  const label = capabilityLabels[capability] ?? capability;
  return (
    <span className="attachment-chip capability-chip" title={`能力：${label}`}>
      <Sparkles size={13} />
      <span>{label}</span>
      <button type="button" onClick={onRemove} aria-label={`移除能力 ${label}`}>
        <X size={12} />
      </button>
    </span>
  );
}

function IndustryPluginChip({
  plugin,
  onRemove,
}: {
  plugin: IndustryPlugin;
  onRemove: () => void;
}) {
  return (
    <span
      className="attachment-chip capability-chip"
      title={`行业插件：${plugin.name}`}
    >
      <Puzzle size={13} />
      <span>{plugin.name}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`移除行业插件 ${plugin.name}`}
      >
        <X size={12} />
      </button>
    </span>
  );
}
