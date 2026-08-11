import { ArrowRight, Check, LoaderCircle, Mail, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { desktopClient } from "../lib/desktopClient";
import { isCloudAccountState } from "../lib/cloudAccount";
import { errorMessage } from "../lib/errors";
import type { CloudAccountState } from "../types";

type AuthMode = "login" | "register";

export function AccountAuthPopover({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: (state: CloudAccountState) => void;
}) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"submit" | "code" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const appRoot = document.getElementById("root");
    const rootWasInert = appRoot?.hasAttribute("inert") ?? false;

    document.body.classList.add("account-auth-open");
    appRoot?.setAttribute("inert", "");

    return () => {
      document.body.classList.remove("account-auth-open");
      if (!rootWasInert) appRoot?.removeAttribute("inert");
    };
  }, []);

  const submit = async () => {
    if (!email.trim() || !password || (mode === "register" && !code.trim())) {
      setError(
        mode === "login" ? "请输入邮箱和密码" : "请填写邮箱、密码和验证码",
      );
      return;
    }
    setBusy("submit");
    setMessage(null);
    setError(null);
    try {
      const response =
        mode === "login"
          ? await desktopClient.loginCloudAccount({
              email: email.trim(),
              password,
            })
          : await desktopClient.registerCloudAccount({
              email: email.trim(),
              password,
              code: code.trim(),
            });
      let state = isCloudAccountState(response) ? response : null;
      try {
        const authoritative = await desktopClient.getCloudAccount();
        if (isCloudAccountState(authoritative)) state = authoritative;
      } catch {
        // The successful login response is a safe fallback when the immediate
        // authoritative re-read is temporarily unavailable.
      }
      if (!state) {
        throw new Error("登录成功，但账户状态尚未同步，请稍后重试");
      }
      onSuccess(state);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  };

  const sendCode = async () => {
    if (!email.trim()) {
      setError("请先输入邮箱");
      return;
    }
    setBusy("code");
    setMessage(null);
    setError(null);
    try {
      await desktopClient.sendCloudRegistrationCode({ email: email.trim() });
      setMessage("验证码已发送，请检查邮箱");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  };

  const changeMode = (next: AuthMode) => {
    setMode(next);
    setError(null);
    setMessage(null);
  };

  return createPortal(
    <div className="account-auth-layer" onPointerDown={onClose}>
      <div
        className="account-auth-popover"
        role="dialog"
        aria-label="登录或注册 OnPeople"
        aria-modal="true"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="account-auth-heading">
          <div>
            <strong>进入 OnPeople</strong>
            <span>登录后自动同步模型和 Sub2API Key</span>
          </div>
          <button
            className="account-auth-close"
            type="button"
            aria-label="关闭登录面板"
            onClick={onClose}
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>

        <div className="account-auth-tabs" role="tablist" aria-label="账户操作">
          <button
            className={mode === "login" ? "is-active" : ""}
            type="button"
            role="tab"
            aria-selected={mode === "login"}
            onClick={() => changeMode("login")}
          >
            登录
          </button>
          <button
            className={mode === "register" ? "is-active" : ""}
            type="button"
            role="tab"
            aria-selected={mode === "register"}
            onClick={() => changeMode("register")}
          >
            注册
          </button>
        </div>

        <label className="account-auth-field">
          <span>邮箱</span>
          <span className="account-auth-input-wrap">
            <Mail size={13} aria-hidden="true" />
            <input
              autoFocus
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </span>
        </label>

        <label className="account-auth-field">
          <span>密码</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="输入密码"
            autoComplete={
              mode === "login" ? "current-password" : "new-password"
            }
            onKeyDown={(event) => {
              if (event.key === "Enter" && mode === "login") void submit();
            }}
          />
        </label>

        {mode === "register" ? (
          <label className="account-auth-field">
            <span>验证码</span>
            <span className="account-auth-code-row">
              <input
                type="text"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="邮箱验证码"
                autoComplete="one-time-code"
              />
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void sendCode()}
              >
                {busy === "code" ? "发送中…" : "发送验证码"}
              </button>
            </span>
          </label>
        ) : null}

        {error ? (
          <p className="account-auth-message is-error">{error}</p>
        ) : null}
        {message ? (
          <p className="account-auth-message is-success">
            <Check size={13} aria-hidden="true" />
            {message}
          </p>
        ) : null}

        <button
          className="account-auth-submit"
          type="button"
          disabled={busy !== null}
          onClick={() => void submit()}
        >
          {busy === "submit" ? (
            <LoaderCircle
              className="is-spinning"
              size={14}
              aria-hidden="true"
            />
          ) : (
            <ArrowRight size={14} aria-hidden="true" />
          )}
          {busy === "submit"
            ? mode === "login"
              ? "登录中…"
              : "注册中…"
            : mode === "login"
              ? "登录"
              : "注册并登录"}
        </button>

        <p className="account-auth-footnote">
          {mode === "login"
            ? "还没有 OnPeople 账户？点击上方“注册”。"
            : "已有账户？点击上方“登录”。"}
        </p>
      </div>
    </div>,
    document.body,
  );
}
