import {
  Check,
  ExternalLink,
  FileCheck2,
  FileMinus2,
  GitBranch,
  GitPullRequest,
  LoaderCircle,
  MessageSquarePlus,
  MessageSquareText,
  RefreshCw,
  RotateCcw,
  Send,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { desktopClient } from "../../lib/desktopClient";
import { errorMessage } from "../../lib/errors";
import { useWorkbenchStore } from "../../store/workbenchStore";
import type { GitDiff, GitState } from "../../types";
import { IconButton } from "../IconButton";
import { CustomSelect } from "../ui/CustomSelect";

interface GitHunk {
  id: string;
  header: string;
  text: string;
  patch: string;
  staged: boolean;
}

type ReviewTarget = "uncommittedChanges" | "baseBranch" | "commit" | "custom";

interface ReviewLine {
  key: string;
  text: string;
  kind: "add" | "remove" | "context" | "meta";
  oldLine: number | null;
  newLine: number | null;
  commentLine: number | null;
  side: "old" | "new" | null;
}

interface ReviewComment {
  id: string;
  path?: string;
  line?: number;
  side?: "old" | "new";
  code?: string;
  body: string;
}

function annotateReviewLines(hunk: GitHunk): ReviewLine[] {
  const header = hunk.header.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
  let oldLine = Number(header?.[1] ?? 0);
  let newLine = Number(header?.[2] ?? 0);
  return hunk.text.split("\n").map((line, index) => {
    const key = `${hunk.id}:${index}`;
    if (line.startsWith("+") && !line.startsWith("+++")) {
      const value = newLine;
      newLine += 1;
      return {
        key,
        text: line,
        kind: "add",
        oldLine: null,
        newLine: value,
        commentLine: value,
        side: "new",
      };
    }
    if (line.startsWith("-") && !line.startsWith("---")) {
      const value = oldLine;
      oldLine += 1;
      return {
        key,
        text: line,
        kind: "remove",
        oldLine: value,
        newLine: null,
        commentLine: value,
        side: "old",
      };
    }
    if (line.startsWith("\\ No newline")) {
      return {
        key,
        text: line,
        kind: "meta",
        oldLine: null,
        newLine: null,
        commentLine: null,
        side: null,
      };
    }
    const previous = oldLine;
    const next = newLine;
    oldLine += 1;
    newLine += 1;
    return {
      key,
      text: line,
      kind: "context",
      oldLine: previous,
      newLine: next,
      commentLine: next,
      side: "new",
    };
  });
}

export function GitPane() {
  const selectedThreadId = useWorkbenchStore((state) => state.selectedThreadId);
  const browser = useWorkbenchStore((state) => state.browser);
  const setToolView = useWorkbenchStore((state) => state.setToolView);
  const selectThread = useWorkbenchStore((state) => state.selectThread);
  const refreshThreads = useWorkbenchStore((state) => state.refreshThreads);
  const cwd = useWorkbenchStore((state) => {
    const thread = state.threadList.threads.find(
      (item) => item.id === state.selectedThreadId,
    );
    return thread?.cwd ?? thread?.projectPath ?? state.draftCwd ?? "";
  });
  const [git, setGit] = useState<GitState | null>(null);
  const [diff, setDiff] = useState<GitDiff | null>(null);
  const [hunks, setHunks] = useState<GitHunk[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [baseBranch, setBaseBranch] = useState("origin/main");
  const [review, setReview] = useState<Record<string, unknown> | null>(null);
  const [reviewSession, setReviewSession] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [reviewTarget, setReviewTarget] =
    useState<ReviewTarget>("uncommittedChanges");
  const [reviewValue, setReviewValue] = useState("main");
  const [reviewComment, setReviewComment] = useState("");
  const [reviewComments, setReviewComments] = useState<ReviewComment[]>([]);
  const [commentAnchor, setCommentAnchor] = useState<ReviewLine | null>(null);
  const [lineComment, setLineComment] = useState("");
  const [reviewStatus, setReviewStatus] = useState<string | null>(null);
  const [mutation, setMutation] = useState<string | null>(null);
  const [discardPath, setDiscardPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!cwd) return;
    setLoading(true);
    setError(null);
    try {
      setGit(await desktopClient.gitState(cwd));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const openDiff = async (path: string) => {
    setSelectedPath(path);
    setError(null);
    try {
      const [nextDiff, hunkResult] = await Promise.all([
        desktopClient.gitDiff(cwd, path),
        desktopClient.getGitHunks(cwd, path),
      ]);
      setDiff(nextDiff);
      setHunks(readHunks(hunkResult.hunks));
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const refreshSelected = async (path: string) => {
    const [nextDiff, hunkResult] = await Promise.all([
      desktopClient.gitDiff(cwd, path),
      desktopClient.getGitHunks(cwd, path),
    ]);
    setDiff(nextDiff);
    setHunks(readHunks(hunkResult.hunks));
  };

  const mutate = async (
    action: "stage" | "unstage" | "discard",
    paths: string[],
  ) => {
    const key = `${action}:${paths.join("|")}`;
    setMutation(key);
    setError(null);
    try {
      const next = await desktopClient.mutateGit({ cwd, action, paths });
      setGit(next);
      if (selectedPath && paths.includes(selectedPath)) {
        await refreshSelected(selectedPath);
      }
      if (action === "discard") setDiscardPath(null);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setMutation(null);
    }
  };

  const mutateHunk = async (hunk: GitHunk) => {
    if (!selectedPath) return;
    const action = hunk.staged ? "unstage" : "stage";
    setMutation(`${action}:${hunk.id}`);
    setError(null);
    try {
      const next = await desktopClient.mutateGitHunk({
        cwd,
        path: selectedPath,
        action,
        patch: hunk.patch,
      });
      setGit(next);
      await refreshSelected(selectedPath);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setMutation(null);
    }
  };

  const preparePullRequest = async () => {
    setMutation("prepare-pr");
    setError(null);
    try {
      const value = await desktopClient.preparePullRequest(cwd, baseBranch);
      setReview(value);
      const url = text(value.url);
      if (!url) throw new Error("后端没有返回 Pull Request 地址");
      setToolView("browser");
      const activeRoute =
        browser?.tabs.find((tab) => tab.routeId === browser.activeRouteId) ??
        browser?.tabs.at(0);
      const routeId =
        activeRoute?.routeId ??
        `route-pr-${(selectedThreadId ?? "main").replace(/[^a-zA-Z0-9_.-]/g, "")}`;
      if (activeRoute) {
        await desktopClient.navigate(url, routeId);
      } else {
        await desktopClient.browserCommand({
          command: "createRoute",
          payload: {
            routeId,
            threadId: selectedThreadId ?? "main",
            url,
          },
        });
      }
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setMutation(null);
    }
  };

  const beginReview = async () => {
    setMutation("start-review");
    setError(null);
    setReviewStatus(null);
    try {
      const value = await desktopClient.startReview({
        threadId: selectedThreadId,
        cwd,
        targetType: reviewTarget,
        value:
          reviewTarget === "uncommittedChanges"
            ? null
            : reviewValue.trim() || null,
      });
      setReviewSession(value);
      setReviewStatus("Codex 代码审阅已开始");
      await refreshThreads();
      const threadId = text(value.threadId);
      if (threadId) await selectThread(threadId);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setMutation(null);
    }
  };

  const saveLineComment = () => {
    const commentLine = commentAnchor?.commentLine;
    const side = commentAnchor?.side;
    if (!selectedPath || !commentLine || !side || !commentAnchor) return;
    const body = lineComment.trim();
    if (!body) return;
    const id = `${selectedPath}:${side}:${commentLine}`;
    setReviewComments((items) => [
      ...items.filter((item) => item.id !== id),
      {
        id,
        path: selectedPath,
        line: commentLine,
        side,
        code: commentAnchor.text,
        body,
      },
    ]);
    setLineComment("");
    setCommentAnchor(null);
  };

  const submitReviewComments = async () => {
    const pending = reviewComment.trim()
      ? [
          ...reviewComments,
          { id: `general-${crypto.randomUUID()}`, body: reviewComment.trim() },
        ]
      : reviewComments;
    if (pending.length === 0) return;
    setMutation("submit-review");
    setError(null);
    setReviewStatus(null);
    try {
      const value = await desktopClient.submitReviewComments({
        threadId:
          text(reviewSession?.threadId) || selectedThreadId || undefined,
        cwd,
        comments: pending.map((comment) => ({
          path: comment.path,
          line: comment.line,
          side: comment.side,
          code: comment.code,
          body: comment.body,
        })),
      });
      setReviewComment("");
      setReviewComments([]);
      setReviewStatus("审阅意见已发送给 Codex 处理");
      await refreshThreads();
      const threadId = text(value.threadId);
      if (threadId) await selectThread(threadId);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setMutation(null);
    }
  };

  const stagedPaths =
    git?.files
      .filter((file) => file.indexStatus.trim() && file.indexStatus !== "?")
      .map((file) => file.path) ?? [];
  const unstagedPaths =
    git?.files
      .filter((file) => file.untracked || Boolean(file.worktreeStatus.trim()))
      .map((file) => file.path) ?? [];

  return (
    <div className="git-pane">
      <div className="tool-toolbar">
        <div className="branch-label">
          <GitBranch size={14} />
          {git?.branch ?? "No repository"}
        </div>
        <span className="tool-spacer" />
        <IconButton
          icon={RefreshCw}
          label="刷新 Git"
          onClick={() => void refresh()}
        />
        <IconButton
          icon={Upload}
          label="推送"
          disabled={!git?.repository || mutation !== null}
          onClick={() => {
            setMutation("push");
            setError(null);
            void desktopClient
              .pushGit(cwd)
              .then(setGit)
              .catch((cause) => setError(errorMessage(cause)))
              .finally(() => setMutation(null));
          }}
        />
        <IconButton
          icon={GitPullRequest}
          label="准备拉取请求"
          disabled={!git?.repository || mutation !== null}
          onClick={() => void preparePullRequest()}
        />
      </div>
      {error ? <div className="tool-error">{error}</div> : null}
      {loading ? (
        <div className="tool-loading">
          <LoaderCircle className="spin" size={16} />
          读取 Git 状态
        </div>
      ) : null}
      {!loading && git?.repository ? (
        <div className="git-body">
          <div className="git-file-list">
            <div className="tool-section-heading">
              <span>
                更改 <em>{git.files.length}</em>
              </span>
              <span className="git-bulk-actions">
                <button
                  type="button"
                  disabled={unstagedPaths.length === 0 || mutation !== null}
                  onClick={() => void mutate("stage", unstagedPaths)}
                >
                  全部暂存
                </button>
                <button
                  type="button"
                  disabled={stagedPaths.length === 0 || mutation !== null}
                  onClick={() => void mutate("unstage", stagedPaths)}
                >
                  全部取消
                </button>
              </span>
            </div>
            {git.files.length === 0 ? (
              <p className="git-clean-state">工作树没有更改。</p>
            ) : null}
            {git.files.map((file) => {
              const staged =
                Boolean(file.indexStatus.trim()) && file.indexStatus !== "?";
              const unstaged =
                file.untracked || Boolean(file.worktreeStatus.trim());
              const canDiscard =
                !file.untracked && Boolean(file.worktreeStatus.trim());
              return (
                <div
                  className={`git-file-row ${selectedPath === file.path ? "is-active" : ""}`}
                  key={file.path}
                >
                  <button
                    className="git-file-main"
                    type="button"
                    onClick={() => void openDiff(file.path)}
                  >
                    <span className="git-status-code">
                      {file.untracked
                        ? "U"
                        : `${file.indexStatus}${file.worktreeStatus}`.trim()}
                    </span>
                    <span>{file.path}</span>
                  </button>
                  <span className="git-file-actions">
                    {unstaged ? (
                      <button
                        type="button"
                        title="暂存"
                        aria-label={`暂存 ${file.path}`}
                        disabled={mutation !== null}
                        onClick={() => void mutate("stage", [file.path])}
                      >
                        <FileCheck2 size={12} />
                      </button>
                    ) : null}
                    {staged ? (
                      <button
                        type="button"
                        title="取消暂存"
                        aria-label={`取消暂存 ${file.path}`}
                        disabled={mutation !== null}
                        onClick={() => void mutate("unstage", [file.path])}
                      >
                        <FileMinus2 size={12} />
                      </button>
                    ) : null}
                    {canDiscard ? (
                      discardPath === file.path ? (
                        <span className="git-discard-confirm">
                          <button
                            type="button"
                            onClick={() => setDiscardPath(null)}
                          >
                            取消
                          </button>
                          <button
                            className="is-danger"
                            type="button"
                            disabled={mutation !== null}
                            onClick={() => void mutate("discard", [file.path])}
                          >
                            丢弃
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          title="丢弃更改"
                          aria-label={`丢弃 ${file.path} 的更改`}
                          onClick={() => setDiscardPath(file.path)}
                        >
                          <RotateCcw size={12} />
                        </button>
                      )
                    ) : null}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="git-diff-panel">
            {selectedPath ? (
              <div className="git-diff-heading">
                <span title={selectedPath}>{selectedPath}</span>
                <small>
                  {hunks.filter((hunk) => hunk.staged).length} 已暂存 ·{" "}
                  {hunks.filter((hunk) => !hunk.staged).length} 未暂存
                </small>
              </div>
            ) : null}
            {hunks.length > 0 ? (
              <div className="git-hunk-list">
                {hunks.map((hunk) => (
                  <section
                    className={`git-hunk ${hunk.staged ? "is-staged" : ""}`}
                    key={hunk.id}
                  >
                    <header>
                      <span>{hunk.header}</span>
                      <em>{hunk.staged ? "已暂存" : "未暂存"}</em>
                      <button
                        type="button"
                        disabled={mutation !== null}
                        onClick={() => void mutateHunk(hunk)}
                      >
                        {hunk.staged ? (
                          <FileMinus2 size={12} />
                        ) : (
                          <FileCheck2 size={12} />
                        )}
                        {hunk.staged ? "取消暂存" : "暂存此块"}
                      </button>
                    </header>
                    <div className="git-hunk-lines">
                      {annotateReviewLines(hunk).map((line) => {
                        const comment = reviewComments.find(
                          (item) =>
                            item.path === selectedPath &&
                            item.line === line.commentLine &&
                            item.side === line.side,
                        );
                        return (
                          <div
                            className={`git-review-line is-${line.kind} ${comment ? "has-comment" : ""}`}
                            key={line.key}
                          >
                            <button
                              type="button"
                              className="git-line-comment-trigger"
                              aria-label={
                                line.commentLine && selectedPath
                                  ? `评论 ${selectedPath}:${line.commentLine}`
                                  : "此行不可评论"
                              }
                              disabled={!line.commentLine}
                              onClick={() => {
                                setCommentAnchor(line);
                                setLineComment(comment?.body ?? "");
                              }}
                            >
                              <MessageSquarePlus size={11} />
                            </button>
                            <span className="git-old-line">
                              {line.oldLine ?? ""}
                            </span>
                            <span className="git-new-line">
                              {line.newLine ?? ""}
                            </span>
                            <code>{line.text || " "}</code>
                            {comment ? (
                              <span
                                className="git-line-comment-dot"
                                title={comment.body}
                              />
                            ) : null}
                            {commentAnchor?.key === line.key ? (
                              <form
                                className="git-inline-comment-editor"
                                onSubmit={(event) => {
                                  event.preventDefault();
                                  saveLineComment();
                                }}
                              >
                                <textarea
                                  autoFocus
                                  value={lineComment}
                                  onChange={(event) =>
                                    setLineComment(event.target.value)
                                  }
                                  placeholder={`评论 ${selectedPath}:${line.commentLine}`}
                                  aria-label={`输入 ${selectedPath}:${line.commentLine} 的审阅意见`}
                                />
                                <div>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setCommentAnchor(null);
                                      setLineComment("");
                                    }}
                                  >
                                    取消
                                  </button>
                                  <button
                                    type="submit"
                                    disabled={!lineComment.trim()}
                                  >
                                    添加意见
                                  </button>
                                </div>
                              </form>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            ) : (
              <pre className="git-diff">{diff?.text || "选择文件查看差异"}</pre>
            )}
          </div>
        </div>
      ) : null}
      {!loading && git && !git.repository ? (
        <div className="git-empty-repository">
          <GitBranch size={20} />
          <strong>当前目录不是 Git 仓库</strong>
          <button
            type="button"
            disabled={!cwd || mutation !== null}
            onClick={() => {
              setMutation("init");
              void desktopClient
                .initGitRepository(cwd)
                .then(setGit)
                .catch((cause) => setError(errorMessage(cause)))
                .finally(() => setMutation(null));
            }}
          >
            初始化 Git 仓库
          </button>
        </div>
      ) : null}
      {git?.repository ? (
        <div className="git-footer-stack">
          <section className="git-review-workflow">
            <header>
              <span>
                <MessageSquareText size={14} />
                Codex 代码审阅
              </span>
              {reviewSession ? <em>任务已创建</em> : null}
            </header>
            <form
              className="git-review-launch"
              onSubmit={(event) => {
                event.preventDefault();
                void beginReview();
              }}
            >
              <CustomSelect
                value={reviewTarget}
                ariaLabel="代码审阅目标"
                options={[
                  { value: "uncommittedChanges", label: "未提交的更改" },
                  { value: "baseBranch", label: "与基础分支比较" },
                  { value: "commit", label: "指定提交" },
                  { value: "custom", label: "自定义审阅要求" },
                ]}
                onChange={(target) => setReviewTarget(target as ReviewTarget)}
              />
              {reviewTarget !== "uncommittedChanges" ? (
                <input
                  value={reviewValue}
                  onChange={(event) => setReviewValue(event.target.value)}
                  aria-label="代码审阅目标值"
                  placeholder={
                    reviewTarget === "baseBranch"
                      ? "main"
                      : reviewTarget === "commit"
                        ? "HEAD"
                        : "说明需要重点检查的内容"
                  }
                />
              ) : (
                <span className="git-review-target-note">
                  检查工作区内尚未提交的代码
                </span>
              )}
              <button type="submit" disabled={mutation !== null}>
                {mutation === "start-review" ? (
                  <LoaderCircle className="spin" size={12} />
                ) : (
                  <MessageSquareText size={12} />
                )}
                开始审阅
              </button>
            </form>
            {reviewComments.length > 0 ? (
              <div className="git-review-comment-list">
                {reviewComments.map((comment) => (
                  <span key={comment.id}>
                    <small>
                      {comment.path && comment.line
                        ? `${comment.path}:${comment.line}`
                        : "一般意见"}
                    </small>
                    {comment.body}
                    <button
                      type="button"
                      aria-label={`删除审阅意见 ${comment.body}`}
                      onClick={() =>
                        setReviewComments((items) =>
                          items.filter((item) => item.id !== comment.id),
                        )
                      }
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            <form
              className="git-review-comment"
              onSubmit={(event) => {
                event.preventDefault();
                void submitReviewComments();
              }}
            >
              <input
                value={reviewComment}
                onChange={(event) => setReviewComment(event.target.value)}
                placeholder="补充一般审阅意见；也可点击差异行添加行级评论"
                aria-label="代码审阅意见"
              />
              <button
                type="submit"
                aria-label="发送审阅意见给 Codex"
                disabled={
                  (!reviewComment.trim() && reviewComments.length === 0) ||
                  mutation !== null
                }
              >
                <Send size={12} />
                发送
                {reviewComments.length > 0 ? ` ${reviewComments.length}` : ""}
              </button>
            </form>
            {reviewStatus ? <p>{reviewStatus}</p> : null}
          </section>
          {review ? (
            <section className="git-pr-preview">
              <div className="git-pr-summary">
                <div>
                  <GitPullRequest size={14} />
                  <span>
                    <strong>{text(review.title, "准备拉取请求")}</strong>
                    <small>
                      {text(review.branch, git.branch ?? "HEAD")} →{" "}
                      {text(review.base, baseBranch)}
                    </small>
                  </span>
                </div>
                <span className="git-pr-actions">
                  <button
                    type="button"
                    disabled={!text(review.url) || mutation !== null}
                    onClick={() => void preparePullRequest()}
                  >
                    <ExternalLink size={12} />
                    在浏览器中打开
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setReview(null);
                      setReviewSession(null);
                      setReviewStatus(null);
                    }}
                  >
                    关闭
                  </button>
                </span>
              </div>
              {text(review.diff) ? (
                <details>
                  <summary>查看拉取请求差异</summary>
                  <pre>{text(review.diff)}</pre>
                </details>
              ) : null}
            </section>
          ) : null}
          <form
            className="git-pr-base"
            onSubmit={(event) => {
              event.preventDefault();
              void preparePullRequest();
            }}
          >
            <GitPullRequest size={14} />
            <input
              value={baseBranch}
              onChange={(event) => setBaseBranch(event.target.value)}
              aria-label="拉取请求基线"
              placeholder="origin/main"
            />
            <button
              type="submit"
              disabled={!baseBranch.trim() || mutation !== null}
            >
              <ExternalLink size={12} />
              创建 PR
            </button>
          </form>
          <form
            className="git-commit"
            onSubmit={(event) => {
              event.preventDefault();
              if (!message.trim() || stagedPaths.length === 0) return;
              setMutation("commit");
              void desktopClient
                .commitGit(cwd, message)
                .then((value) => {
                  setGit(value);
                  setMessage("");
                })
                .catch((cause) => setError(errorMessage(cause)))
                .finally(() => setMutation(null));
            }}
          >
            <input
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder={
                stagedPaths.length > 0
                  ? `提交 ${stagedPaths.length} 个暂存文件`
                  : "先暂存要提交的文件"
              }
              aria-label="提交信息"
            />
            <button
              type="submit"
              disabled={
                !message.trim() || stagedPaths.length === 0 || mutation !== null
              }
            >
              <Check size={14} />
              提交
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function readHunks(value: unknown): GitHunk[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index) => {
    if (typeof entry !== "object" || entry === null) return [];
    const hunk = entry as Record<string, unknown>;
    const patch = text(hunk.patch);
    const header = text(hunk.header);
    if (!patch || !header) return [];
    return [
      {
        id: text(hunk.id, `hunk-${index}`),
        header,
        text: text(hunk.text),
        patch,
        staged: hunk.staged === true,
      },
    ];
  });
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value ? value : fallback;
}
