"use client";

import { useMemo, useState } from "react";

import { AutoSizeTextarea } from "../../_components/AutoSizeTextarea";
import { useUiPrefs } from "../../_lib/uiPrefs";

type CookieItem = {
  name: string;
  value: string | null;
  raw_header: string;
};

type ApiResponse = {
  log: string;
  cookies: CookieItem[];
  mfaDetected: boolean;
  rawJson: string;
  error?: string;
};

export default function CookieScanPage() {
  const { lang, t } = useUiPrefs();
  const [url, setUrl] = useState("");
  const [timeout, setTimeoutValue] = useState(5);
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">(
    "idle"
  );
  const [result, setResult] = useState<ApiResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const cookieNames = useMemo(() => {
    if (!result?.cookies?.length) return [] as string[];
    const names = result.cookies.map((c) => c.name).filter(Boolean);
    return Array.from(new Set(names));
  }, [result]);

  const run = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus("running");
    setErrorMessage(null);
    setResult(null);

    try {
      const res = await fetch("/api/vulnchecklist/cookie-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, timeout }),
      });
      const data = (await res.json()) as ApiResponse;
      if (!res.ok || data.error) {
        setStatus("error");
        setErrorMessage(data.error || t.failed);
        setResult(data);
        return;
      }
      setResult(data);
      setStatus("done");
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : t.unexpectedError);
    }
  };

  return (
    <main>
      <header>
        <div className="title-block">
          <h1>{lang === "ko" ? "쿠키 & MFA" : "Cookie & MFA"}</h1>
          <p>
            {lang === "ko"
              ? "응답 헤더에서 쿠키를 추출하고 MFA 키워드를 기반으로 추정합니다."
              : "Extracts cookies from response headers and estimates MFA by keyword heuristics."}
          </p>
        </div>
        <div className="status-pill">
          {t.status}: {status}
        </div>
      </header>

      <section className="grid">
        <div className="card">
          <h2>{t.input}</h2>
          <form onSubmit={run}>
            <label>
              {lang === "ko" ? "대상 URL" : "Target URL"}
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/login"
                required
              />
            </label>
            <label>
              {lang === "ko" ? "타임아웃(초)" : "Timeout (seconds)"}
              <input
                type="number"
                min={1}
                max={60}
                value={timeout}
                onChange={(e) => setTimeoutValue(Number(e.target.value))}
              />
            </label>
            <div className="inline">
              <button className="btn" type="submit" disabled={status === "running"}>
                {status === "running" ? t.running : t.run}
              </button>
              {errorMessage ? <span className="tag error">{errorMessage}</span> : null}
            </div>
          </form>
        </div>

        <div className="card panel-stack">
          <div>
            <h2>{lang === "ko" ? "요약" : "Summary"}</h2>
            <ul className="result-list">
              <li>
                {lang === "ko" ? "쿠키 개수" : "Cookies"}: {result?.cookies?.length ?? 0}
              </li>
              <li>
                {lang === "ko" ? "MFA 추정" : "MFA"}: {result ? (result.mfaDetected ? "true" : "false") : "-"}
              </li>
            </ul>
          </div>
          <div>
            <h2>{lang === "ko" ? "쿠키 이름" : "Cookie Names"}</h2>
            {cookieNames.length ? (
              <ul className="result-list">
                {cookieNames.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
            ) : (
              <p className="muted">{t.noResultsYet}</p>
            )}
          </div>
        </div>
      </section>

      <section className="grid" style={{ marginTop: 24 }}>
        <div className="card">
          <h2>{t.log}</h2>
          <AutoSizeTextarea readOnly value={result?.log || ""} placeholder="" />
        </div>
        <div className="card">
          <h2>{lang === "ko" ? "원본 JSON" : "Raw JSON"}</h2>
          <AutoSizeTextarea readOnly value={result?.rawJson || ""} placeholder="" />
        </div>
      </section>
    </main>
  );
}
