"use client";

import { useState } from "react";

import { AutoSizeTextarea } from "../../_components/AutoSizeTextarea";
import { useUiPrefs } from "../../_lib/uiPrefs";

type ApiResponse = {
  log: string;
  subdomains: string[];
  error?: string;
};

export default function SubdomainScanPage() {
  const { lang, t } = useUiPrefs();
  const [domain, setDomain] = useState("");
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">(
    "idle"
  );
  const [result, setResult] = useState<ApiResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const run = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus("running");
    setErrorMessage(null);
    setResult(null);

    try {
      const res = await fetch("/api/vulnchecklist/subdomain-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain }),
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
      setErrorMessage(err instanceof Error ? err.message : "Unexpected error.");
    }
  };

  return (
    <main>
      <header>
        <div className="title-block">
          <h1>{lang === "ko" ? "서브도메인 스캔" : "Subdomain Scan"}</h1>
          <p>
            {lang === "ko"
              ? "subfinder + httpx를 실행하고 data/subdomains.txt 결과를 표시합니다."
              : "Runs subfinder + httpx and shows the resulting data/subdomains.txt."}
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
              {lang === "ko" ? "도메인" : "Domain"}
              <input
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="example.com"
                required
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

        <div className="card">
          <h2>{lang === "ko" ? "서브도메인" : "Subdomains"}</h2>
          {result?.subdomains?.length ? (
            <ul className="result-list">
              {result.subdomains.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          ) : (
            <p className="muted">
              {t.noResultsYet}
            </p>
          )}
        </div>
      </section>

      <section style={{ marginTop: 24 }}>
        <div className="card">
          <h2>{t.log}</h2>
          <AutoSizeTextarea readOnly value={result?.log || ""} placeholder="" />
        </div>
      </section>
    </main>
  );
}
