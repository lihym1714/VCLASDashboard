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

type MajorDirFileFoundItem = {
  path: string;
  url: string;
  status_code: number;
};

type MajorDirFileErrorItem = {
  path: string;
  url: string;
  error: string;
};

type MajorDirFileCategory = {
  category: string;
  checked: number;
  found: MajorDirFileFoundItem[];
  errors: MajorDirFileErrorItem[];
};

type MajorDirFileResult = {
  base_url: string;
  timeout: number;
  categories: MajorDirFileCategory[];
};

type ImportantHeaderInfo = {
  header: string;
  value: string;
  versions: string[];
};

type ImportantSearchResult = {
  url: string;
  status_code: number | null;
  header_infos: ImportantHeaderInfo[];
  exposures: Record<string, string[]>;
  error: string | null;
};

type PortScanResult = {
  target: string;
  ip_addresses: string[];
  open_ports: Record<string, number[]>;
  error: string | null;
};

type CookieItem = {
  name: string;
  value: string | null;
  raw_header: string;
};

type CookieScanResult = {
  url: string;
  cookies: CookieItem[];
  mfa_detected: boolean;
};

type PerTargetResult = {
  target: string;
  url: string;
  host: string;
  major_dir_file: MajorDirFileResult;
  important_search: ImportantSearchResult;
  port_scan: PortScanResult;
  cookie_scan: CookieScanResult;
};

type AutoScriptResults = {
  generated_at?: string;
  targets_path?: string;
  targets?: string[];
  per_target?: PerTargetResult[];
  sitemap_tree?: string | null;
};

type LibraryScanResponse = {
  log: string;
  pages: {
    discovered: number;
    scanned: number;
    ok: number;
    failed: number;
  };
  pageErrors: { url: string; status: number | null; error: string }[];
  libraries: {
    name: string;
    version: string | null;
    ecosystem?: string | null;
    occurrences: number;
    pages: string[];
    sources: string[];
    vulnerabilityCount: number;
    vulnerabilityIds: string[];
    vulnerabilityError?: string;
  }[];
  rawJson: string;
  error?: string;
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
  const [resultsPreview, setResultsPreview] = useState<AutoScriptResults | null>(null);
  const [resultsPreviewError, setResultsPreviewError] = useState<string | null>(null);
  const [libraryScanPreview, setLibraryScanPreview] = useState<LibraryScanResponse | null>(null);
  const [libraryScanPreviewError, setLibraryScanPreviewError] = useState<string | null>(null);

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
      setResultsPreview(null);
      setResultsPreviewError(null);
      setLibraryScanPreview(null);
      setLibraryScanPreviewError(null);
      return;
    }

    setLogPreview("");
    setResultsPreview(null);
    setResultsPreviewError(null);
    setLibraryScanPreview(null);
    setLibraryScanPreviewError(null);

    let cancelled = false;

    const run = async () => {
      try {
        const res = await fetch(`/api/history/${encodeURIComponent(selectedId)}`);
        const data = (await res.json()) as DetailResponse;
        if (cancelled) return;
        setDetail(data);

        const artifacts = Array.isArray(data.artifacts) ? data.artifacts : [];
        const hasLog = artifacts.some((a) => a.name === "log.txt");
        const hasResults = artifacts.some((a) => a.name === "results.json");
        const hasLibraryScan = artifacts.some((a) => a.name === "library_scan_response.json");

        if (hasLog) {
          try {
            const logRes = await fetch(
              `/api/history/${encodeURIComponent(selectedId)}/artifact/${encodeURIComponent("log.txt")}`
            );
            if (logRes.ok) {
              const text = await logRes.text();
              if (!cancelled) {
                setLogPreview(text);
              }
            }
          } catch {
            if (!cancelled) {
              setLogPreview("");
            }
          }
        }

        if (hasResults) {
          try {
            const resultsRes = await fetch(
              `/api/history/${encodeURIComponent(selectedId)}/artifact/${encodeURIComponent("results.json")}`
            );
            if (resultsRes.ok) {
              const raw = (await resultsRes.json()) as unknown;
              if (raw && typeof raw === "object") {
                if (!cancelled) {
                  setResultsPreview(raw as AutoScriptResults);
                }
              }
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : t.unexpectedError;
            if (!cancelled) {
              setResultsPreviewError(message);
            }
          }
        }

        if (hasLibraryScan) {
          try {
            const libRes = await fetch(
              `/api/history/${encodeURIComponent(selectedId)}/artifact/${encodeURIComponent(
                "library_scan_response.json"
              )}`
            );
            if (libRes.ok) {
              const raw = (await libRes.json()) as unknown;
              if (raw && typeof raw === "object") {
                if (!cancelled) {
                  setLibraryScanPreview(raw as LibraryScanResponse);
                }
              }
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : t.unexpectedError;
            if (!cancelled) {
              setLibraryScanPreviewError(message);
            }
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : t.unexpectedError;
        if (!cancelled) {
          setDetail(null);
          setLogPreview("");
          setResultsPreview(null);
          setResultsPreviewError(message);
          setLibraryScanPreview(null);
          setLibraryScanPreviewError(message);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [selectedId, t]);

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

  const resultsTargets = useMemo(() => {
    const list = resultsPreview?.targets;
    if (!Array.isArray(list)) return [] as string[];
    return list.filter(Boolean);
  }, [resultsPreview]);

  const resultsPerTarget = useMemo(() => {
    const list = resultsPreview?.per_target;
    if (!Array.isArray(list)) return [] as PerTargetResult[];
    return list;
  }, [resultsPreview]);

  const libraryScanVulnerable = useMemo(() => {
    const libs = libraryScanPreview?.libraries;
    if (!Array.isArray(libs)) return [] as LibraryScanResponse["libraries"];
    return libs.filter((lib) => lib.vulnerabilityCount > 0);
  }, [libraryScanPreview]);

  const libraryScanText = useMemo(() => {
    const libs = libraryScanPreview?.libraries;
    if (!Array.isArray(libs) || !libs.length) return "";
    return libs
      .map((lib) => {
        const version = lib.version ? `@${lib.version}` : "@unknown";
        const osv = lib.vulnerabilityError ? ` (osv: ${lib.vulnerabilityError})` : "";
        const ecosystem = lib.ecosystem ? `${lib.ecosystem}:` : "";
        const pagesCount = Array.isArray(lib.pages) ? lib.pages.length : 0;
        return `${ecosystem}${lib.name}${version} | refs=${lib.occurrences} | pages=${pagesCount} | vulns=${lib.vulnerabilityCount}${osv}`;
      })
      .join("\n");
  }, [libraryScanPreview]);

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

                {resultsPreviewError ? (
                  <p className="tag error">{resultsPreviewError}</p>
                ) : null}

                {resultsPreview ? (
                  <div>
                    <h3 style={{ margin: "0 0 10px" }}>
                      {lang === "ko" ? "결과(시각화)" : "Visualized Results"}
                    </h3>
                    <div className="panel-stack">
                      <details open={false}>
                        <summary>
                          {lang === "ko" ? "대상" : "Targets"} ({resultsTargets.length})
                        </summary>
                        <div style={{ marginTop: 12 }}>
                          {resultsTargets.length ? (
                            <ul className="result-list">
                              {resultsTargets.map((target) => (
                                <li key={target}>{target}</li>
                              ))}
                            </ul>
                          ) : (
                            <p className="muted">
                              {lang === "ko" ? "대상이 없습니다." : "No targets."}
                            </p>
                          )}
                        </div>
                      </details>

                      {resultsPreview.sitemap_tree ? (
                        <details open={false}>
                          <summary>{lang === "ko" ? "사이트맵 트리" : "Sitemap Tree"}</summary>
                          <div style={{ marginTop: 12 }}>
                            <AutoSizeTextarea
                              readOnly
                              value={resultsPreview.sitemap_tree}
                              placeholder=""
                              style={{ minHeight: 0, maxHeight: 420, overflow: "auto" }}
                            />
                          </div>
                        </details>
                      ) : null}

                      <details open={false}>
                        <summary>
                          {lang === "ko" ? "주요 경로 탐색" : "Major Dir/File"} ({resultsPerTarget.length})
                        </summary>
                        <div style={{ marginTop: 12 }}>
                          {resultsPerTarget.length ? (
                            <div className="panel-stack">
                              {resultsPerTarget.map((item) => {
                                const categories = Array.isArray(item.major_dir_file?.categories)
                                  ? item.major_dir_file.categories
                                  : [];

                                const foundItems = categories.flatMap((cat) =>
                                  (Array.isArray(cat.found) ? cat.found : []).map((entry) => ({
                                    category: cat.category,
                                    path: entry.path,
                                    url: entry.url,
                                    status: entry.status_code,
                                  }))
                                );
                                const errorItems = categories.flatMap((cat) =>
                                  (Array.isArray(cat.errors) ? cat.errors : []).map((entry) => ({
                                    category: cat.category,
                                    path: entry.path,
                                    url: entry.url,
                                    error: entry.error,
                                  }))
                                );

                                const maxFound = 25;
                                const maxErrors = 10;

                                return (
                                  <details key={`hist-major-${selectedId}-${item.target}`} open={false}>
                                    <summary>
                                      {item.url} ({lang === "ko" ? "발견" : "found"}: {foundItems.length}
                                      {errorItems.length
                                        ? `, ${lang === "ko" ? "오류" : "errors"}: ${errorItems.length}`
                                        : ""}
                                      )
                                    </summary>
                                    {foundItems.length ? (
                                      <ul className="result-list" style={{ marginTop: 12 }}>
                                        {foundItems.slice(0, maxFound).map((f) => (
                                          <li key={`${f.url}-${f.category}-${f.path}`}>
                                            [{f.category}] {f.path} ({f.status})
                                          </li>
                                        ))}
                                        {foundItems.length > maxFound ? (
                                          <li>
                                            {lang === "ko"
                                              ? `... ${foundItems.length - maxFound}개 더 있음`
                                              : `... ${foundItems.length - maxFound} more`}
                                          </li>
                                        ) : null}
                                      </ul>
                                    ) : (
                                      <p className="muted" style={{ marginTop: 12 }}>
                                        {lang === "ko" ? "발견된 경로가 없습니다." : "No findings."}
                                      </p>
                                    )}

                                    {errorItems.length ? (
                                      <>
                                        <h4 className="muted" style={{ marginTop: 16 }}>
                                          {lang === "ko" ? "요청 오류" : "Request errors"}
                                        </h4>
                                        <ul className="result-list">
                                          {errorItems.slice(0, maxErrors).map((e) => (
                                            <li key={`${e.url}-${e.category}-${e.path}`}>[{e.category}] {e.path}</li>
                                          ))}
                                          {errorItems.length > maxErrors ? (
                                            <li>
                                              {lang === "ko"
                                                ? `... ${errorItems.length - maxErrors}개 더 있음`
                                                : `... ${errorItems.length - maxErrors} more`}
                                            </li>
                                          ) : null}
                                        </ul>
                                      </>
                                    ) : null}
                                  </details>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="muted">{lang === "ko" ? "결과가 없습니다." : "No results."}</p>
                          )}
                        </div>
                      </details>

                      <details open={false}>
                        <summary>
                          {lang === "ko" ? "중요 정보 탐지" : "Important Search"} ({resultsPerTarget.length})
                        </summary>
                        <div style={{ marginTop: 12 }}>
                          {resultsPerTarget.length ? (
                            <div className="panel-stack">
                              {resultsPerTarget.map((item) => {
                                const imp = item.important_search;
                                const exposures = imp?.exposures || {};
                                const exposureKeys = Object.keys(exposures);
                                const headerInfos = Array.isArray(imp?.header_infos) ? imp.header_infos : [];

                                return (
                                  <details key={`hist-imp-${selectedId}-${item.target}`} open={false}>
                                    <summary>
                                      {item.url} ({lang === "ko" ? "노출" : "exposures"}: {exposureKeys.length})
                                    </summary>

                                    <ul className="result-list" style={{ marginTop: 12 }}>
                                      <li>
                                        {lang === "ko" ? "상태 코드" : "Status"}: {String(imp?.status_code ?? "-")}
                                      </li>
                                      {imp?.error ? (
                                        <li>
                                          {lang === "ko" ? "오류" : "Error"}: {imp.error}
                                        </li>
                                      ) : null}
                                    </ul>

                                    {headerInfos.length ? (
                                      <>
                                        <h4 className="muted" style={{ marginTop: 16 }}>
                                          {lang === "ko" ? "헤더" : "Headers"}
                                        </h4>
                                        <ul className="result-list">
                                          {headerInfos.map((h) => (
                                            <li key={`${item.url}-${h.header}`}>
                                              {h.header}: {h.value}
                                            </li>
                                          ))}
                                        </ul>
                                      </>
                                    ) : null}

                                    {exposureKeys.length ? (
                                      <>
                                        <h4 className="muted" style={{ marginTop: 16 }}>
                                          {lang === "ko" ? "노출 패턴" : "Exposure patterns"}
                                        </h4>
                                        <div className="panel-stack" style={{ gap: 12 }}>
                                          {exposureKeys.map((key) => {
                                            const matchesRaw = exposures[key];
                                            const matches = Array.isArray(matchesRaw)
                                              ? matchesRaw.filter(Boolean)
                                              : [];
                                            const count = matches.length;
                                            const sample = matches[0] ?? "";
                                            return (
                                              <details key={`${item.url}-${key}`} open={false}>
                                                <summary>
                                                  {key}: {count}
                                                  {sample ? ` (ex: ${sample})` : ""}
                                                </summary>
                                                {count ? (
                                                  <div style={{ marginTop: 12 }}>
                                                    <AutoSizeTextarea
                                                      readOnly
                                                      value={matches.join("\n")}
                                                      placeholder=""
                                                      style={{ minHeight: 0, maxHeight: 420, overflow: "auto" }}
                                                    />
                                                  </div>
                                                ) : (
                                                  <p className="muted" style={{ marginTop: 8 }}>
                                                    {lang === "ko" ? "발견된 항목이 없습니다." : "No matches."}
                                                  </p>
                                                )}
                                              </details>
                                            );
                                          })}
                                        </div>
                                      </>
                                    ) : (
                                      <p className="muted" style={{ marginTop: 12 }}>
                                        {lang === "ko"
                                          ? "노출 패턴이 탐지되지 않았습니다."
                                          : "No exposure patterns detected."}
                                      </p>
                                    )}
                                  </details>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="muted">{lang === "ko" ? "결과가 없습니다." : "No results."}</p>
                          )}
                        </div>
                      </details>

                      <details open={false}>
                        <summary>
                          {lang === "ko" ? "포트 스캔" : "Port Scan"}
                        </summary>
                        <div style={{ marginTop: 12 }}>
                          {resultsPerTarget.length ? (
                            <div className="panel-stack">
                              {Array.from(
                                new Map(
                                  resultsPerTarget.map((item) => [
                                    item.host || item.port_scan?.target || item.target,
                                    item,
                                  ])
                                ).values()
                              ).map((item) => {
                                const scan = item.port_scan;
                                const ips = Array.isArray(scan?.ip_addresses) ? scan.ip_addresses : [];
                                const openPorts = scan?.open_ports || {};
                                const host = item.host || scan?.target || item.target;

                                return (
                                  <details key={`hist-port-${selectedId}-${host}`} open={false}>
                                    <summary>
                                      {host} ({lang === "ko" ? "IP" : "IPs"}: {ips.length})
                                    </summary>
                                    {scan?.error ? <p className="muted">{scan.error}</p> : null}
                                    {ips.length ? (
                                      <ul className="result-list" style={{ marginTop: 12 }}>
                                        {ips.map((ip) => {
                                          const ports = openPorts[ip];
                                          const list = Array.isArray(ports) ? ports.join(", ") : "-";
                                          return (
                                            <li key={`${host}-${ip}`}>
                                              {ip}: {list}
                                            </li>
                                          );
                                        })}
                                      </ul>
                                    ) : (
                                      <p className="muted" style={{ marginTop: 12 }}>
                                        {lang === "ko" ? "IP를 찾지 못했습니다." : "No IP addresses."}
                                      </p>
                                    )}
                                  </details>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="muted">{lang === "ko" ? "결과가 없습니다." : "No results."}</p>
                          )}
                        </div>
                      </details>

                      <details open={false}>
                        <summary>
                          {lang === "ko" ? "쿠키 & MFA" : "Cookie & MFA"}
                        </summary>
                        <div style={{ marginTop: 12 }}>
                          {resultsPerTarget.length ? (
                            <div className="panel-stack">
                              {resultsPerTarget.map((item) => {
                                const scan = item.cookie_scan;
                                const cookies = Array.isArray(scan?.cookies) ? scan.cookies : [];
                                const names = Array.from(new Set(cookies.map((c) => c.name).filter(Boolean)));
                                return (
                                  <details key={`hist-cookie-${selectedId}-${item.target}`} open={false}>
                                    <summary>
                                      {item.url} ({lang === "ko" ? "쿠키" : "cookies"}: {cookies.length}, MFA:{" "}
                                      {scan?.mfa_detected ? "true" : "false"})
                                    </summary>
                                    {names.length ? (
                                      <ul className="result-list" style={{ marginTop: 12 }}>
                                        {names.slice(0, 30).map((name) => (
                                          <li key={`${item.url}-${name}`}>{name}</li>
                                        ))}
                                        {names.length > 30 ? (
                                          <li>
                                            {lang === "ko"
                                              ? `... ${names.length - 30}개 더 있음`
                                              : `... ${names.length - 30} more`}
                                          </li>
                                        ) : null}
                                      </ul>
                                    ) : (
                                      <p className="muted" style={{ marginTop: 12 }}>
                                        {lang === "ko" ? "쿠키가 없습니다." : "No cookies."}
                                      </p>
                                    )}
                                  </details>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="muted">{lang === "ko" ? "결과가 없습니다." : "No results."}</p>
                          )}
                        </div>
                      </details>
                    </div>
                  </div>
                ) : null}

                {libraryScanPreviewError ? (
                  <p className="tag error">{libraryScanPreviewError}</p>
                ) : null}

                {libraryScanPreview ? (
                  <div>
                    <h3 style={{ margin: "0 0 10px" }}>
                      {lang === "ko" ? "라이브러리 버전 스캔" : "Library Version Scan"}
                    </h3>

                    {libraryScanPreview.error ? <p className="tag error">{libraryScanPreview.error}</p> : null}

                    <ul className="result-list">
                      <li>
                        {lang === "ko" ? "스캔 페이지" : "Pages"}: {libraryScanPreview.pages?.scanned ?? 0} (ok:{" "}
                        {libraryScanPreview.pages?.ok ?? 0}, failed: {libraryScanPreview.pages?.failed ?? 0})
                      </li>
                      <li>
                        {lang === "ko" ? "라이브러리" : "Libraries"}: {libraryScanPreview.libraries?.length ?? 0}
                      </li>
                      <li>
                        {lang === "ko" ? "취약" : "Vulnerable"}: {libraryScanVulnerable.length}
                      </li>
                      <li>
                        {lang === "ko" ? "페이지 에러" : "Page errors"}: {libraryScanPreview.pageErrors?.length ?? 0}
                      </li>
                    </ul>

                    <details open={false}>
                      <summary>
                        {lang === "ko" ? "라이브러리 목록" : "Libraries"} ({libraryScanPreview.libraries?.length ?? 0})
                      </summary>
                      <div style={{ marginTop: 12 }}>
                        <AutoSizeTextarea
                          readOnly
                          value={libraryScanText}
                          placeholder=""
                          style={{ minHeight: 0, maxHeight: 420, overflow: "auto" }}
                        />
                      </div>
                    </details>

                    <details open={false}>
                      <summary>{lang === "ko" ? "스캔 로그" : "Scan log"}</summary>
                      <div style={{ marginTop: 12 }}>
                        <AutoSizeTextarea
                          readOnly
                          value={libraryScanPreview.log || ""}
                          placeholder=""
                          style={{ minHeight: 0, maxHeight: 420, overflow: "auto" }}
                        />
                      </div>
                    </details>
                  </div>
                ) : null}

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
