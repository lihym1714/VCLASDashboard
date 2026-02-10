"use client";

import { useState } from "react";

import { AutoSizeTextarea } from "../../_components/AutoSizeTextarea";
import { useUiPrefs } from "../../_lib/uiPrefs";

type ApiResponse = {
  log: string;
  error?: string;
};

export default function PortScanPage() {
  const { lang, t } = useUiPrefs();
  const [host, setHost] = useState("");
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
      const res = await fetch("/api/vulnchecklist/port-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host }),
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
          <h1>{lang === "ko" ? "포트 스캔" : "Port Scan"}</h1>
          <p>
            {lang === "ko"
              ? "호스트(도메인/IP)에 대해 port_scan.py를 실행합니다."
              : "Runs port_scan.py for the provided host (domain/IP)."}
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
              {lang === "ko" ? "호스트" : "Host"}
              <input
                value={host}
                onChange={(e) => setHost(e.target.value)}
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
          <h2>{t.output}</h2>
          <AutoSizeTextarea readOnly value={result?.log || ""} placeholder="" />
        </div>
      </section>
    </main>
  );
}
