"use client";

import { useState } from "react";

import { useUiPrefs } from "../../_lib/uiPrefs";

type ApiResponse = {
  log: string;
  sitemapTree: string;
  error?: string;
};

export default function SitemapBuilderPage() {
  const { lang, t } = useUiPrefs();
  const [startUrl, setStartUrl] = useState("");
  const [maxDepth, setMaxDepth] = useState(2);
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
      const res = await fetch("/api/vulnchecklist/sitemap-builder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startUrl, maxDepth }),
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
          <h1>{lang === "ko" ? "사이트맵 빌더" : "Sitemap Builder"}</h1>
          <p>
            {lang === "ko"
              ? "링크를 크롤링해 사이트맵 트리를 생성하고 data/sitemap_tree.txt를 읽어옵니다."
              : "Crawls links to build a sitemap tree and reads data/sitemap_tree.txt."}
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
              {lang === "ko" ? "시작 URL" : "Start URL"}
              <input
                value={startUrl}
                onChange={(e) => setStartUrl(e.target.value)}
                placeholder="https://example.com/"
                required
              />
            </label>
            <label>
              {lang === "ko" ? "최대 깊이" : "Max depth"}
              <input
                type="number"
                min={0}
                max={10}
                value={maxDepth}
                onChange={(e) => setMaxDepth(Number(e.target.value))}
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
          <h2>{lang === "ko" ? "사이트맵 트리" : "Sitemap Tree"}</h2>
          <textarea readOnly value={result?.sitemapTree || ""} placeholder="" />
        </div>
      </section>

      <section style={{ marginTop: 24 }}>
        <div className="card">
          <h2>{t.log}</h2>
          <textarea readOnly value={result?.log || ""} placeholder="" />
        </div>
      </section>
    </main>
  );
}
