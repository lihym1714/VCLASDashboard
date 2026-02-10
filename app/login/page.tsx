"use client";

import { useEffect, useMemo, useState } from "react";

import { useUiPrefs } from "../_lib/uiPrefs";

type SessionGetResponse = {
  userId: string;
};

type SessionPostResponse = {
  ok?: boolean;
  userId?: string;
  error?: string;
};

function sanitizeUserId(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (value.length > 64) return null;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._@-]*$/.test(value)) return null;
  return value;
}

export default function LoginPage() {
  const { lang } = useUiPrefs();
  const [status, setStatus] = useState<"idle" | "loading" | "saving" | "error" | "done">(
    "idle"
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<string>("");
  const [userId, setUserId] = useState<string>("");
  const [rememberDays, setRememberDays] = useState<number>(30);

  const nextPath = useMemo(() => {
    if (typeof window === "undefined") return "/history";
    const url = new URL(window.location.href);
    const next = (url.searchParams.get("next") || "").trim();
    if (!next) return "/history";
    if (!next.startsWith("/")) return "/history";
    return next;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setStatus("loading");
      setErrorMessage(null);
      try {
        const res = await fetch("/api/session", { method: "GET" });
        const data = (await res.json()) as SessionGetResponse;
        if (cancelled) return;
        const id = data?.userId || "";
        setCurrentUser(id);
        setUserId(id === "guest" || id.startsWith("guest-") ? "" : id);
        setStatus("idle");
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        setErrorMessage(err instanceof Error ? err.message : "Unexpected error");
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus("saving");
    setErrorMessage(null);

    const sanitized = sanitizeUserId(userId);
    if (!sanitized) {
      setStatus("error");
      setErrorMessage(
        lang === "ko"
          ? "허용되지 않는 사용자 ID입니다. (영문/숫자/._@- 만, 최대 64자)"
          : "Invalid user ID. (letters/numbers/._@- only, max 64 chars)"
      );
      return;
    }

    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: sanitized, days: rememberDays }),
      });
      const data = (await res.json()) as SessionPostResponse;
      if (!res.ok || data.error) {
        setStatus("error");
        setErrorMessage(data.error || "Failed");
        return;
      }

      setStatus("done");
      // Force reload so all pages pick up the new cookie consistently.
      window.location.href = nextPath;
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "Unexpected error");
    }
  };

  const logout = async () => {
    setStatus("saving");
    setErrorMessage(null);
    try {
      await fetch("/api/session", { method: "DELETE" });
      window.location.href = nextPath;
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "Unexpected error");
    }
  };

  return (
    <main>
      <header>
        <div className="title-block">
          <h1>{lang === "ko" ? "사용자 설정" : "User Login"}</h1>
          <p>
            {lang === "ko"
              ? "내부망용 간단 사용자 구분입니다. 사용자 ID만 설정하면 기록이 분리됩니다."
              : "Simple internal user separation. Set a user ID to keep history separated."}
          </p>
        </div>
        <div className="status-pill">
          {lang === "ko" ? "현재" : "Current"}: {currentUser || "-"}
        </div>
      </header>

      <section className="grid">
        <div className="card">
          <h2>{lang === "ko" ? "로그인" : "Login"}</h2>
          <form onSubmit={submit}>
            <label>
              {lang === "ko" ? "사용자 ID" : "User ID"}
              <input
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                placeholder={lang === "ko" ? "예: alice" : "e.g. alice"}
                autoComplete="username"
                required
              />
            </label>

            <label>
              {lang === "ko" ? "저장 기간" : "Remember"}
              <select
                value={String(rememberDays)}
                onChange={(e) => setRememberDays(Number(e.target.value))}
              >
                <option value="1">{lang === "ko" ? "1일" : "1 day"}</option>
                <option value="7">{lang === "ko" ? "7일" : "7 days"}</option>
                <option value="30">{lang === "ko" ? "30일" : "30 days"}</option>
                <option value="365">{lang === "ko" ? "365일" : "365 days"}</option>
              </select>
            </label>

            <div className="inline">
              <button className="btn" type="submit" disabled={status === "saving"}>
                {lang === "ko" ? "설정" : "Set"}
              </button>
              <button
                className="btn"
                type="button"
                onClick={logout}
                disabled={status === "saving"}
                style={{ background: "transparent", color: "var(--ink)", border: "1px solid var(--border)" }}
              >
                {lang === "ko" ? "로그아웃" : "Clear"}
              </button>
              {errorMessage ? <span className="tag error">{errorMessage}</span> : null}
            </div>
          </form>
        </div>

        <div className="card">
          <h2>{lang === "ko" ? "가이드" : "Notes"}</h2>
          <p className="muted">
            {lang === "ko"
              ? "형식: 영문/숫자/._@- 만 허용, 최대 64자."
              : "Format: letters/numbers/._@- only, max 64 chars."}
          </p>
          <p className="muted">
            {lang === "ko"
              ? "현재 단계에서는 비밀번호 없이 구분만 합니다."
              : "At this stage this is identification only (no password)."}
          </p>
          <p className="muted">
            {lang === "ko"
              ? "설정 후에는 /history에서 사용자별 기록이 분리됩니다."
              : "After setting, /history will show only your records."}
          </p>
        </div>
      </section>
    </main>
  );
}
