import {
  AlertCircle,
  ArrowDown,
  Check,
  ChevronRight,
  CircleDashed,
  Clipboard,
  Code2,
  FileText,
  FileDiff,
  FolderOpen,
  Image as ImageIcon,
  ListChecks,
  MessageCircleQuestion,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TimerReset,
  Wifi,
  Wrench,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { desktopClient } from "../lib/desktopClient";
import {
  executionRecoveryPresentation,
  resumeFromFailurePrompt,
  retryCommandPrompt,
  STALL_WARNING_MS,
} from "../lib/executionRecovery";
import { useWorkbenchStore } from "../store/workbenchStore";
import type { TimelineItem } from "../types";
import { ArtifactImageOutput } from "./ArtifactImageOutput";
import { MarkdownMessage } from "./MarkdownMessage";

const suggestions = [
  "解释这个代码库的结构",
  "检查最近的代码改动",
  "定位并修复一个问题",
  "为下一步工作制定计划",
];

export function Timeline() {
  const timeline = useWorkbenchStore((state) => state.timeline);
  const turnStartedAt = useWorkbenchStore((state) => state.turnStartedAt);
  const turnDurations = useWorkbenchStore((state) => state.turnDurations);
  const runtime = useWorkbenchStore((state) => state.runtime);
  const threadLoading = useWorkbenchStore((state) => state.threadLoading);
  const selectedThreadId = useWorkbenchStore((state) => state.selectedThreadId);
  const sendPrompt = useWorkbenchStore((state) => state.sendPrompt);
  const reconnectRuntime = useWorkbenchStore((state) => state.reconnectRuntime);
  const interrupt = useWorkbenchStore((state) => state.interrupt);
  const draftCwd = useWorkbenchStore((state) => state.draftCwd);
  const preferences = useWorkbenchStore((state) => state.preferences);
  const end = useRef<HTMLDivElement>(null);
  const followOutput = useRef(true);
  const userPausedFollow = useRef(false);
  const previousThreadId = useRef<string | null>(selectedThreadId);
  const previousTimelineLength = useRef(0);
  const scrollFrame = useRef<number | null>(null);
  const [pausedFollowThread, setPausedFollowThread] = useState<string | null>(
    null,
  );
  const showJumpToLatest = pausedFollowThread === selectedThreadId;
  const runtimeWorking =
    runtime?.state === "working" &&
    Boolean(selectedThreadId) &&
    runtime.threadId === selectedThreadId;
  const displayTimeline = orderCompletedTurnActivities(
    collapseDuplicateCommandTraces(inferMissingTurnIds(timeline)),
    runtimeWorking,
  );
  const hasLiveTurn =
    displayTimeline.some(
      (item) =>
        isActivelyPending(item) &&
        (!item.turnId || turnDurations[item.turnId] === undefined),
    ) || runtimeWorking;
  const [now, setNow] = useState(() => Date.now());
  const [stallSnooze, setStallSnooze] = useState(0);
  const [stalledToken, setStalledToken] = useState<string | null>(null);
  const activitySignature = timeline
    .map(
      (item) =>
        `${item.id}:${item.text.length}:${item.status ?? ""}:${item.pending ?? ""}`,
    )
    .join("|");
  const stallToken = `${selectedThreadId ?? "new"}:${activitySignature}:${stallSnooze}`;

  useEffect(() => {
    if (!hasLiveTurn) return;
    const updateClock = () => setNow(Date.now());
    updateClock();
    const timer = window.setInterval(updateClock, 1_000);
    document.addEventListener("visibilitychange", updateClock);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", updateClock);
    };
  }, [hasLiveTurn]);

  useEffect(() => {
    if (!runtimeWorking) return;
    const token = stallToken;
    const timer = window.setTimeout(
      () => setStalledToken(token),
      STALL_WARNING_MS,
    );
    return () => window.clearTimeout(timer);
  }, [runtimeWorking, stallToken]);

  useEffect(() => {
    const container = end.current?.closest<HTMLElement>(".workspace-scroll");
    if (!container) return;

    followOutput.current = true;
    userPausedFollow.current = false;

    const pauseFollowing = () => {
      if (container.scrollHeight <= container.clientHeight + 1) return;
      userPausedFollow.current = true;
      followOutput.current = false;
      setPausedFollowThread(selectedThreadId);
    };
    const updateFollowState = () => {
      const distanceFromBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight;
      if (distanceFromBottom <= 2) {
        userPausedFollow.current = false;
        followOutput.current = true;
        setPausedFollowThread(null);
      } else if (userPausedFollow.current || distanceFromBottom >= 48) {
        followOutput.current = false;
        setPausedFollowThread(selectedThreadId);
      }
    };
    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) pauseFollowing();
    };
    const handleTouchStart = () => pauseFollowing();
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target === container) pauseFollowing();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      if (["ArrowUp", "PageUp", "Home"].includes(event.key)) {
        pauseFollowing();
      }
    };

    updateFollowState();
    container.addEventListener("scroll", updateFollowState, { passive: true });
    container.addEventListener("wheel", handleWheel, { passive: true });
    container.addEventListener("touchstart", handleTouchStart, {
      passive: true,
    });
    container.addEventListener("pointerdown", handlePointerDown, {
      passive: true,
    });
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      container.removeEventListener("scroll", updateFollowState);
      container.removeEventListener("wheel", handleWheel);
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [selectedThreadId]);

  useEffect(() => {
    if (scrollFrame.current !== null) {
      window.cancelAnimationFrame(scrollFrame.current);
    }

    const threadChanged = previousThreadId.current !== selectedThreadId;
    const hasNewTimelineItem = threadChanged
      ? timeline.length > 0
      : timeline.length > previousTimelineLength.current;
    previousThreadId.current = selectedThreadId;
    previousTimelineLength.current = timeline.length;

    if (!followOutput.current || !end.current) return;
    scrollFrame.current = window.requestAnimationFrame(() => {
      end.current?.scrollIntoView({
        block: "end",
        behavior: hasNewTimelineItem && !runtimeWorking ? "smooth" : "auto",
      });
      scrollFrame.current = null;
    });

    return () => {
      if (scrollFrame.current !== null) {
        window.cancelAnimationFrame(scrollFrame.current);
        scrollFrame.current = null;
      }
    };
  }, [runtimeWorking, selectedThreadId, timeline]);

  const jumpToLatest = () => {
    userPausedFollow.current = false;
    followOutput.current = true;
    setPausedFollowThread(null);
    end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  };

  if (threadLoading && timeline.length === 0) {
    return (
      <section className="thread-loading" aria-label="正在载入任务">
        <CircleDashed size={17} className="spin" />
        <span>正在载入任务历史</span>
      </section>
    );
  }

  if (timeline.length === 0) {
    return (
      <section className="empty-timeline" aria-label="新任务">
        <div className="empty-symbol" aria-hidden="true">
          <Sparkles size={19} />
        </div>
        <h1>{selectedThreadId ? "继续这项任务" : "今天想做什么？"}</h1>
        <p>
          <FolderOpen size={13} aria-hidden="true" />
          <span>{draftCwd ?? "自动工作区"}</span>
        </p>
        {preferences.showSuggestions ? (
          <div className="suggestion-grid">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => void sendPrompt(suggestion)}
              >
                {suggestion}
                <ChevronRight size={14} aria-hidden="true" />
              </button>
            ))}
          </div>
        ) : null}
      </section>
    );
  }

  const awaitingUser = displayTimeline.some(
    (item) =>
      (item.kind === "approval" || item.kind === "user-input") &&
      isActivelyPending(item),
  );
  const showStallWarning =
    runtimeWorking && !awaitingUser && stalledToken === stallToken;

  return (
    <section className="timeline" aria-label="任务执行流">
      {groupTimelineItems(displayTimeline).map((block, index, blocks) => {
        const item = block.items[0];
        const turnSummary = conversationTurnSummaryAt(
          blocks,
          index,
          turnStartedAt,
          turnDurations,
          now,
          runtimeWorking,
        );
        return (
          <div className="timeline-block" key={block.id}>
            {turnSummary ? (
              <TurnSummary
                elapsedSeconds={turnSummary.elapsedSeconds}
                running={turnSummary.running}
                currentStep={turnSummary.currentStep}
                now={now}
              />
            ) : null}
            {block.kind === "activity" ? (
              <ActivitySummary items={block.items} />
            ) : (
              <TimelineEntry item={item} />
            )}
          </div>
        );
      })}
      {showStallWarning ? (
        <StallRecoveryStrip
          onKeepWaiting={() => setStallSnooze((value) => value + 1)}
          onReconnect={() => void reconnectRuntime()}
          onStop={() => void interrupt()}
        />
      ) : null}
      {showJumpToLatest ? (
        <button
          className="timeline-jump-latest"
          type="button"
          onClick={jumpToLatest}
        >
          <ArrowDown size={14} aria-hidden="true" />
          回到最新
        </button>
      ) : null}
      <div ref={end} />
    </section>
  );
}

function inferMissingTurnIds(items: TimelineItem[]): TimelineItem[] {
  let activeTurnId: string | undefined;
  return items.map((item) => {
    if (item.role === "user") {
      activeTurnId = item.turnId;
      return item;
    }
    if (item.turnId) {
      activeTurnId = item.turnId;
      return item;
    }
    return activeTurnId ? { ...item, turnId: activeTurnId } : item;
  });
}

function collapseDuplicateCommandTraces(items: TimelineItem[]): TimelineItem[] {
  const collapsed: TimelineItem[] = [];
  const commandIndexes = new Map<string, number>();

  for (const item of items) {
    const commandKey = duplicateCommandKey(item);
    const existingIndex = commandKey
      ? commandIndexes.get(commandKey)
      : undefined;
    if (existingIndex === undefined) {
      if (commandKey) commandIndexes.set(commandKey, collapsed.length);
      collapsed.push(item);
      continue;
    }

    const existing = collapsed[existingIndex];
    if (existing && commandTraceScore(item) > commandTraceScore(existing)) {
      collapsed[existingIndex] = item;
    }
  }

  return collapsed;
}

function orderCompletedTurnActivities(
  items: TimelineItem[],
  runtimeWorking = false,
): TimelineItem[] {
  if (items.length < 2) return items;

  const sourceSegments: number[] = [];
  const turnSegments = new Map<string, number>();
  let segment = -1;
  for (const item of items) {
    if (item.role === "user") segment += 1;
    const sourceSegment = Math.max(0, segment);
    sourceSegments.push(sourceSegment);
    if (item.turnId && !turnSegments.has(item.turnId)) {
      turnSegments.set(item.turnId, sourceSegment);
    }
  }

  const segments = Array.from(
    { length: Math.max(1, segment + 1) },
    () => [] as TimelineItem[],
  );
  items.forEach((item, index) => {
    const sourceSegment = sourceSegments[index] ?? 0;
    const targetSegment =
      item.role === "user" || !item.turnId
        ? sourceSegment
        : (turnSegments.get(item.turnId) ?? sourceSegment);
    segments[targetSegment]?.push(item);
  });

  return segments.flatMap((turnItems, segmentIndex) => {
    let finalReplyIndex = -1;
    for (let index = turnItems.length - 1; index >= 0; index -= 1) {
      const item = turnItems[index];
      if (item?.role === "assistant" && item.kind === "message") {
        finalReplyIndex = index;
        break;
      }
    }
    if (finalReplyIndex < 0) return turnItems;

    const trailing = turnItems.slice(finalReplyIndex + 1);
    const lateActivities = trailing.filter(isActivityItem);
    if (lateActivities.length === 0) return turnItems;
    // Keep live commentary in its original conversational position while a
    // following tool is still running. Once every late receipt is complete,
    // move it before the final reply immediately. Waiting for turn/completed
    // made the reply jump only when the summary switched to “已完成”, which
    // looked like the model response had disappeared below the viewport.
    if (
      runtimeWorking &&
      segmentIndex === segments.length - 1 &&
      lateActivities.some(isActivelyPending)
    ) {
      return turnItems;
    }
    return [
      ...turnItems.slice(0, finalReplyIndex),
      ...lateActivities,
      turnItems[finalReplyIndex]!,
      ...trailing.filter((item) => !isActivityItem(item)),
    ];
  });
}

function duplicateCommandKey(item: TimelineItem): string | undefined {
  if (item.kind !== "command" || !item.turnId) return undefined;
  const command = canonicalCommand(item.command ?? commandText(item));
  return command ? `${item.turnId}:${command}` : undefined;
}

function canonicalCommand(value: string): string {
  const command = singleLineActivityText(value).trim();
  const shellWrapped = command.match(
    /^\/bin\/(?:ba|z|)sh\s+-lc\s+(['"])([\s\S]*)\1$/u,
  );
  return (shellWrapped?.[2] ?? command).replace(/\s+/g, " ").trim();
}

function commandTraceScore(item: TimelineItem): number {
  return (
    (item.exitCode !== undefined ? 8 : 0) +
    (item.durationMs !== undefined ? 4 : 0) +
    (item.cwd ? 2 : 0) +
    (item.command ? 1 : 0)
  );
}

type TimelineBlock =
  | { id: string; kind: "item"; items: [TimelineItem] }
  | { id: string; kind: "activity"; items: TimelineItem[] };

function groupTimelineItems(items: TimelineItem[]): TimelineBlock[] {
  const blocks: TimelineBlock[] = [];
  for (const item of items) {
    const activity = isActivityItem(item);
    const previous = blocks.at(-1);
    if (
      activity &&
      previous?.kind === "activity" &&
      previous.items.at(-1)?.turnId === item.turnId
    ) {
      previous.items.push(item);
      continue;
    }
    blocks.push(
      activity
        ? { id: `activity-${item.id}`, kind: "activity", items: [item] }
        : { id: item.id, kind: "item", items: [item] },
    );
  }
  return blocks;
}

function isActivityItem(item: TimelineItem) {
  return (
    item.kind === "reasoning" ||
    (item.role === "tool" &&
      (item.kind === "command" ||
        item.kind === "file-change" ||
        item.kind === "tool"))
  );
}

function TimelineEntry({ item }: { item: TimelineItem }) {
  const [copied, setCopied] = useState(false);
  const selectedThreadId = useWorkbenchStore((state) => state.selectedThreadId);
  const showLocalArtifact = useWorkbenchStore(
    (state) => state.showLocalArtifact,
  );

  if (item.role === "user") {
    return (
      <article className="message-row message-user">
        <div className="user-bubble">
          {item.text ? (
            <div className="user-bubble-text">{item.text}</div>
          ) : null}
          {item.attachments && item.attachments.length > 0 ? (
            <div className="message-attachments" aria-label="消息附件">
              {item.attachments.map((attachment) => {
                const AttachmentIcon =
                  attachment.kind === "image" ? ImageIcon : FileText;
                return (
                  <button
                    type="button"
                    className="message-attachment"
                    key={`${attachment.kind}:${attachment.path}`}
                    title={`打开 ${attachment.path}`}
                    onClick={() => {
                      void showLocalArtifact(attachment.path, selectedThreadId);
                    }}
                  >
                    <span className="message-attachment-icon">
                      <AttachmentIcon size={16} aria-hidden="true" />
                    </span>
                    <span className="message-attachment-copy">
                      <strong>{attachment.name}</strong>
                      <small>
                        {attachment.kind === "image" ? "图片" : "文件"}
                      </small>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
        <div className="user-message-meta">
          {item.timestamp ? (
            <time>{formatMessageTime(item.timestamp)}</time>
          ) : null}
          <button
            type="button"
            aria-label="复制消息"
            title="复制消息"
            onClick={() => {
              void desktopClient.copyText(item.text).then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1200);
              });
            }}
          >
            {copied ? <Check size={12} /> : <Clipboard size={12} />}
          </button>
        </div>
        {item.delivery ? (
          <span className={`message-delivery is-${item.delivery}`}>
            {deliveryLabel(item)}
          </span>
        ) : null}
      </article>
    );
  }

  if (item.kind === "approval") {
    return <ApprovalCard item={item} />;
  }

  if (item.kind === "user-input") {
    return <UserInputCard item={item} />;
  }

  if (item.kind === "reasoning") {
    return <ReasoningCard item={item} />;
  }

  if (item.kind === "command") {
    return (
      <ToolCard
        icon={Code2}
        item={item}
        body={<CommandReceipt item={item} />}
      />
    );
  }

  if (item.kind === "file-change") {
    return (
      <ToolCard
        icon={FileDiff}
        item={item}
        body={
          item.text ? (
            <ul className="changed-files">
              {item.text.split("\n").map((file) => (
                <li key={file}>{file}</li>
              ))}
            </ul>
          ) : null
        }
      />
    );
  }

  if (item.kind === "plan") {
    return (
      <ToolCard
        icon={ListChecks}
        item={item}
        body={<MarkdownMessage text={item.text} />}
      />
    );
  }

  if (item.kind === "tool") {
    const toolText = readableToolOutput(item.text);
    return (
      <ToolCard
        icon={Wrench}
        item={item}
        body={
          item.generatedImagePath ? (
            <>
              <ArtifactImageOutput
                key={item.generatedImagePath}
                path={item.generatedImagePath}
              />
              {toolText ? (
                <details className="generated-image-details">
                  <summary>查看工具输出</summary>
                  <MarkdownMessage text={toolText} />
                </details>
              ) : null}
            </>
          ) : toolText ? (
            <MarkdownMessage text={toolText} />
          ) : null
        }
      />
    );
  }

  if (item.role === "error" || item.role === "system") {
    const recovery = executionRecoveryPresentation(item);
    if (recovery) return <RecoveryNotice item={item} />;
    return (
      <article className={`notice-row role-${item.role}`}>
        <AlertCircle size={15} />
        <div>
          {item.title ? <strong>{item.title}</strong> : null}
          <span>{item.text}</span>
        </div>
      </article>
    );
  }

  return (
    <article className="message-row message-assistant">
      <MarkdownMessage text={item.text} />
      {!item.pending && item.text ? (
        <button
          className="message-action"
          type="button"
          aria-label="复制回复"
          title="复制回复"
          onClick={() => {
            void desktopClient.copyText(item.text).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1200);
            });
          }}
        >
          {copied ? <Check size={13} /> : <Clipboard size={13} />}
        </button>
      ) : null}
    </article>
  );
}

function deliveryLabel(item: TimelineItem) {
  if (item.status) return item.status;
  return {
    pending: "正在发送",
    queued: "已加入队列",
    running: "已从队列开始执行",
    sent: "已发送",
    failed: "发送失败",
  }[item.delivery ?? "sent"];
}

function TurnSummary({
  elapsedSeconds,
  running,
  currentStep,
  now,
}: {
  elapsedSeconds: number | undefined;
  running: boolean;
  currentStep?: string | undefined;
  now: number;
}) {
  const [observedAt] = useState(now);
  const displayedElapsed =
    elapsedSeconds ??
    (running ? Math.max(0, Math.round((now - observedAt) / 1_000)) : undefined);
  return (
    <div
      className="turn-summary"
      aria-label={`${
        displayedElapsed !== undefined
          ? running
            ? `正在处理 ${formatDuration(displayedElapsed)}`
            : `处理了 ${formatDuration(displayedElapsed)}`
          : running
            ? "正在处理"
            : "处理完成"
      }${running && currentStep ? `，${currentStep}` : ""}`}
    >
      <span>
        {running
          ? displayedElapsed !== undefined
            ? `正在处理 ${formatDuration(displayedElapsed)}`
            : "正在处理"
          : displayedElapsed !== undefined
            ? `处理了 ${formatDuration(displayedElapsed)}`
            : "处理完成"}
      </span>
      {running && currentStep ? (
        <span className="turn-summary-current" aria-live="polite">
          {currentStep}
        </span>
      ) : null}
    </div>
  );
}

function conversationTurnSummaryAt(
  blocks: TimelineBlock[],
  index: number,
  turnStartedAt: Record<string, string>,
  turnDurations: Record<string, number>,
  now: number,
  runtimeWorking: boolean,
) {
  const item = blocks[index]?.items[0];
  if (!item || item.role === "user") return null;

  let startIndex = index;
  while (
    startIndex > 0 &&
    blocks[startIndex - 1]?.items.at(-1)?.role !== "user"
  ) {
    startIndex -= 1;
  }
  const previous = blocks[startIndex - 1]?.items.at(-1);
  if (
    previous?.role !== "user" &&
    startIndex !== 0 &&
    !blocks[startIndex]?.items[0]?.turnId
  ) {
    return null;
  }

  let endIndex = startIndex;
  while (
    endIndex + 1 < blocks.length &&
    blocks[endIndex + 1]?.items[0]?.role !== "user"
  ) {
    endIndex += 1;
  }
  const summary = summarizeConversationTurn(
    blocks,
    startIndex,
    turnStartedAt,
    turnDurations,
    now,
    runtimeWorking,
  );
  let placement = startIndex;
  if (!summary.running) {
    for (let candidate = endIndex; candidate >= startIndex; candidate -= 1) {
      const row = blocks[candidate]?.items[0];
      if (row?.role === "assistant" && row.kind === "message") {
        placement = candidate;
        break;
      }
    }
  }
  return index === placement ? summary : null;
}

function summarizeConversationTurn(
  blocks: TimelineBlock[],
  startIndex: number,
  turnStartedAt: Record<string, string>,
  turnDurations: Record<string, number>,
  now: number,
  runtimeWorking: boolean,
): {
  elapsedSeconds: number | undefined;
  running: boolean;
  currentStep?: string | undefined;
} {
  const items: TimelineItem[] = [];
  for (let index = startIndex; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (!block || (index > startIndex && block.items[0]?.role === "user")) {
      break;
    }
    items.push(...block.items);
  }

  const precedingUser = blocks[startIndex - 1]?.items.at(-1);
  const priorBlockCount =
    precedingUser?.role === "user" ? startIndex - 1 : startIndex;
  const priorTurnIds = new Set(
    blocks
      .slice(0, Math.max(0, priorBlockCount))
      .flatMap((block) => block.items)
      .map((item) => item.turnId)
      .filter((turnId): turnId is string => Boolean(turnId)),
  );
  const scopedItems = items.filter(
    (item) => !item.turnId || !priorTurnIds.has(item.turnId),
  );

  const turnIds = [
    ...new Set(
      scopedItems
        .map((item) => item.turnId)
        .filter((turnId): turnId is string => Boolean(turnId)),
    ),
  ];
  const isLatestConversationTurn = !blocks
    .slice(startIndex + 1)
    .some((block) => block.items[0]?.role === "user");
  const running =
    scopedItems.some(
      (item) =>
        isActivelyPending(item) &&
        (!item.turnId || turnDurations[item.turnId] === undefined),
    ) ||
    (runtimeWorking && isLatestConversationTurn);
  const currentStep = running ? currentTurnStep(scopedItems) : undefined;
  const starts = turnIds
    .map((turnId) => Date.parse(turnStartedAt[turnId] ?? ""))
    .filter(Number.isFinite);
  const submittedAt =
    precedingUser?.role === "user"
      ? Date.parse(precedingUser.timestamp ?? "")
      : NaN;
  if (Number.isFinite(submittedAt)) starts.push(submittedAt);
  const earliestStart = starts.length > 0 ? Math.min(...starts) : undefined;
  const completedEnds = turnIds.flatMap((turnId) => {
    const started = Date.parse(turnStartedAt[turnId] ?? "");
    const duration = turnDurations[turnId];
    return Number.isFinite(started) && duration !== undefined
      ? [started + duration * 1_000]
      : [];
  });

  if (earliestStart !== undefined) {
    const latestKnownEnd =
      completedEnds.length > 0 ? Math.max(...completedEnds) : undefined;
    const end = running ? now : latestKnownEnd;
    if (end !== undefined) {
      return {
        elapsedSeconds: Math.max(0, Math.round((end - earliestStart) / 1_000)),
        running,
        currentStep,
      };
    }
  }

  const durations = turnIds
    .map((turnId) => turnDurations[turnId])
    .filter((duration): duration is number => duration !== undefined);
  return {
    elapsedSeconds: durations.length > 0 ? Math.max(...durations) : undefined,
    running,
    currentStep,
  };
}

function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
}

function formatMessageTime(timestamp: string) {
  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) return "";
  return value.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function ActivitySummary({ items }: { items: TimelineItem[] }) {
  const pending = items.some(isActivelyPending);
  const failed = items.some(hasFailed);
  const [open, setOpen] = useState(false);
  const primary = primaryActivityItem(items);
  const headline = activityHeadline(items, pending);
  const facts = primary ? digestFacts(primary, pending) : [];

  return (
    <details
      className={`activity-summary ${pending ? "is-pending" : ""} ${failed ? "is-failed" : ""}`}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span className="activity-state" aria-hidden="true">
          {pending ? (
            <CircleDashed size={13} className="spin" />
          ) : failed ? (
            <AlertCircle size={13} />
          ) : (
            <Check size={13} />
          )}
        </span>
        <strong title={headline}>{headline}</strong>
        {facts.length > 0 ? (
          <span className="activity-facts" aria-label={facts.join("，")}>
            {facts.map((fact) => (
              <span key={fact}>{fact}</span>
            ))}
          </span>
        ) : null}
      </summary>
      <div className="activity-summary-body">
        {items.map((item) =>
          item.kind === "reasoning" ? (
            <ReasoningCard key={item.id} item={item} />
          ) : (
            <TimelineEntry key={item.id} item={item} />
          ),
        )}
      </div>
    </details>
  );
}

function digestFacts(item: TimelineItem, pending: boolean): string[] {
  if (pending || item.kind !== "command" || !hasFailed(item)) return [];
  return item.exitCode === undefined ? [] : [`退出 ${item.exitCode}`];
}

function activityHeadline(items: TimelineItem[], pending: boolean): string {
  if (pending) {
    const active = [...items].reverse().find(isActivelyPending);
    if (active) return activityItemHeadline(active, true);
  }
  return completedActivityHeadline(items);
}

type ActivityCategory =
  | "browser"
  | "web-search"
  | "file-change"
  | "command"
  | "tool"
  | "reasoning";

function completedActivityHeadline(items: TimelineItem[]): string {
  if (items.some(hasFailed)) {
    const failed = [...items].reverse().find(hasFailed);
    return failed ? activityItemHeadline(failed, false) : "操作失败";
  }
  const categories = new Set(items.map(activityCategory));
  if (categories.size > 1) categories.delete("reasoning");
  const labels: Record<ActivityCategory, string> = {
    browser: "使用了内嵌浏览器",
    "web-search": "搜索了网页",
    "file-change": "修改了文件",
    command: "运行了命令",
    tool: "使用了工具",
    reasoning: "已分析",
  };
  const ordered: ActivityCategory[] = [
    "browser",
    "web-search",
    "file-change",
    "command",
    "tool",
    "reasoning",
  ];
  const parts = ordered
    .filter((category) => categories.has(category))
    .map((category) => labels[category]);
  if (parts.length === 0) return "已完成操作";
  if (parts.length === 1) return parts[0]!;
  return `${parts.slice(0, -1).join("、")}并${parts.at(-1)}`;
}

function activityCategory(item: TimelineItem): ActivityCategory {
  if (item.kind === "reasoning") return "reasoning";
  if (item.kind === "file-change") return "file-change";
  if (item.kind === "command") {
    return browserCommandKind(rawCommandText(item)) ? "browser" : "command";
  }
  const identity = `${item.title ?? ""} ${item.meta ?? ""}`.toLowerCase();
  if (/browser|computer[-_ ]?use|浏览器|电脑操控/.test(identity)) {
    return "browser";
  }
  if (/web.?search|搜索网页|检索网页/.test(identity)) return "web-search";
  return "tool";
}

function primaryActivityItem(items: TimelineItem[]): TimelineItem | undefined {
  const reversed = [...items].reverse();
  const commandReceipt = reversed.find(
    (item) =>
      item.kind === "command" &&
      (item.exitCode !== undefined || item.durationMs !== undefined),
  );
  return (
    commandReceipt ??
    reversed.find((item) => item.kind !== "reasoning") ??
    items.at(-1)
  );
}

function activityItemHeadline(item: TimelineItem, pending: boolean): string {
  const failed = hasFailed(item);
  if (item.kind === "command") {
    return commandActivityHeadline(rawCommandText(item), pending, failed);
  }
  if (item.kind === "file-change") {
    const verb = failed ? "修改失败" : pending ? "正在修改" : "已修改";
    const files = item.stats?.files;
    return files ? `${verb} ${files} 个文件` : `${verb}文件`;
  }
  if (item.kind === "reasoning") return pending ? "正在分析" : "已分析";

  const identity = `${item.title ?? ""} ${item.meta ?? ""}`.toLowerCase();
  if (/browser_open/.test(identity)) {
    if (failed) return "内嵌浏览器打开失败";
    return pending ? "正在打开内嵌浏览器" : "已打开内嵌浏览器";
  }
  if (/browser_dom_snapshot/.test(identity)) {
    if (failed) return "浏览器页面读取失败";
    return pending ? "正在读取浏览器页面" : "已读取浏览器页面";
  }
  if (/browser_(?:click|type|back|reload)/.test(identity)) {
    if (failed) return "内嵌浏览器操作失败";
    return pending ? "正在操作内嵌浏览器" : "已操作内嵌浏览器";
  }
  if (/internal_browser/.test(identity)) {
    if (failed) return "内嵌浏览器操作失败";
    return pending ? "正在使用内嵌浏览器" : "已使用内嵌浏览器";
  }
  if (/web.?search|搜索网页/.test(identity)) {
    if (failed) return "网页搜索失败";
    return pending ? "正在搜索网页" : "已搜索网页";
  }
  const title = compactActivityText(item.title ?? item.meta ?? "");
  if (title) return normalizeActivityTitle(title, pending, failed);
  return failed ? "工具执行失败" : pending ? "正在使用工具" : "已使用工具";
}

type BrowserCommandKind = "open" | "inspect" | "interact" | null;

function browserCommandKind(command: string): BrowserCommandKind {
  const normalized = command.toLowerCase();
  if (!/(cua-driver|computer[-_ ]?use|browser[_ -])/.test(normalized)) {
    return null;
  }
  if (/browser_prepare|start_session|open_browser|navigate/.test(normalized)) {
    return "open";
  }
  if (
    /get_window_state|get_accessibility_tree|visual_snapshot|screenshot|inspect/.test(
      normalized,
    )
  ) {
    return "inspect";
  }
  return "interact";
}

function commandActivityHeadline(
  command: string,
  pending: boolean,
  failed: boolean,
): string {
  const browserKind = browserCommandKind(command);
  if (browserKind) {
    if (failed) return "内嵌浏览器操作失败";
    if (browserKind === "open") {
      return pending ? "正在打开内嵌浏览器" : "已打开内嵌浏览器";
    }
    if (browserKind === "inspect") {
      return pending ? "正在读取浏览器画面" : "已读取浏览器画面";
    }
    return pending ? "正在操作内嵌浏览器" : "已操作内嵌浏览器";
  }
  const normalized = canonicalCommand(command).toLowerCase();
  if (failed) return "命令运行失败";
  if (
    /\b(?:npm|pnpm|yarn|cargo)\s+(?:test|check|clippy)\b|\bpytest\b/.test(
      normalized,
    )
  ) {
    return pending ? "正在运行检查" : "已运行检查";
  }
  if (/\b(?:npm|pnpm|yarn|cargo)\s+(?:run\s+)?build\b/.test(normalized)) {
    return pending ? "正在构建项目" : "已构建项目";
  }
  if (/\brg\b|\bgrep\b|\bfind\b/.test(normalized)) {
    return pending ? "正在搜索文件" : "已搜索文件";
  }
  if (/\bgit\s+(?:status|diff|log|show)\b/.test(normalized)) {
    return pending ? "正在检查代码改动" : "已检查代码改动";
  }
  return pending ? "正在运行命令" : "已运行命令";
}

function normalizeActivityTitle(
  title: string,
  pending: boolean,
  failed: boolean,
): string {
  if (failed) return title.replace(/^正在/, "").concat("失败");
  if (pending) return title.startsWith("正在") ? title : `正在${title}`;
  return title.startsWith("正在") ? `已${title.slice(2)}` : title;
}

function compactActivityText(value: string, limit = 72): string {
  const firstLine = value
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean)
    ?.replace(/^\$\s*/, "")
    .replace(/\s+/g, " ");
  if (!firstLine) return "";
  const characters = Array.from(firstLine);
  return characters.length > limit
    ? `${characters.slice(0, limit - 1).join("")}…`
    : firstLine;
}

function commandText(item: TimelineItem): string {
  return sanitizeToolText(canonicalCommand(rawCommandText(item)));
}

function rawCommandText(item: TimelineItem): string {
  const legacyCommand =
    item.meta && /\s/.test(item.meta.trim()) ? item.meta : undefined;
  return singleLineActivityText(item.command ?? legacyCommand ?? item.text);
}

function singleLineActivityText(value: string): string {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ⏎ ")
    .replace(/^\$\s*/, "")
    .replace(/\s+/g, " ");
}

function commandOutput(item: TimelineItem): string {
  const output = item.text.trim();
  if (!output) return "";
  if (!item.command && !(item.meta && /\s/.test(item.meta.trim()))) return "";
  const command = item.command?.trim();
  return command && output === command ? "" : sanitizeToolText(output);
}

const TOOL_OUTPUT_CHARACTER_LIMIT = 12_000;
const TOOL_OUTPUT_LINE_LIMIT = 120;

function visibleCommandOutput(output: string): {
  text: string;
  truncated: boolean;
} {
  const lines = output.split("\n");
  const clippedLines = lines.slice(0, TOOL_OUTPUT_LINE_LIMIT).join("\n");
  const characters = Array.from(clippedLines);
  const text = characters.slice(0, TOOL_OUTPUT_CHARACTER_LIMIT).join("");
  return {
    text,
    truncated:
      lines.length > TOOL_OUTPUT_LINE_LIMIT ||
      characters.length > TOOL_OUTPUT_CHARACTER_LIMIT,
  };
}

function sanitizeToolText(value: string): string {
  return value
    .replace(
      /((?:authorization)(?:\\+)?["']?\s*[=:]\s*(?:\\+)?["']?)(?:Bearer|Basic)?\s*[^\s"'\\}]+/giu,
      "$1••••••••",
    )
    .replace(
      /((?:approval[_-]?token|api[_-]?key|password|passwd|secret)(?:\\+)?["']?\s*[=:]\s*(?:\\+)?["']?)[^\s"'\\}]+/giu,
      "$1••••••••",
    )
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "sk-••••••••")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer ••••••••");
}

function outputLineCount(output: string): number {
  if (!output) return 0;
  return output.replace(/\n+$/u, "").split("\n").length;
}

function activityFacts(item: TimelineItem, pending: boolean): string[] {
  if (item.kind !== "command") return [];
  const facts: string[] = [];
  if (!pending && item.exitCode !== undefined) {
    facts.push(`退出 ${item.exitCode}`);
  }
  if (!pending && item.durationMs !== undefined) {
    facts.push(
      formatDuration(Math.max(0, Math.round(item.durationMs / 1_000))),
    );
  }
  const lines = outputLineCount(commandOutput(item));
  if (lines > 0) facts.push(`${lines} 行输出`);
  return facts;
}

function hasFailed(item: TimelineItem): boolean {
  return (
    (item.exitCode !== undefined && item.exitCode !== 0) ||
    /失败|错误|已拒绝/.test(`${item.status ?? ""}${item.title ?? ""}`)
  );
}

function currentTurnStep(items: TimelineItem[]): string {
  const pendingActivity = [...items]
    .reverse()
    .find((item) => isActivityItem(item) && isActivelyPending(item));
  if (pendingActivity) return activityItemHeadline(pendingActivity, true);
  return "正在生成回复";
}

function ReasoningCard({ item }: { item: TimelineItem }) {
  const pending = isActivelyPending(item);
  const [open, setOpen] = useState(false);
  return (
    <details
      className="reasoning-row"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        {pending ? (
          <CircleDashed size={14} className="spin" />
        ) : (
          <Sparkles size={14} />
        )}
        <span>{pending ? "正在分析" : "分析"}</span>
      </summary>
      {item.text ? (
        <div className="reasoning-summary-copy">
          <MarkdownMessage text={item.text} />
        </div>
      ) : null}
    </details>
  );
}

function ApprovalCard({ item }: { item: TimelineItem }) {
  const resolveApproval = useWorkbenchStore((state) => state.resolveApproval);
  const busy = item.status === "正在提交决定";
  const resolved = Boolean(item.approvalDecision);
  const request = item.text.trim();
  const requestLines = request.split(/\r?\n/u).filter(Boolean);
  const requestPreview = requestLines[0] ?? "";
  const hasMoreRequestDetails =
    requestLines.length > 1 || requestPreview.length > 140;
  const choose = async (decision: string) => {
    if (!item.requestId) return;
    await resolveApproval(item.requestId, decision);
    const resolvedItem = useWorkbenchStore
      .getState()
      .timeline.find((entry) => entry.requestId === item.requestId);
    if (resolvedItem?.approvalDecision) focusTaskComposer();
  };

  return (
    <article
      className={`approval-card ${resolved ? "is-resolved" : "is-pending"}`}
      aria-label={item.title ?? "操作需要确认"}
    >
      <div className="approval-card-heading">
        <span className="approval-card-icon">
          <ShieldAlert size={15} aria-hidden="true" />
        </span>
        <div>
          <strong>{item.title ?? "操作需要确认"}</strong>
          <small>{approvalKindLabel(item)}</small>
        </div>
        <span className="approval-status">{item.status}</span>
      </div>
      {request ? (
        <div className="approval-request">
          <code title={request}>{requestPreview}</code>
          {hasMoreRequestDetails ? (
            <details className="approval-details-disclosure">
              <summary>
                <ChevronRight size={13} aria-hidden="true" />
                查看完整请求
              </summary>
              <pre className="approval-details">{request}</pre>
            </details>
          ) : null}
        </div>
      ) : null}
      {item.error ? (
        <div className="approval-inline-error" role="alert">
          <AlertCircle size={13} aria-hidden="true" />
          <span>{sanitizeToolText(item.error)}</span>
        </div>
      ) : null}
      {!resolved ? (
        <div className="approval-actions">
          <button
            className="approval-decline"
            type="button"
            disabled={busy}
            onClick={() => void choose("decline")}
          >
            拒绝
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void choose("accept")}
          >
            允许一次
          </button>
          <button
            className="approval-primary"
            type="button"
            disabled={busy}
            onClick={() => void choose("acceptForSession")}
          >
            本次会话允许
          </button>
        </div>
      ) : null}
    </article>
  );
}

function approvalKindLabel(item: TimelineItem): string {
  const identity = `${item.approvalMethod ?? ""} ${item.meta ?? ""}`;
  if (/commandExecution|command|shell/iu.test(identity)) return "命令执行";
  if (/file|patch|write/iu.test(identity)) return "文件更改";
  if (/browser|network|http/iu.test(identity)) return "外部访问";
  return "需要你的批准";
}

function UserInputCard({ item }: { item: TimelineItem }) {
  const resolveUserInput = useWorkbenchStore((state) => state.resolveUserInput);
  const [answers, setAnswers] = useState<Record<string, string[]>>(
    item.userInputAnswers ?? {},
  );
  const questions = item.userInputQuestions ?? [];
  const busy = item.status === "正在提交回答";
  const resolved = Boolean(item.userInputAnswers);
  const complete = questions.every((question) =>
    (answers[question.id] ?? []).some((value) => value.trim()),
  );
  const submitAnswers = async () => {
    if (!item.requestId) return;
    await resolveUserInput(item.requestId, answers);
    const resolvedItem = useWorkbenchStore
      .getState()
      .timeline.find((entry) => entry.requestId === item.requestId);
    if (resolvedItem?.userInputAnswers) focusTaskComposer();
  };

  return (
    <article
      className={`user-input-card ${resolved ? "is-resolved" : "is-pending"}`}
      aria-label={item.title ?? "Codex 需要你的输入"}
    >
      <div className="approval-card-heading">
        <span className="approval-card-icon">
          <MessageCircleQuestion size={15} aria-hidden="true" />
        </span>
        <div>
          <strong>{item.title ?? "Codex 需要你的输入"}</strong>
          <small>回答后任务会继续运行</small>
        </div>
        <span className="approval-status">{item.status}</span>
      </div>
      <div className="user-input-questions">
        {questions.map((question) => (
          <fieldset key={question.id} disabled={busy || resolved}>
            <legend>
              <span>{question.header}</span>
              <strong>{question.question}</strong>
            </legend>
            {question.options.map((option) => (
              <label key={option.label}>
                <input
                  type="radio"
                  name={`${item.id}-${question.id}`}
                  checked={answers[question.id]?.[0] === option.label}
                  onChange={() =>
                    setAnswers((current) => ({
                      ...current,
                      [question.id]: [option.label],
                    }))
                  }
                />
                <span>
                  <strong>{option.label}</strong>
                  {option.description ? (
                    <small>{option.description}</small>
                  ) : null}
                </span>
              </label>
            ))}
            {question.options.length === 0 || question.isOther ? (
              <input
                className="user-input-other"
                aria-label={`${question.header} 自定义回答`}
                type={question.isSecret ? "password" : "text"}
                value={
                  question.options.some(
                    (option) => option.label === answers[question.id]?.[0],
                  )
                    ? ""
                    : (answers[question.id]?.[0] ?? "")
                }
                onChange={(event) =>
                  setAnswers((current) => ({
                    ...current,
                    [question.id]: [event.target.value],
                  }))
                }
                placeholder={question.isOther ? "其他回答" : "输入回答"}
              />
            ) : null}
          </fieldset>
        ))}
      </div>
      {item.error ? (
        <div className="approval-inline-error" role="alert">
          <AlertCircle size={13} aria-hidden="true" />
          <span>{sanitizeToolText(item.error)}</span>
        </div>
      ) : null}
      {!resolved ? (
        <div className="approval-actions">
          <button
            className="approval-primary"
            type="button"
            disabled={!complete || busy}
            onClick={() => void submitAnswers()}
          >
            {busy ? "提交中…" : "提交回答"}
          </button>
        </div>
      ) : null}
    </article>
  );
}

function focusTaskComposer() {
  window.requestAnimationFrame(() => {
    document
      .querySelector<HTMLTextAreaElement>("[aria-label='任务输入']")
      ?.focus();
  });
}

function ToolCard({
  icon: Icon,
  item,
  body,
}: {
  icon: typeof Code2;
  item: TimelineItem;
  body: React.ReactNode;
}) {
  const failed = hasFailed(item);
  const [open, setOpen] = useState(false);
  const pending = isActivelyPending(item);
  return (
    <details
      className={`tool-card ${pending ? "is-pending" : ""}`}
      open={failed || open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span className="tool-card-icon">
          {pending ? (
            <CircleDashed size={14} className="spin" />
          ) : (
            <Icon size={14} />
          )}
        </span>
        <span className="tool-card-copy">
          <strong>{displayTimelineTitle(item, pending)}</strong>
          {item.meta ? <small>{item.meta}</small> : null}
        </span>
        {item.status ? (
          <span className="tool-status">
            {displayTimelineStatus(item.status)}
          </span>
        ) : null}
      </summary>
      {body || item.stats ? (
        <div className="tool-card-body">
          {body}
          {item.stats ? <DiffStatChip stats={item.stats} /> : null}
        </div>
      ) : null}
    </details>
  );
}

function CommandReceipt({ item }: { item: TimelineItem }) {
  const command = commandText(item);
  const output = commandOutput(item);
  const visibleOutput = visibleCommandOutput(output);
  const pending = isActivelyPending(item);
  const failed = hasFailed(item);
  const facts = activityFacts(item, pending);
  const runtime = useWorkbenchStore((state) => state.runtime);
  const sendingPrompt = useWorkbenchStore((state) => state.sendingPrompt);
  const sendPrompt = useWorkbenchStore((state) => state.sendPrompt);
  const [submittedAction, setSubmittedAction] = useState<
    "retry" | "resume" | null
  >(null);
  const commandTurnStillRunning =
    runtime?.state === "working" &&
    Boolean(item.turnId) &&
    runtime.turnId === item.turnId;

  const submitRecovery = async (kind: "retry" | "resume") => {
    const prompt =
      kind === "retry" && command
        ? retryCommandPrompt(item, command)
        : resumeFromFailurePrompt;
    const submission = await sendPrompt(prompt);
    if (submission) setSubmittedAction(kind);
  };

  return (
    <div className={`command-receipt ${failed ? "is-failed" : ""}`}>
      {facts.length > 0 ? (
        <div className="command-receipt-facts" aria-label="执行结果">
          {facts.map((fact) => (
            <span key={fact}>{fact}</span>
          ))}
        </div>
      ) : null}
      {command ? (
        <div className="command-receipt-section">
          <span>命令</span>
          <pre className="command-receipt-command">{command}</pre>
        </div>
      ) : null}
      {item.cwd ? (
        <div className="command-receipt-cwd">
          <span>目录</span>
          <code>{item.cwd}</code>
        </div>
      ) : null}
      {output ? (
        <div className="command-receipt-section">
          <span>输出</span>
          <pre>{visibleOutput.text}</pre>
          {visibleOutput.truncated ? (
            <small className="command-output-truncated">
              输出较长，仅显示前 {TOOL_OUTPUT_LINE_LIMIT} 行
            </small>
          ) : null}
        </div>
      ) : !pending ? (
        <div className="command-receipt-empty">无输出</div>
      ) : null}
      {failed ? (
        <div className="command-recovery">
          <div className="command-recovery-copy">
            <ShieldCheck size={14} aria-hidden="true" />
            <strong>
              {commandTurnStillRunning
                ? "OnPeople 正在继续处理"
                : "失败结果已保留"}
            </strong>
          </div>
          {!commandTurnStillRunning ? (
            <div className="recovery-actions">
              <button
                type="button"
                disabled={sendingPrompt || submittedAction !== null || !command}
                onClick={() => void submitRecovery("retry")}
              >
                <RefreshCw size={13} aria-hidden="true" />
                {submittedAction === "retry" ? "已提交重试" : "重试命令"}
              </button>
              <button
                type="button"
                className="is-secondary"
                disabled={sendingPrompt || submittedAction !== null}
                onClick={() => void submitRecovery("resume")}
              >
                {submittedAction === "resume" ? "已提交继续" : "从断点继续"}
              </button>
              <button
                type="button"
                className="is-quiet"
                onClick={() =>
                  void desktopClient.copyText(
                    [command, output].filter(Boolean).join("\n\n"),
                  )
                }
              >
                <Clipboard size={13} aria-hidden="true" />
                复制错误
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function RecoveryNotice({ item }: { item: TimelineItem }) {
  const recovery = executionRecoveryPresentation(item);
  const reconnectRuntime = useWorkbenchStore((state) => state.reconnectRuntime);
  const runtimeRetrying = useWorkbenchStore((state) => state.runtimeRetrying);
  const sendingPrompt = useWorkbenchStore((state) => state.sendingPrompt);
  const sendPrompt = useWorkbenchStore((state) => state.sendPrompt);
  const [submitted, setSubmitted] = useState(false);

  if (!recovery) return null;
  const busy = runtimeRetrying || sendingPrompt || submitted;
  const runPrimaryAction = async () => {
    if (recovery.primaryAction === "reconnect") {
      await reconnectRuntime();
      return;
    }
    const submission = await sendPrompt(resumeFromFailurePrompt);
    if (submission) setSubmitted(true);
  };

  return (
    <article
      className={`recovery-card is-${recovery.kind}`}
      role={recovery.kind === "transport" ? "status" : "alert"}
    >
      <div className="recovery-card-icon" aria-hidden="true">
        {recovery.kind === "connection" || recovery.kind === "transport" ? (
          <Wifi size={15} />
        ) : recovery.kind === "timeout" ? (
          <TimerReset size={15} />
        ) : (
          <AlertCircle size={15} />
        )}
      </div>
      <div className="recovery-card-content">
        <div className="recovery-card-heading">
          <span>{recovery.eyebrow}</span>
          {recovery.route ? <code>{recovery.route}</code> : null}
        </div>
        <strong>{recovery.title}</strong>
        <p>{sanitizeToolText(recovery.description)}</p>
        <div className="recovery-preservation">
          <ShieldCheck size={13} aria-hidden="true" />
          <span>{recovery.preservation}</span>
        </div>
        <div className="recovery-actions">
          <button type="button" disabled={busy} onClick={runPrimaryAction}>
            <RefreshCw size={13} aria-hidden="true" />
            {runtimeRetrying
              ? "正在恢复"
              : submitted
                ? "已提交"
                : recovery.primaryLabel}
          </button>
          <button
            type="button"
            className="is-quiet"
            onClick={() => void desktopClient.copyText(item.text)}
          >
            <Clipboard size={13} aria-hidden="true" />
            复制详情
          </button>
        </div>
      </div>
    </article>
  );
}

function StallRecoveryStrip({
  onKeepWaiting,
  onReconnect,
  onStop,
}: {
  onKeepWaiting: () => void;
  onReconnect: () => void;
  onStop: () => void;
}) {
  return (
    <article className="recovery-card is-stall" role="status">
      <div className="recovery-card-icon" aria-hidden="true">
        <TimerReset size={15} />
      </div>
      <div className="recovery-card-content">
        <div className="recovery-card-heading">
          <span>可能停滞</span>
          <code>3 分钟无新事件</code>
        </div>
        <strong>任务仍在运行，但暂时没有新进展</strong>
        <p>长命令可能仍在执行；也可能是连接暂时没有继续传回事件。</p>
        <div className="recovery-preservation">
          <ShieldCheck size={13} aria-hidden="true" />
          <span>已完成内容和本地文件都已保留。</span>
        </div>
        <div className="recovery-actions">
          <button type="button" onClick={onKeepWaiting}>
            继续等待
          </button>
          <button type="button" className="is-secondary" onClick={onReconnect}>
            恢复连接
          </button>
          <button type="button" className="is-quiet is-danger" onClick={onStop}>
            停止任务
          </button>
        </div>
      </div>
    </article>
  );
}

function isActivelyPending(item: TimelineItem): boolean {
  return (
    Boolean(item.pending) &&
    item.status !== "已完成" &&
    item.status !== "失败" &&
    item.status !== "已取消" &&
    item.status !== "已拒绝"
  );
}

function displayTimelineStatus(status: string): string {
  return (
    {
      completed: "已完成",
      complete: "已完成",
      running: "进行中",
      pending: "等待中",
      failed: "失败",
      cancelled: "已取消",
      canceled: "已取消",
    }[status.toLowerCase()] ?? status
  );
}

function displayTimelineTitle(item: TimelineItem, pending: boolean): string {
  if (
    item.kind === "command" ||
    item.kind === "file-change" ||
    item.kind === "tool"
  ) {
    return activityItemHeadline(item, pending);
  }
  const title = item.title ?? (item.kind === "reasoning" ? "分析" : "工具");
  if (pending || !title.startsWith("正在")) return title;
  if (item.kind === "reasoning") return "分析";
  return `已${title.slice(2)}`;
}

function readableToolOutput(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return text;
  try {
    const payload = JSON.parse(trimmed) as {
      content?: Array<{ type?: unknown; text?: unknown }>;
    };
    if (!Array.isArray(payload.content)) return text;
    const messages = payload.content
      .filter((part) => part?.type === "text" && typeof part.text === "string")
      .map((part) => String(part.text).trim())
      .filter(Boolean);
    return messages.length > 0 ? messages.join("\n\n") : text;
  } catch {
    return text;
  }
}

function DiffStatChip({
  stats,
}: {
  stats: NonNullable<TimelineItem["stats"]>;
}) {
  return (
    <div className="diff-stat-chip" aria-label="改动统计">
      {stats.files ? <span>{stats.files} 个文件</span> : null}
      {stats.added ? (
        <strong className="is-added">+{stats.added}</strong>
      ) : null}
      {stats.removed ? (
        <strong className="is-removed">-{stats.removed}</strong>
      ) : null}
    </div>
  );
}
