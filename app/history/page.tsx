"use client";

import { useEffect, useMemo, useState } from "react";

import { AutoSizeTextarea } from "../_components/AutoSizeTextarea";
import { useUiPrefs } from "../_lib/uiPrefs";

type HistoryStatus = "running" | "success" | "error";

type HistoryMeta = {
  id: string;
  kind: string;
  userId: string;
  createdAt: string;
  finishedAt?: string;
  status: HistoryStatus;
  target?: string;
  error?: string | null;
};

type HistoryArtifact = {
  name: string;
  size: number;
};

type ListResponse = {
  userId: string;
  records: HistoryMeta[];
};

type DetailResponse = {
  userId: string;
  meta: HistoryMeta | null;
  artifacts: HistoryArtifact[];
};

const prettyKind = (kind: string, lang: "ko" | "en") => {
  const map: Record<string, { en: string; ko: string }> = {
    run: { en: "Run", ko: "전체 실행" },
    "subdomain-scan": { en: "Subdomain Scan", ko: "서브도메인 스캔" },
    "sitemap-builder": { en: "Sitemap Builder", ko: "사이트맵 빌더" },
    "library-scan": { en: "Library Scan", ko: "라이브러리 스캔" },
    "port-scan": { en: "Port Scan", ko: "포트 스캔" },
    "major-dir-file": { en: "Major Dir/File", ko: "주요 경로 탐색" },
    "important-search": { en: "Important Search", ko: "중요 정보 탐지" },
    "cookie-scan": { en: "Cookie & MFA", ko: "쿠키 & MFA" },
  };
  const entry = map[kind];
  if (!entry) return kind;
  return lang === "ko" ? entry.ko : entry.en;
};

function formatTimestamp(value: string, lang: "ko" | "en") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(lang === "ko" ? "ko-KR" : "en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

export default function HistoryPage() {
  const { lang, t } = useUiPrefs();
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [userId, setUserId] = useState<string>("");
  const [kindFilter, setKindFilter] = useState<string>("");
  const [records, setRecords] = useState<HistoryMeta[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [logPreview, setLogPreview] = useState<string>("");

  const loadList = async () => {
    setStatus("loading");
    setErrorMessage(null);

    try {
      const url = new URL("/api/history", window.location.origin);
      if (kindFilter) url.searchParams.set("kind", kindFilter);
      url.searchParams.set("limit", "100");

      const res = await fetch(url.pathname + url.search);
      const data = (await res.json()) as ListResponse;
      if (!res.ok) {
        setStatus("error");
        setErrorMessage(t.unexpectedError);
        setRecords([]);
        return;
      }
      setUserId(data.userId);
      setRecords(Array.isArray(data.records) ? data.records : []);
      setStatus("ready");

      if (!selectedId && data.records?.length) {
        setSelectedId(data.records[0].id);
      }
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : t.unexpectedError);
    }
  };

  useEffect(() => {
    void loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kindFilter]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setLogPreview("");
      return;
    }

    let cancelled = false;

    const run = async () => {
      try {
        const res = await fetch(`/api/history/${encodeURIComponent(selectedId)}`);
        const data = (await res.json()) as DetailResponse;
        if (cancelled) return;
        setDetail(data);

        const hasLog = data.artifacts?.some((a) => a.name === "log.txt");
        if (!hasLog) {
          setLogPreview("");
          return;
        }

        const logRes = await fetch(
          `/api/history/${encodeURIComponent(selectedId)}/artifact/${encodeURIComponent("log.txt")}`
        );
        if (!logRes.ok) {
          setLogPreview("");
          return;
        }
        const text = await logRes.text();
        if (!cancelled) {
          setLogPreview(text);
        }
      } catch {
        if (!cancelled) {
          setDetail(null);
          setLogPreview("");
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const filterOptions = useMemo(() => {
    const options: { value: string; label: string }[] = [
      { value: "", label: lang === "ko" ? "전체" : "All" },
      { value: "run", label: prettyKind("run", lang) },
      { value: "subdomain-scan", label: prettyKind("subdomain-scan", lang) },
      { value: "sitemap-builder", label: prettyKind("sitemap-builder", lang) },
      { value: "library-scan", label: prettyKind("library-scan", lang) },
      { value: "port-scan", label: prettyKind("port-scan", lang) },
      { value: "major-dir-file", label: prettyKind("major-dir-file", lang) },
      { value: "important-search", label: prettyKind("important-search", lang) },
      { value: "cookie-scan", label: prettyKind("cookie-scan", lang) },
    ];
    return options;
  }, [lang]);

  const selectedMeta = useMemo(() => {
    return records.find((r) => r.id === selectedId) || null;
  }, [records, selectedId]);

  return (
    <main>
      <header>
        <div className="title-block">
          <h1>{lang === "ko" ? "작업 기록" : "History"}</h1>
          <p>
            {lang === "ko"
              ? "현재 사용자 기준으로 실행 기록과 아티팩트를 조회합니다."
              : "Browse your run history and artifacts for the current user."}
          </p>
        </div>
        <div className="status-pill">
          {t.status}: {status}
        </div>
      </header>

      <section className="grid history-grid">
        <div className="card">
          <div className="history-toolbar">
            <div className="history-toolbar-title">
              <h2 style={{ margin: 0 }}>{lang === "ko" ? "목록" : "List"}</h2>
              <p className="muted" style={{ margin: 0 }}>
                {lang === "ko" ? "사용자" : "User"}: {userId || "-"}
              </p>
            </div>

            <div className="history-toolbar-actions">
              <label className="history-filter">
                {lang === "ko" ? "필터" : "Filter"}
                <select
                  value={kindFilter}
                  onChange={(e) => setKindFilter(e.target.value)}
                >
                  {filterOptions.map((opt) => (
                    <option key={opt.value || "all"} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="btn"
                onClick={() => void loadList()}
                disabled={status === "loading"}
              >
                {lang === "ko" ? "새로고침" : "Refresh"}
              </button>
            </div>
          </div>

          {errorMessage ? <p className="tag error">{errorMessage}</p> : null}

          {records.length ? (
            <div className="history-list" role="list">
              {records.map((record) => {
                const active = record.id === selectedId;
                const statusClass = record.status === "error" ? "tag error" : "tag";

                return (
                  <button
                    key={record.id}
                    type="button"
                    className={active ? "history-item active" : "history-item"}
                    onClick={() => setSelectedId(record.id)}
                    role="listitem"
                  >
                    <div className="history-item-top">
                      <div className="history-item-title">
                        {prettyKind(record.kind, lang)}
                      </div>
                      <span className={statusClass}>{record.status}</span>
                    </div>
                    <div className="history-item-meta">
                      <span className="muted">{record.target || "-"}</span>
                      <span className="muted">{formatTimestamp(record.createdAt, lang)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="muted">{lang === "ko" ? "기록이 없습니다." : "No history yet."}</p>
          )}
        </div>

        <div className="card">
          <h2>{lang === "ko" ? "상세" : "Details"}</h2>

          {!selectedId ? (
            <p className="muted">{lang === "ko" ? "항목을 선택하세요." : "Select a record."}</p>
          ) : (
            <>
              <div className="panel-stack">
                <div className="history-kv">
                  <div>
                    <div className="muted">ID</div>
                    <div>{selectedId}</div>
                  </div>
                  <div>
                    <div className="muted">{lang === "ko" ? "종류" : "Kind"}</div>
                    <div>{prettyKind(selectedMeta?.kind || "", lang)}</div>
                  </div>
                  <div>
                    <div className="muted">{lang === "ko" ? "대상" : "Target"}</div>
                    <div>{selectedMeta?.target || "-"}</div>
                  </div>
                  <div>
                    <div className="muted">{lang === "ko" ? "시작" : "Started"}</div>
                    <div>
                      {selectedMeta?.createdAt
                        ? formatTimestamp(selectedMeta.createdAt, lang)
                        : "-"}
                    </div>
                  </div>
                  <div>
                    <div className="muted">{lang === "ko" ? "상태" : "Status"}</div>
                    <div>{selectedMeta?.status || "-"}</div>
                  </div>
                </div>

                {selectedMeta?.error ? (
                  <p className="tag error">{selectedMeta.error}</p>
                ) : null}

                <div>
                  <h3 style={{ margin: "0 0 10px" }}>{t.log}</h3>
                  <AutoSizeTextarea
                    readOnly
                    value={logPreview}
                    placeholder=""
                    style={{ maxHeight: 420, overflow: "auto" }}
                  />
                </div>

                <div>
                  <h3 style={{ margin: "0 0 10px" }}>
                    {lang === "ko" ? "아티팩트" : "Artifacts"}
                  </h3>
                  {detail?.artifacts?.length ? (
                    <div className="history-artifacts">
                      {detail.artifacts.map((artifact) => (
                        <a
                          key={artifact.name}
                          className="history-artifact"
                          href={`/api/history/${encodeURIComponent(selectedId)}/artifact/${encodeURIComponent(
                            artifact.name
                          )}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <span className="history-artifact-name">{artifact.name}</span>
                          <span className="muted">{artifact.size.toLocaleString()} B</span>
                        </a>
                      ))}
                    </div>
                  ) : (
                    <p className="muted">{t.noResultsYet}</p>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
