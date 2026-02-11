"use client";

import { useEffect, useMemo, useState } from "react";

import { AutoSizeTextarea } from "../../_components/AutoSizeTextarea";
import { useUiPrefs } from "../../_lib/uiPrefs";
import {
  buildDefaultPresetState,
  loadSitemapDenylistPrefs,
  normalizeDenylistPatterns,
  type PresetState,
  type SitemapScopeEntry,
  SITEMAP_DENYLIST_PRESETS,
  saveSitemapDenylistPrefs,
} from "../../_lib/sitemapDenylist";

type ApiResponse = {
  log: string;
  sitemapTree: string;
  error?: string;
};

function parseCustomPatterns(value: string): string[] {
  if (!value.trim()) return [];
  return value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .map((item) => {
      if (!item) return "";

      if (item.startsWith("=")) {
        const rest = item.slice(1).trim();
        if (!rest) return "";
        try {
          const url =
            rest.toLowerCase().startsWith("http://") ||
            rest.toLowerCase().startsWith("https://")
              ? new URL(rest)
              : new URL(`https://${rest}`);
          return `=${url.hostname}`;
        } catch {
          return `=${rest}`;
        }
      }

      if (item.toLowerCase().startsWith("http://") || item.toLowerCase().startsWith("https://")) {
        try {
          const url = new URL(item);
          return `=${url.hostname}`;
        } catch {
          return item;
        }
      }

      return item;
    })
    .filter(Boolean);
}

function hostnameFromUrlish(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url =
      trimmed.toLowerCase().startsWith("http://") ||
      trimmed.toLowerCase().startsWith("https://")
        ? new URL(trimmed)
        : new URL(`https://${trimmed}`);
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function generateScopeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function SitemapBuilderPage() {
  const { lang, t } = useUiPrefs();
  const [startUrl, setStartUrl] = useState("");
  const [maxDepth, setMaxDepth] = useState(2);

  const [scopeEnabled, setScopeEnabled] = useState(true);
  const [scopeAutoAllowSubdomains, setScopeAutoAllowSubdomains] = useState(true);
  const [scopes, setScopes] = useState<SitemapScopeEntry[]>([]);
  const [scopeDraftValue, setScopeDraftValue] = useState("");
  const [scopeDraftAllowSubdomains, setScopeDraftAllowSubdomains] = useState(true);

  const [denylistEnabled, setDenylistEnabled] = useState(true);
  const [presetEnabled, setPresetEnabled] = useState<PresetState>(() =>
    buildDefaultPresetState()
  );
  const [rememberCustom, setRememberCustom] = useState(false);
  const [customDenylist, setCustomDenylist] = useState("");
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">(
    "idle"
  );
  const [result, setResult] = useState<ApiResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [prefsReady, setPrefsReady] = useState(false);

  useEffect(() => {
    const prefs = loadSitemapDenylistPrefs();
    setDenylistEnabled(prefs.enabled);
    setPresetEnabled(prefs.presets);
    setScopeEnabled(prefs.scopeEnabled);
    setScopeAutoAllowSubdomains(prefs.scopeAutoAllowSubdomains);
    setScopes(prefs.scopes);
    setRememberCustom(prefs.rememberCustom);
    setCustomDenylist(prefs.custom);
    setPrefsReady(true);
  }, []);

  useEffect(() => {
    if (!prefsReady) return;
    saveSitemapDenylistPrefs({
      enabled: denylistEnabled,
      presets: presetEnabled,
      scopeEnabled,
      scopeAutoAllowSubdomains,
      scopes,
      rememberCustom,
      custom: customDenylist,
    });
  }, [
    customDenylist,
    denylistEnabled,
    presetEnabled,
    prefsReady,
    rememberCustom,
    scopeAutoAllowSubdomains,
    scopeEnabled,
    scopes,
  ]);

  const scopeParams = useMemo(() => {
    if (!scopeEnabled) {
      return { scopeExact: [] as string[], scopeDomains: [] as string[] };
    }

    const exact: string[] = [];
    const domains: string[] = [];

    for (const entry of scopes) {
      if (!entry.enabled) continue;
      const host = hostnameFromUrlish(entry.value);
      if (!host) continue;
      if (entry.allowSubdomains) {
        domains.push(host);
      } else {
        exact.push(host);
      }
    }

    if (!exact.length && !domains.length) {
      const host = hostnameFromUrlish(startUrl);
      if (host) {
        if (scopeAutoAllowSubdomains) {
          domains.push(host);
        } else {
          exact.push(host);
        }
      }
    }

    return {
      scopeExact: Array.from(new Set(exact)),
      scopeDomains: Array.from(new Set(domains)),
    };
  }, [scopeAutoAllowSubdomains, scopeEnabled, scopes, startUrl]);

  const activeDenylist = useMemo(() => {
    if (!denylistEnabled) return [] as string[];

    const patterns: string[] = [];
    for (const group of SITEMAP_DENYLIST_PRESETS) {
      for (const item of group.items) {
        if (!presetEnabled[item.id]) continue;
        patterns.push(...item.patterns);
      }
    }
    patterns.push(...parseCustomPatterns(customDenylist));
    return normalizeDenylistPatterns(patterns);
  }, [customDenylist, denylistEnabled, presetEnabled]);

  const run = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus("running");
    setErrorMessage(null);
    setResult(null);

    try {
      const res = await fetch("/api/vulnchecklist/sitemap-builder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startUrl,
          maxDepth,
          denylist: activeDenylist,
          scopeExact: scopeParams.scopeExact,
          scopeDomains: scopeParams.scopeDomains,
        }),
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

            <details open={false}>
              <summary>
                {lang === "ko"
                  ? "탐색 범위/제외 설정(scope/denylist)"
                  : "Crawl scope / denylist"}
              </summary>

              <div style={{ marginTop: 12 }}>
                <h4 className="muted" style={{ margin: "0 0 10px" }}>
                  {lang === "ko" ? "탐색 범위(scope)" : "Scope"}
                </h4>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={scopeEnabled}
                    onChange={(e) => setScopeEnabled(e.target.checked)}
                  />
                  {lang === "ko"
                    ? "등록된 범위(scope) 내에서만 링크 탐색"
                    : "Only crawl URLs inside the allowed scope"}
                </label>

                <label className="toggle" style={{ marginTop: 10 }}>
                  <input
                    type="checkbox"
                    checked={scopeAutoAllowSubdomains}
                    disabled={!scopeEnabled}
                    onChange={(e) => setScopeAutoAllowSubdomains(e.target.checked)}
                  />
                  {lang === "ko"
                    ? "기본 대상에 대해 서브도메인 허용"
                    : "Allow subdomains for the default target"}
                </label>

                <p className="muted" style={{ margin: "10px 0 0" }}>
                  {lang === "ko"
                    ? `적용 범위: exact ${scopeParams.scopeExact.length} / subdomains ${
                        scopeParams.scopeDomains.length
                      }`
                    : `Effective scope: exact ${scopeParams.scopeExact.length} / subdomains ${
                        scopeParams.scopeDomains.length
                      }`}
                </p>

                <div style={{ marginTop: 12 }}>
                  <div
                    style={{
                      display: "flex",
                      gap: 12,
                      alignItems: "center",
                      flexWrap: "wrap",
                    }}
                  >
                    <input
                      value={scopeDraftValue}
                      onChange={(e) => setScopeDraftValue(e.target.value)}
                      placeholder={lang === "ko" ? "예: example.com" : "e.g. example.com"}
                      disabled={!scopeEnabled}
                      style={{ flex: "1 1 260px" }}
                    />
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={scopeDraftAllowSubdomains}
                        disabled={!scopeEnabled}
                        onChange={(e) => setScopeDraftAllowSubdomains(e.target.checked)}
                      />
                      {lang === "ko" ? "서브도메인 허용" : "Allow subdomains"}
                    </label>
                    <button
                      type="button"
                      className="btn"
                      disabled={!scopeEnabled}
                      onClick={() => {
                        const host = hostnameFromUrlish(scopeDraftValue);
                        if (!host) {
                          window.alert(
                            lang === "ko"
                              ? "유효한 도메인/URL을 입력하세요."
                              : "Enter a valid domain/URL."
                          );
                          return;
                        }

                        const entry: SitemapScopeEntry = {
                          id: generateScopeId(),
                          value: host,
                          allowSubdomains: scopeDraftAllowSubdomains,
                          enabled: true,
                        };
                        setScopes((prev) => [entry, ...prev]);
                        setScopeDraftValue("");
                      }}
                      style={{ padding: "10px 14px" }}
                    >
                      {lang === "ko" ? "추가" : "Add"}
                    </button>
                  </div>

                  {scopes.length ? (
                    <div className="panel-stack" style={{ gap: 10, marginTop: 12 }}>
                      {scopes.map((entry) => (
                        <div
                          key={entry.id}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            gap: 12,
                            flexWrap: "wrap",
                            padding: "10px 12px",
                            borderRadius: 12,
                            border: "1px solid var(--border)",
                            background: "var(--panel)",
                          }}
                        >
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 800 }}>{entry.value}</div>
                            <div className="muted" style={{ fontSize: "0.85rem" }}>
                              {entry.allowSubdomains
                                ? lang === "ko"
                                  ? "서브도메인 포함"
                                  : "includes subdomains"
                                : lang === "ko"
                                  ? "정확히 이 호스트만"
                                  : "exact host only"}
                            </div>
                          </div>
                          <div className="inline" style={{ flexWrap: "wrap" }}>
                            <label className="toggle">
                              <input
                                type="checkbox"
                                checked={entry.enabled}
                                disabled={!scopeEnabled}
                                onChange={(e) =>
                                  setScopes((prev) =>
                                    prev.map((item) =>
                                      item.id === entry.id
                                        ? { ...item, enabled: e.target.checked }
                                        : item
                                    )
                                  )
                                }
                              />
                              {lang === "ko" ? "사용" : "Enabled"}
                            </label>
                            <label className="toggle">
                              <input
                                type="checkbox"
                                checked={entry.allowSubdomains}
                                disabled={!scopeEnabled}
                                onChange={(e) =>
                                  setScopes((prev) =>
                                    prev.map((item) =>
                                      item.id === entry.id
                                        ? { ...item, allowSubdomains: e.target.checked }
                                        : item
                                    )
                                  )
                                }
                              />
                              {lang === "ko" ? "서브도메인" : "Subdomains"}
                            </label>
                            <button
                              type="button"
                              className="btn"
                              onClick={() =>
                                setScopes((prev) =>
                                  prev.filter((item) => item.id !== entry.id)
                                )
                              }
                              style={{
                                padding: "10px 14px",
                                background: "transparent",
                                color: "var(--ink)",
                                border: "1px solid var(--border)",
                              }}
                            >
                              {lang === "ko" ? "삭제" : "Remove"}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="muted" style={{ margin: "10px 0 0" }}>
                      {lang === "ko"
                        ? "등록된 scope가 없으면 시작 URL의 호스트가 자동으로 적용됩니다."
                        : "If no custom scopes are added, the start URL host is used automatically."}
                    </p>
                  )}
                </div>

                <h4 className="muted" style={{ margin: "18px 0 10px" }}>
                  {lang === "ko" ? "도메인 제외(denylist)" : "Denylist"}
                </h4>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={denylistEnabled}
                    onChange={(e) => setDenylistEnabled(e.target.checked)}
                  />
                  {lang === "ko"
                    ? "특정 도메인(호스트)을 탐색에서 제외"
                    : "Exclude domains (hostname substring match)"}
                </label>

                <p className="muted" style={{ margin: "10px 0 0" }}>
                  {lang === "ko"
                    ? `활성 패턴: ${activeDenylist.length}`
                    : `Active patterns: ${activeDenylist.length}`}
                </p>

                {SITEMAP_DENYLIST_PRESETS.map((group) => (
                  <div key={group.id} style={{ marginTop: 14 }}>
                    <h4 className="muted" style={{ margin: "0 0 10px" }}>
                      {lang === "ko" ? group.titleKo : group.titleEn}
                    </h4>
                    <div className="panel-stack" style={{ gap: 10 }}>
                      {group.items.map((item) => (
                        <label key={item.id} className="toggle">
                          <input
                            type="checkbox"
                            checked={Boolean(presetEnabled[item.id])}
                            disabled={!denylistEnabled}
                            onChange={(e) =>
                              setPresetEnabled((prev) => ({
                                ...prev,
                                [item.id]: e.target.checked,
                              }))
                            }
                          />
                          {lang === "ko" ? item.labelKo : item.labelEn}
                          <span className="muted">({item.patterns.join(", ")})</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}

                <div style={{ marginTop: 14 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 12,
                      flexWrap: "wrap",
                    }}
                  >
                    <div className="muted" style={{ fontSize: "0.95rem" }}>
                      {lang === "ko" ? "사용자 정의 패턴" : "Custom patterns"}
                    </div>
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={rememberCustom}
                        disabled={!denylistEnabled}
                        onChange={(e) => setRememberCustom(e.target.checked)}
                      />
                      {lang === "ko" ? "기억하기" : "Remember"}
                      <span className="muted">
                        {lang === "ko" ? "(새로고침 후에도 유지)" : "(persist across refresh)"}
                      </span>
                    </label>
                  </div>

                  <div style={{ marginTop: 10 }}>
                    <AutoSizeTextarea
                      value={customDenylist}
                      aria-label={lang === "ko" ? "사용자 정의 패턴" : "Custom patterns"}
                      onChange={(e) => setCustomDenylist(e.target.value)}
                      placeholder={
                        lang === "ko"
                          ? "예: facebook.com\nhttps://example.com/\n=exact.example.com\nblog\n(쉼표/줄바꿈으로 구분)"
                          : "e.g. facebook.com\nhttps://example.com/\n=exact.example.com\nblog\n(separated by commas/newlines)"
                      }
                      disabled={!denylistEnabled}
                      style={{ minHeight: 96 }}
                    />
                  </div>
                  <p className="muted" style={{ margin: "10px 0 0" }}>
                    {lang === "ko" ? (
                      "example.com 은 example.com 및 서브도메인 전체를 제외합니다. https://example.com/ 또는 =example.com 은 example.com만 제외(서브도메인 허용)합니다."
                    ) : (
                      "example.com blocks example.com and its subdomains. https://example.com/ or =example.com blocks only example.com (subdomains allowed)."
                    )}
                  </p>
                </div>
              </div>
            </details>
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
          <AutoSizeTextarea readOnly value={result?.sitemapTree || ""} placeholder="" />
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
