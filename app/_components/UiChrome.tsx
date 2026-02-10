"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { useUiPrefs } from "../_lib/uiPrefs";

const USER_COOKIE = "vcld_user";

function getCookieValue(name: string): string | null {
  if (typeof document === "undefined") return null;
  const parts = document.cookie.split(";").map((part) => part.trim());
  for (const part of parts) {
    if (!part) continue;
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx);
    if (key !== name) continue;
    const raw = part.slice(idx + 1);
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

function setCookieValue(name: string, value: string, days: number) {
  if (typeof document === "undefined") return;
  const maxAgeSeconds = Math.max(0, Math.floor(days * 24 * 60 * 60));
  const encoded = encodeURIComponent(value);
  document.cookie = `${name}=${encoded}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax`;
}

function sanitizeUserId(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (value.length > 64) return null;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._@-]*$/.test(value)) return null;
  return value;
}

function generateGuestId(): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `guest-${suffix}`;
}

function sendAudit(payload: Record<string, unknown>) {
  fetch("/api/audit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch((err) => {
    // Best-effort audit beacon. Never block UI on failures.
    console.warn("[audit] beacon failed", err);
  });
}

export default function UiChrome() {
  const pathname = usePathname();
  const { lang, theme, t, switchLang, toggleTheme } = useUiPrefs();

  const isDashboard = pathname === "/";
  const isTools = pathname?.startsWith("/tools") ?? false;
  const isHistory = pathname?.startsWith("/history") ?? false;

  const [userId, setUserId] = useState<string>("");

  const userLabel = useMemo(() => {
    if (!userId) return lang === "ko" ? "사용자 미설정" : "No user";
    return userId;
  }, [lang, userId]);

  const loginHref = useMemo(() => {
    const next = pathname || "/";
    return `/login?next=${encodeURIComponent(next)}`;
  }, [pathname]);

  useEffect(() => {
    const existing = getCookieValue(USER_COOKIE);
    const sanitized = existing ? sanitizeUserId(existing) : null;
    if (sanitized) {
      setUserId(sanitized);
      return;
    }

    const generated = generateGuestId();
    setCookieValue(USER_COOKIE, generated, 30);
    setUserId(generated);
  }, []);

  useEffect(() => {
    if (!userId) return;
    if (!pathname) return;
    sendAudit({ type: "page_view", path: pathname });
  }, [pathname, userId]);

  return (
    <>
      <div className="lang-switch" role="group" aria-label="Language">
        <button
          type="button"
          className={lang === "ko" ? "lang-btn active" : "lang-btn"}
          onClick={() => switchLang("ko")}
        >
          {t.langKo}
        </button>
        <button
          type="button"
          className={lang === "en" ? "lang-btn active" : "lang-btn"}
          onClick={() => switchLang("en")}
        >
          {t.langEn}
        </button>
      </div>

      <div className="theme-switch">
        <button type="button" className="theme-btn" onClick={toggleTheme}>
          {theme === "dark" ? t.themeLight : t.themeDark}
        </button>
      </div>

      <div className="nav-fab">
        <div className="nav-group" role="navigation" aria-label="Navigation">
          {isDashboard ? null : (
            <Link className="nav-btn" href="/">
              {t.navDashboard}
            </Link>
          )}

          {isTools ? null : (
            <Link className="nav-btn" href="/tools">
              {t.navTools}
            </Link>
          )}

          {isHistory ? null : (
            <Link className="nav-btn" href="/history">
              {lang === "ko" ? "기록" : "History"}
            </Link>
          )}
        </div>
      </div>

      <div className="user-switch">
        <Link className="user-btn" href={loginHref}>
          {lang === "ko" ? "사용자" : "User"}: {userLabel}
        </Link>
      </div>
    </>
  );
}
