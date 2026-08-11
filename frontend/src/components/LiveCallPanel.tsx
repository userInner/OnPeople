import {
  CheckCircle2,
  CircleAlert,
  LoaderCircle,
  Mic,
  MicOff,
  PhoneOff,
  Radio,
  Square,
} from "lucide-react";

import {
  isActiveLiveDelegation,
  liveDelegationStateLabel,
} from "../lib/liveDelegation";
import type { LiveConversationController } from "./LiveConversation";

export function LiveCallPanel({
  active,
  busy,
  muted,
  durationSeconds,
  view,
  entries,
  delegations,
  audioRef,
  end,
  toggleMute,
  cancelDelegation,
  openDelegation,
}: LiveConversationController) {
  if (!view.visible) return null;
  return (
    <section
      className={`live-call-panel is-${view.phase}`}
      aria-label="GPT-Live 实时语音"
      aria-live="polite"
    >
      <audio ref={audioRef} autoPlay playsInline preload="auto" />
      <div className="live-call-signal" aria-hidden="true">
        <Radio size={15} />
        <i />
        <i />
        <i />
      </div>
      <div className="live-call-copy">
        <div>
          <strong>{view.title}</strong>
          {(active || busy) && <time>{formatDuration(durationSeconds)}</time>}
        </div>
        <small>{view.status}</small>
        <p>{view.transcript}</p>
        {entries.length > 1 ? (
          <div className="live-transcript-history">
            {entries.slice(-3).map((entry) => (
              <span key={entry.id}>
                <b>{entry.role === "user" ? "你" : "OnPeople"}</b>
                {entry.text}
              </span>
            ))}
          </div>
        ) : null}
        {delegations.length > 0 ? (
          <div className="live-delegation-list" aria-label="Live 后台任务">
            <div className="live-delegation-heading">
              <b>后台任务</b>
              <span>
                {delegations.filter(isActiveLiveDelegation).length > 0
                  ? `${delegations.filter(isActiveLiveDelegation).length} 个正在执行`
                  : "暂无运行任务"}
              </span>
            </div>
            {[...delegations]
              .sort((left, right) => right.updatedAt - left.updatedAt)
              .slice(0, 4)
              .map((task) => {
                const activeTask = isActiveLiveDelegation(task);
                return (
                  <div
                    className={`live-delegation-item is-${task.state}`}
                    key={task.id}
                  >
                    <button
                      type="button"
                      className="live-delegation-open"
                      disabled={!task.threadId}
                      onClick={() => void openDelegation(task.id)}
                    >
                      <span aria-hidden="true">
                        {activeTask ? (
                          <LoaderCircle className="spin" size={11} />
                        ) : task.state === "completed" ? (
                          <CheckCircle2 size={11} />
                        ) : (
                          <CircleAlert size={11} />
                        )}
                      </span>
                      <span className="live-delegation-copy">
                        <b>{task.text}</b>
                        <small>
                          {task.detail || liveDelegationStateLabel(task.state)}
                        </small>
                      </span>
                      <small className="live-delegation-state">
                        {task.threadId && activeTask
                          ? `已启动 · ${liveDelegationStateLabel(task.state)}`
                          : liveDelegationStateLabel(task.state)}
                      </small>
                    </button>
                    {activeTask ? (
                      <button
                        type="button"
                        className="live-delegation-cancel"
                        aria-label={`取消后台任务：${task.text}`}
                        onClick={() => void cancelDelegation(task.id)}
                      >
                        <Square size={9} fill="currentColor" />
                      </button>
                    ) : null}
                  </div>
                );
              })}
          </div>
        ) : null}
      </div>
      <div className="live-call-actions">
        <button
          type="button"
          className={muted ? "is-active" : ""}
          disabled={!active}
          aria-label={muted ? "取消麦克风静音" : "静音麦克风"}
          aria-pressed={muted}
          onClick={toggleMute}
        >
          {muted ? <MicOff size={14} /> : <Mic size={14} />}
        </button>
        <button
          type="button"
          className="is-end"
          disabled={!active && !busy}
          aria-label="结束实时语音"
          onClick={() => void end()}
        >
          <PhoneOff size={14} />
        </button>
      </div>
    </section>
  );
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
