"use client";

import { useEffect, useMemo, useState } from "react";

import { AutoSizeTextarea } from "../../_components/AutoSizeTextarea";
import { useUiPrefs } from "../../_lib/uiPrefs";

type PageError = {
  url: string;
  status: number | null;
  error: string;
};

type LibrarySummary = {
  name: string;
  version: string | null;
  occurrences: number;
  pages: string[];
  sources: string[];
  vulnerabilityCount: number;
  vulnerabilityIds: string[];
  vulnerabilityError?: string;
};

type LibraryScanResponse = {
  log: string;
  pages: {
    discovered: number;
    scanned: number;
    ok: number;
    failed: number;
  };
  pageErrors: PageError[];
  libraries: LibrarySummary[];
  rawJson: string;
  error?: string;
};

type HistoryMeta = {
  id: string;
  kind: string;
  createdAt: string;
  status: string;
  target?: string;
};

type HistoryListResponse = {
  userId: string;
  records: HistoryMeta[];
};

function shortId(value: string) {
  return value.length > 8 ? value.slice(0, 8) : value;
}

export default function LibraryScanPage() {
  const { lang, t } = useUiPrefs();
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [historyId, setHistoryId] = useState<string>("");
  const [result, setResult] = useState<LibraryScanResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const vulnerableLibs = useMemo(() => {
    if (!result?.libraries?.length) return [] as LibrarySummary[];
    return result.libraries.filter((lib) => lib.vulnerabilityCount > 0);
  }, [result]);

  const librariesText = useMemo(() => {
    if (!result?.libraries?.length) return "";
    return result.libraries
      .map((lib) => {
        const version = lib.version ? `@${lib.version}` : "";
        const osv = lib.vulnerabilityError ? ` (osv: ${lib.vulnerabilityError})` : "";
        return `${lib.name}${version} | refs=${lib.occurrences} | pages=${lib.pages.length} | vulns=${lib.vulnerabilityCount}${osv}`;
      })
      .join("\n");
  }, [result]);

  const pageErrorsText = useMemo(() => {
    if (!result?.pageErrors?.length) return "";
    return result.pageErrors
      .map((e) => `${e.status ?? "-"} ${e.url} - ${e.error}`)
      .join("\n");
  }, [result]);

  const loadLatest = async () => {
    setStatus("loading");
    setErrorMessage(null);
    setResult(null);
    setHistoryId("");

    try {
      const listRes = await fetch("/api/history?kind=run&limit=1", { method: "GET" });
      const listData = (await listRes.json()) as HistoryListResponse;
      const record = Array.isArray(listData.records) ? listData.records[0] : undefined;

      if (!listRes.ok || !record?.id) {
        setStatus("ready");
        return;
      }

      setHistoryId(record.id);

      const artifactRes = await fetch(
        `/api/history/${encodeURIComponent(record.id)}/artifact/library_scan_response.json`,
        { method: "GET" }
      );

      if (!artifactRes.ok) {
        setStatus("ready");
        setErrorMessage(
          lang === "ko"
            ? "최근 실행 기록에 라이브러리 스캔 결과가 없습니다. 대시보드에서 Run VulnCheckList를 다시 실행하세요."
            : "No library scan artifact found for the latest run. Re-run VulnCheckList from the dashboard."
        );
        return;
      }

      const data = (await artifactRes.json()) as LibraryScanResponse;
      setResult(data);
      setStatus("ready");
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : t.unexpectedError);
    }
  };

  useEffect(() => {
    void loadLatest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main>
      <header>
        <div className="title-block">
          <h1>{lang === "ko" ? "라이브러리 버전 스캔" : "Library Version Scan"}</h1>
          <p>
            {lang === "ko"
              ? "이 기능은 단독 실행 도구가 아니라, Run VulnCheckList 실행 시 함께 수행되는 일괄 스캔 결과를 보여줍니다."
              : "This is not a standalone runner. It shows the library scan output generated as part of the full Run VulnCheckList pipeline."}
          </p>
        </div>
        <div className="status-pill">
          {t.status}: {status}
        </div>
      </header>

      <section className="grid">
        <div className="card">
          <h2>{lang === "ko" ? "불러오기" : "Load"}</h2>
          <p className="muted">
            {lang === "ko"
              ? "최근 실행(run) 히스토리에서 library_scan 결과 파일을 읽습니다."
              : "Loads the latest run history artifact (library_scan)."}
          </p>
          <div className="inline" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="btn"
              onClick={() => void loadLatest()}
              disabled={status === "loading"}
            >
              {status === "loading"
                ? lang === "ko"
                  ? "불러오는 중..."
                  : "Loading..."
                : lang === "ko"
                  ? "최근 결과 새로고침"
                  : "Refresh latest"}
            </button>
            {historyId ? (
              <span className="tag">
                {lang === "ko" ? "기록" : "History"}: {shortId(historyId)}
              </span>
            ) : null}
            {errorMessage ? <span className="tag error">{errorMessage}</span> : null}
          </div>
        </div>

        <div className="card panel-stack">
          <div>
            <h2>{lang === "ko" ? "요약" : "Summary"}</h2>
            <ul className="result-list">
              <li>
                {lang === "ko" ? "발견 페이지" : "Pages discovered"}: {result?.pages.discovered ?? 0}
              </li>
              <li>
                {lang === "ko" ? "스캔 페이지" : "Pages scanned"}: {result?.pages.scanned ?? 0}
              </li>
              <li>
                {lang === "ko" ? "성공" : "OK"}: {result?.pages.ok ?? 0}
              </li>
              <li>
                {lang === "ko" ? "실패/스킵" : "Failed/Skipped"}: {result?.pages.failed ?? 0}
              </li>
              <li>
                {lang === "ko" ? "라이브러리" : "Libraries"}: {result?.libraries?.length ?? 0}
              </li>
              <li>
                {lang === "ko" ? "취약 라이브러리" : "Vulnerable"}: {vulnerableLibs.length}
              </li>
              <li>
                {lang === "ko" ? "페이지 에러" : "Page errors"}: {result?.pageErrors?.length ?? 0}
              </li>
            </ul>
          </div>

          <div>
            <h2>{lang === "ko" ? "취약 라이브러리" : "Vulnerable Libraries"}</h2>
            {vulnerableLibs.length ? (
              <ul className="result-list">
                {vulnerableLibs.slice(0, 25).map((lib) => (
                  <li key={`${lib.name}@${lib.version || ""}`}>
                    {lib.name}
                    {lib.version ? `@${lib.version}` : ""} ({lib.vulnerabilityCount})
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">
                {result
                  ? (lang === "ko" ? "취약 라이브러리가 없습니다." : "No vulnerable libraries detected.")
                  : lang === "ko" ? "실행 기록이 없습니다." : "No runs yet."}
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="grid" style={{ marginTop: 24 }}>
        <div className="card">
          <h2>{lang === "ko" ? "라이브러리 목록" : "Libraries"}</h2>
          <AutoSizeTextarea readOnly value={librariesText} placeholder="" />
        </div>
        <div className="card">
          <h2>{lang === "ko" ? "페이지 에러" : "Page Errors"}</h2>
          <AutoSizeTextarea readOnly value={pageErrorsText} placeholder="" />
        </div>
      </section>

      <section className="grid" style={{ marginTop: 24 }}>
        <div className="card">
          <h2>{t.log}</h2>
          <AutoSizeTextarea readOnly value={result?.log || ""} placeholder="" />
        </div>
      </section>
    </main>
  );
}
