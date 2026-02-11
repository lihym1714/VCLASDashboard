"use client";

import { useEffect, useMemo, useState } from "react";

import { AutoSizeTextarea } from "./_components/AutoSizeTextarea";
import {
  buildDefaultPresetState,
  loadSitemapDenylistPrefs,
  normalizeDenylistPatterns,
  type PresetState,
  type SitemapScopeEntry,
  SITEMAP_DENYLIST_PRESETS,
  saveSitemapDenylistPrefs,
} from "./_lib/sitemapDenylist";
import {
  generatePresetId,
  loadRunConfigPresets,
  saveRunConfigPresets,
  type RunConfigPreset,
} from "./_lib/runPresets";
import { useUiPrefs } from "./_lib/uiPrefs";

type VerifySslMode = "default" | "verify" | "no-verify";

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

type RunResponse = {
  log: string;
  subdomains: string[];
  sitemapTree: string;
  results?: AutoScriptResults | null;
  libraryScan?: LibraryScanResponse | null;
  error?: string | null;
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

const defaultLoginPath = "/api/auth/login";
const defaultLogoutPath = "/api/auth/logout";

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

export default function Home() {
  const { lang } = useUiPrefs();
  const [domain, setDomain] = useState("");
  const [loginEnabled, setLoginEnabled] = useState(false);
  const [loginUser, setLoginUser] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginPath, setLoginPath] = useState(defaultLoginPath);
  const [logoutPath, setLogoutPath] = useState(defaultLogoutPath);
  const [verifySsl, setVerifySsl] = useState<VerifySslMode>("default");
  const [disableWarnings, setDisableWarnings] = useState(false);

  const [sitemapScopeEnabled, setSitemapScopeEnabled] = useState(true);
  const [sitemapScopeAutoAllowSubdomains, setSitemapScopeAutoAllowSubdomains] =
    useState(true);
  const [sitemapScopes, setSitemapScopes] = useState<SitemapScopeEntry[]>([]);
  const [sitemapScopeDraftValue, setSitemapScopeDraftValue] = useState("");
  const [sitemapScopeDraftAllowSubdomains, setSitemapScopeDraftAllowSubdomains] =
    useState(true);

  const [sitemapDenylistEnabled, setSitemapDenylistEnabled] = useState(true);
  const [sitemapPresetEnabled, setSitemapPresetEnabled] = useState<PresetState>(() =>
    buildDefaultPresetState()
  );
  const [sitemapRememberCustom, setSitemapRememberCustom] = useState(false);
  const [sitemapCustomDenylist, setSitemapCustomDenylist] = useState("");
  const [status, setStatus] = useState<"idle" | "running" | "success" | "error">("idle");
  const [response, setResponse] = useState<RunResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [presets, setPresets] = useState<RunConfigPreset[]>([]);
  const [presetName, setPresetName] = useState("");
  const [presetIncludePassword, setPresetIncludePassword] = useState(false);
  const [presetMessage, setPresetMessage] = useState<string | null>(null);

  const [sitemapPrefsReady, setSitemapPrefsReady] = useState(false);

  useEffect(() => {
    const prefs = loadSitemapDenylistPrefs();
    setSitemapDenylistEnabled(prefs.enabled);
    setSitemapPresetEnabled(prefs.presets);
    setSitemapScopeEnabled(prefs.scopeEnabled);
    setSitemapScopeAutoAllowSubdomains(prefs.scopeAutoAllowSubdomains);
    setSitemapScopes(prefs.scopes);
    setSitemapRememberCustom(prefs.rememberCustom);
    setSitemapCustomDenylist(prefs.custom);
    setSitemapPrefsReady(true);
  }, []);

  useEffect(() => {
    setPresets(loadRunConfigPresets());
  }, []);

  useEffect(() => {
    if (!sitemapPrefsReady) return;
    saveSitemapDenylistPrefs({
      enabled: sitemapDenylistEnabled,
      presets: sitemapPresetEnabled,
      scopeEnabled: sitemapScopeEnabled,
      scopeAutoAllowSubdomains: sitemapScopeAutoAllowSubdomains,
      scopes: sitemapScopes,
      rememberCustom: sitemapRememberCustom,
      custom: sitemapCustomDenylist,
    });
  }, [
    sitemapCustomDenylist,
    sitemapDenylistEnabled,
    sitemapPrefsReady,
    sitemapPresetEnabled,
    sitemapScopeAutoAllowSubdomains,
    sitemapScopeEnabled,
    sitemapScopes,
    sitemapRememberCustom,
  ]);

  const sitemapDenylist = useMemo(() => {
    if (!sitemapDenylistEnabled) return [] as string[];

    const patterns: string[] = [];
    for (const group of SITEMAP_DENYLIST_PRESETS) {
      for (const item of group.items) {
        if (!sitemapPresetEnabled[item.id]) continue;
        patterns.push(...item.patterns);
      }
    }
    patterns.push(...parseCustomPatterns(sitemapCustomDenylist));
    return normalizeDenylistPatterns(patterns);
  }, [sitemapCustomDenylist, sitemapDenylistEnabled, sitemapPresetEnabled]);

  const sitemapScopeParams = useMemo(() => {
    if (!sitemapScopeEnabled) {
      return { scopeExact: [] as string[], scopeDomains: [] as string[] };
    }

    const exact: string[] = [];
    const domains: string[] = [];

    for (const entry of sitemapScopes) {
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
      const host = hostnameFromUrlish(domain);
      if (host) {
        if (sitemapScopeAutoAllowSubdomains) {
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
  }, [domain, sitemapScopeAutoAllowSubdomains, sitemapScopeEnabled, sitemapScopes]);

  const t = useMemo(() => {
    const dict: Record<"ko" | "en", Record<string, string>> = {
      en: {
        title: "VulnCheckList Dashboard",
        subtitle:
          "Run VulnCheckList against a target domain, then review the raw logs, subdomain discovery, and sitemap output in one workspace.",
        statusPrefix: "Status:",
        runConfig: "Run Configuration",
        targetLabel: "Target domain or URL",
        targetPlaceholder: "example.com",
        loginToggle: "Enable login session",
        loginUserLabel: "Login user",
        loginUserPlaceholder: "user@example.com",
        loginPasswordLabel: "Login password",
        loginPasswordPlaceholder: "••••••••",
        loginPathLabel: "Login path",
        logoutPathLabel: "Logout path",
        verifySslLabel: "Verify SSL",
        verifySslDefault: "Default",
        verifySslVerify: "Verify",
        verifySslNoVerify: "Disable verify",
        disableWarningsToggle: "Disable warnings",
        runButton: "Run VulnCheckList",
        runningButton: "Running...",
        latestSummary: "Latest Summary",
        noRuns: "No runs yet. Start a scan to populate results.",
        hasResults: "Review the output panels to inspect findings.",
        subdomains: "Subdomains",
        sitemap: "Sitemap",
        log: "Execution Log",
        sitemapTree: "Sitemap Tree",
        noSubdomains: "No subdomains recorded.",
        logPlaceholder: "Run the tool to see live output logs here.",
        sitemapPlaceholder: "Sitemap output will appear here when available.",
        summarySubdomains: "Subdomains:",
        summarySitemap: "Sitemap entries:",
        summaryLogSize: "Log size:",
        yes: "Yes",
        no: "No",
        chars: "chars",
        statusIdle: "Idle",
        statusRunning: "Running scan",
        statusSuccess: "Latest run complete",
        statusError: "Run failed",
        errorDomainRequired: "Domain is required.",
        errorRunFailed: "Run failed.",

        libraryScanTitle: "Library Version Scan",
        libraryScanSubtitle:
          "Scan sitemap pages for JS/CSS libraries, then check vulnerable versions via OSV.",
        libraryScanPages: "Pages scanned:",
        libraryScanLibraries: "Libraries:",
        libraryScanVulnerable: "Vulnerable:",
        libraryScanErrors: "Page errors:",
        libraryScanRaw: "Raw JSON",
        libraryScanLog: "Library scan log",

        presetsTitle: "Presets",
        presetsSaveTitle: "Save current configuration",
        presetsNameLabel: "Preset name",
        presetsIncludePassword: "Include login password (stores in browser)",
        presetsSave: "Save preset",
        presetsSaved: "Preset saved.",
        presetsLoaded: "Preset loaded.",
        presetsDeleted: "Preset deleted.",
        presetsListTitle: "Saved presets",
        presetsLoad: "Load",
        presetsDelete: "Delete",
        presetsNone: "No presets saved.",
        presetsInvalidName: "Preset name is required.",
      },
      ko: {
        title: "VulnCheckList 대시보드",
        subtitle:
          "대상 도메인에 대해 VulnCheckList를 실행하고, 로그/서브도메인/사이트맵 결과를 한 화면에서 확인합니다.",
        statusPrefix: "상태:",
        runConfig: "실행 설정",
        targetLabel: "대상 도메인 또는 URL",
        targetPlaceholder: "example.com",
        loginToggle: "로그인 세션 사용",
        loginUserLabel: "로그인 아이디",
        loginUserPlaceholder: "user@example.com",
        loginPasswordLabel: "로그인 비밀번호",
        loginPasswordPlaceholder: "••••••••",
        loginPathLabel: "로그인 경로",
        logoutPathLabel: "로그아웃 경로",
        verifySslLabel: "SSL 검증",
        verifySslDefault: "기본값",
        verifySslVerify: "검증",
        verifySslNoVerify: "검증 끔",
        disableWarningsToggle: "경고 비활성화",
        runButton: "VulnCheckList 실행",
        runningButton: "실행 중...",
        latestSummary: "최근 실행 요약",
        noRuns: "아직 실행 기록이 없습니다. 실행하면 결과가 표시됩니다.",
        hasResults: "출력 패널에서 결과를 확인하세요.",
        subdomains: "서브도메인",
        sitemap: "사이트맵",
        log: "실행 로그",
        sitemapTree: "사이트맵 트리",
        noSubdomains: "서브도메인 결과가 없습니다.",
        logPlaceholder: "실행하면 로그가 여기에 표시됩니다.",
        sitemapPlaceholder: "사이트맵 결과가 있으면 여기에 표시됩니다.",
        summarySubdomains: "서브도메인:",
        summarySitemap: "사이트맵 여부:",
        summaryLogSize: "로그 크기:",
        yes: "있음",
        no: "없음",
        chars: "문자",
        statusIdle: "대기",
        statusRunning: "스캔 실행 중",
        statusSuccess: "최근 실행 완료",
        statusError: "실행 실패",
        errorDomainRequired: "도메인을 입력하세요.",
        errorRunFailed: "실행에 실패했습니다.",

        libraryScanTitle: "라이브러리 버전 스캔",
        libraryScanSubtitle:
          "사이트맵(robots/sitemap.xml) 기반으로 JS/CSS 라이브러리를 수집하고, OSV로 취약 버전을 확인합니다.",
        libraryScanPages: "스캔 페이지:",
        libraryScanLibraries: "라이브러리:",
        libraryScanVulnerable: "취약 라이브러리:",
        libraryScanErrors: "페이지 에러:",
        libraryScanRaw: "원본 JSON",
        libraryScanLog: "라이브러리 스캔 로그",

        presetsTitle: "프리셋",
        presetsSaveTitle: "현재 설정 저장",
        presetsNameLabel: "프리셋 이름",
        presetsIncludePassword: "로그인 비밀번호 포함(브라우저에 저장)",
        presetsSave: "프리셋 저장",
        presetsSaved: "프리셋이 저장되었습니다.",
        presetsLoaded: "프리셋을 불러왔습니다.",
        presetsDeleted: "프리셋을 삭제했습니다.",
        presetsListTitle: "저장된 프리셋",
        presetsLoad: "불러오기",
        presetsDelete: "삭제",
        presetsNone: "저장된 프리셋이 없습니다.",
        presetsInvalidName: "프리셋 이름을 입력하세요.",
      },
    };

    return dict[lang];
  }, [lang]);

  const persistPresets = (next: RunConfigPreset[]) => {
    setPresets(next);
    saveRunConfigPresets(next);
  };

  const handleSavePreset = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPresetMessage(null);

    const name = presetName.trim();
    if (!name) {
      setPresetMessage(t.presetsInvalidName);
      return;
    }

    const snapshot: RunConfigPreset["config"] = {
      domain,
      loginEnabled,
      loginUser,
      loginPassword:
        presetIncludePassword && loginEnabled && loginPassword ? loginPassword : undefined,
      loginPath,
      logoutPath,
      verifySsl,
      disableWarnings,
      sitemapScopeEnabled,
      sitemapScopeAutoAllowSubdomains,
      sitemapScopes,
      sitemapDenylistEnabled,
      sitemapPresetEnabled,
      sitemapRememberCustom,
      sitemapCustomDenylist,
    };

    const next: RunConfigPreset = {
      id: generatePresetId(),
      name,
      createdAt: new Date().toISOString(),
      config: snapshot,
    };

    persistPresets([next, ...presets].slice(0, 30));
    setPresetName("");
    setPresetMessage(t.presetsSaved);
  };

  const handleLoadPreset = (preset: RunConfigPreset) => {
    const c = preset.config;

    setDomain(c.domain);
    setLoginEnabled(c.loginEnabled);
    setLoginUser(c.loginUser);
    setLoginPassword(c.loginPassword || "");
    setLoginPath(c.loginPath);
    setLogoutPath(c.logoutPath);
    setVerifySsl(c.verifySsl);
    setDisableWarnings(c.disableWarnings);

    setSitemapScopeEnabled(c.sitemapScopeEnabled);
    setSitemapScopeAutoAllowSubdomains(c.sitemapScopeAutoAllowSubdomains);
    setSitemapScopes(c.sitemapScopes);
    setSitemapScopeDraftValue("");

    setSitemapDenylistEnabled(c.sitemapDenylistEnabled);
    setSitemapPresetEnabled(c.sitemapPresetEnabled);
    setSitemapRememberCustom(c.sitemapRememberCustom);
    setSitemapCustomDenylist(c.sitemapCustomDenylist);

    setPresetMessage(t.presetsLoaded);
  };

  const handleDeletePreset = (id: string) => {
    const next = presets.filter((preset) => preset.id !== id);
    persistPresets(next);
    setPresetMessage(t.presetsDeleted);
  };

  const statusLabel = useMemo(() => {
    switch (status) {
      case "running":
        return t.statusRunning;
      case "success":
        return t.statusSuccess;
      case "error":
        return t.statusError;
      default:
        return t.statusIdle;
    }
  }, [status, t]);

  const statusTagClass = status === "error" ? "tag error" : "tag";

  const libraryScan = response?.libraryScan ?? null;

  const vulnerableLibraries = useMemo(() => {
    const libs = libraryScan?.libraries;
    if (!Array.isArray(libs)) return [] as LibraryScanResponse["libraries"];
    return libs.filter((lib) => lib.vulnerabilityCount > 0);
  }, [libraryScan]);

  const librariesText = useMemo(() => {
    const libs = libraryScan?.libraries;
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
  }, [libraryScan]);

  const osvStats = useMemo(() => {
    const libs = libraryScan?.libraries;
    if (!Array.isArray(libs) || !libs.length) {
      return { eligible: 0, missingVersion: 0, errors: 0 };
    }

    const looksLikeVersion = (value: string) => {
      return /^\d+(?:\.\d+){0,3}(?:[-+][0-9A-Za-z.-]+)?$/.test(value.trim());
    };

    let eligible = 0;
    let missingVersion = 0;
    let errors = 0;

    for (const lib of libs) {
      if (lib.vulnerabilityError) errors += 1;
      if (!lib.version) {
        missingVersion += 1;
        continue;
      }
      const ecosystem = lib.ecosystem ?? "npm";
      if (ecosystem === "npm" && looksLikeVersion(lib.version)) {
        eligible += 1;
      }
    }

    return { eligible, missingVersion, errors };
  }, [libraryScan]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!domain.trim()) {
      setErrorMessage(t.errorDomainRequired);
      setStatus("error");
      return;
    }

    setStatus("running");
    setErrorMessage(null);
    setResponse(null);

    try {
      const res = await fetch("/api/vulnchecklist/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          domain,
          loginEnabled,
          loginUser: loginEnabled ? loginUser : undefined,
          loginPassword: loginEnabled ? loginPassword : undefined,
          loginPath,
          logoutPath,
          verifySsl,
          disableWarnings,
          sitemapDenylist,
          sitemapScopeExact: sitemapScopeParams.scopeExact,
          sitemapScopeDomains: sitemapScopeParams.scopeDomains,
        }),
      });

      const data = (await res.json()) as RunResponse;
      if (!res.ok || data.error) {
        setStatus("error");
        setErrorMessage(data.error || t.errorRunFailed);
        setResponse(data);
        return;
      }

      setResponse(data);
      setStatus("success");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected error.";
      setErrorMessage(message);
      setStatus("error");
    }
  };

  const results = useMemo(() => {
    const value = response?.results;
    if (!value || typeof value !== "object") return null;
    return value as AutoScriptResults;
  }, [response]);

  const perTarget = useMemo(() => {
    const items = results?.per_target;
    return Array.isArray(items) ? items : ([] as PerTargetResult[]);
  }, [results]);

  const majorDirStats = useMemo(() => {
    let found = 0;
    let errors = 0;
    for (const target of perTarget) {
      const categories = Array.isArray(target.major_dir_file?.categories)
        ? target.major_dir_file.categories
        : [];
      for (const cat of categories) {
        found += Array.isArray(cat.found) ? cat.found.length : 0;
        errors += Array.isArray(cat.errors) ? cat.errors.length : 0;
      }
    }
    return { found, errors };
  }, [perTarget]);

  const importantStats = useMemo(() => {
    let exposureTypes = 0;
    let exposureMatches = 0;
    for (const target of perTarget) {
      const exposures = target.important_search?.exposures || {};
      const keys = Object.keys(exposures);
      exposureTypes += keys.length;
      for (const key of keys) {
        const matches = exposures[key];
        exposureMatches += Array.isArray(matches) ? matches.length : 0;
      }
    }
    return { exposureTypes, exposureMatches };
  }, [perTarget]);

  const portStats = useMemo(() => {
    const seenHosts = new Set<string>();
    let ipCount = 0;
    let openPortEntries = 0;
    for (const target of perTarget) {
      const hostKey = target.host || target.port_scan?.target;
      if (hostKey && seenHosts.has(hostKey)) continue;
      if (hostKey) seenHosts.add(hostKey);

      const ips = Array.isArray(target.port_scan?.ip_addresses)
        ? target.port_scan.ip_addresses
        : [];
      ipCount += ips.length;
      const openPorts = target.port_scan?.open_ports || {};
      for (const ip of Object.keys(openPorts)) {
        const ports = openPorts[ip];
        openPortEntries += Array.isArray(ports) ? ports.length : 0;
      }
    }
    return { ipCount, openPortEntries };
  }, [perTarget]);

  const cookieStats = useMemo(() => {
    let cookieCount = 0;
    let mfaYes = 0;
    for (const target of perTarget) {
      const cookies = Array.isArray(target.cookie_scan?.cookies)
        ? target.cookie_scan.cookies
        : [];
      cookieCount += cookies.length;
      if (target.cookie_scan?.mfa_detected) mfaYes += 1;
    }
    return { cookieCount, mfaYes };
  }, [perTarget]);

  return (
    <main>
      <header>
        <div className="title-block">
          <h1>{t.title}</h1>
          <p>{t.subtitle}</p>
        </div>
        <div className="status-pill">
          {t.statusPrefix} {statusLabel}
        </div>
      </header>

      <section className="grid">
        <div className="card">
          <h2>{t.runConfig}</h2>
          <form onSubmit={handleSubmit}>
            <label>
              {t.targetLabel}
              <input
                value={domain}
                onChange={(event) => setDomain(event.target.value)}
                placeholder={t.targetPlaceholder}
                required
              />
            </label>

            <label className="toggle">
              <input
                type="checkbox"
                checked={loginEnabled}
                onChange={(event) => setLoginEnabled(event.target.checked)}
              />
              {t.loginToggle}
            </label>

            <label>
              {t.loginUserLabel}
              <input
                value={loginUser}
                onChange={(event) => setLoginUser(event.target.value)}
                disabled={!loginEnabled}
                placeholder={t.loginUserPlaceholder}
              />
            </label>

            <label>
              {t.loginPasswordLabel}
              <input
                type="password"
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
                disabled={!loginEnabled}
                placeholder={t.loginPasswordPlaceholder}
              />
            </label>

            <div className="inline">
              <label>
                {t.loginPathLabel}
                <input
                  value={loginPath}
                  onChange={(event) => setLoginPath(event.target.value)}
                />
              </label>
              <label>
                {t.logoutPathLabel}
                <input
                  value={logoutPath}
                  onChange={(event) => setLogoutPath(event.target.value)}
                />
              </label>
            </div>

            <div className="inline">
              <label>
                {t.verifySslLabel}
                <select
                  value={verifySsl}
                  onChange={(event) =>
                    setVerifySsl(event.target.value as VerifySslMode)
                  }
                >
                  <option value="default">{t.verifySslDefault}</option>
                  <option value="verify">{t.verifySslVerify}</option>
                  <option value="no-verify">{t.verifySslNoVerify}</option>
                </select>
              </label>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={disableWarnings}
                  onChange={(event) => setDisableWarnings(event.target.checked)}
                />
                {t.disableWarningsToggle}
              </label>
            </div>

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
                    checked={sitemapScopeEnabled}
                    onChange={(e) => setSitemapScopeEnabled(e.target.checked)}
                  />
                  {lang === "ko"
                    ? "등록된 범위(scope) 내에서만 링크 탐색"
                    : "Only crawl URLs inside the allowed scope"}
                </label>

                <label className="toggle" style={{ marginTop: 10 }}>
                  <input
                    type="checkbox"
                    checked={sitemapScopeAutoAllowSubdomains}
                    disabled={!sitemapScopeEnabled}
                    onChange={(e) => setSitemapScopeAutoAllowSubdomains(e.target.checked)}
                  />
                  {lang === "ko"
                    ? "기본 대상에 대해 서브도메인 허용"
                    : "Allow subdomains for the default target"}
                </label>

                <p className="muted" style={{ margin: "10px 0 0" }}>
                  {lang === "ko"
                    ? `적용 범위: exact ${sitemapScopeParams.scopeExact.length} / subdomains ${
                        sitemapScopeParams.scopeDomains.length
                      }`
                    : `Effective scope: exact ${sitemapScopeParams.scopeExact.length} / subdomains ${
                        sitemapScopeParams.scopeDomains.length
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
                      value={sitemapScopeDraftValue}
                      onChange={(e) => setSitemapScopeDraftValue(e.target.value)}
                      placeholder={lang === "ko" ? "예: example.com" : "e.g. example.com"}
                      disabled={!sitemapScopeEnabled}
                      style={{ flex: "1 1 260px" }}
                    />
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={sitemapScopeDraftAllowSubdomains}
                        disabled={!sitemapScopeEnabled}
                        onChange={(e) => setSitemapScopeDraftAllowSubdomains(e.target.checked)}
                      />
                      {lang === "ko" ? "서브도메인 허용" : "Allow subdomains"}
                    </label>
                    <button
                      type="button"
                      className="btn"
                      disabled={!sitemapScopeEnabled}
                      onClick={() => {
                        const host = hostnameFromUrlish(sitemapScopeDraftValue);
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
                          allowSubdomains: sitemapScopeDraftAllowSubdomains,
                          enabled: true,
                        };
                        setSitemapScopes((prev) => [entry, ...prev]);
                        setSitemapScopeDraftValue("");
                      }}
                      style={{ padding: "10px 14px" }}
                    >
                      {lang === "ko" ? "추가" : "Add"}
                    </button>
                  </div>

                  {sitemapScopes.length ? (
                    <div className="panel-stack" style={{ gap: 10, marginTop: 12 }}>
                      {sitemapScopes.map((entry) => (
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
                                disabled={!sitemapScopeEnabled}
                                onChange={(e) =>
                                  setSitemapScopes((prev) =>
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
                                disabled={!sitemapScopeEnabled}
                                onChange={(e) =>
                                  setSitemapScopes((prev) =>
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
                                setSitemapScopes((prev) =>
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
                        ? "등록된 scope가 없으면 대상(host)이 자동으로 적용됩니다."
                        : "If no custom scopes are added, the target host is used automatically."}
                    </p>
                  )}
                </div>

                <h4 className="muted" style={{ margin: "18px 0 10px" }}>
                  {lang === "ko" ? "도메인 제외(denylist)" : "Denylist"}
                </h4>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={sitemapDenylistEnabled}
                    onChange={(e) => setSitemapDenylistEnabled(e.target.checked)}
                  />
                  {lang === "ko"
                    ? "특정 도메인(호스트)을 사이트맵 탐색에서 제외"
                    : "Exclude domains (hostname substring match) during sitemap crawl"}
                </label>

                <p className="muted" style={{ margin: "10px 0 0" }}>
                  {lang === "ko"
                    ? `활성 패턴: ${sitemapDenylist.length}`
                    : `Active patterns: ${sitemapDenylist.length}`}
                </p>

                {SITEMAP_DENYLIST_PRESETS.map((group) => (
                  <div key={`run-deny-${group.id}`} style={{ marginTop: 14 }}>
                    <h4 className="muted" style={{ margin: "0 0 10px" }}>
                      {lang === "ko" ? group.titleKo : group.titleEn}
                    </h4>
                    <div className="panel-stack" style={{ gap: 10 }}>
                      {group.items.map((item) => (
                        <label key={`run-deny-item-${item.id}`} className="toggle">
                          <input
                            type="checkbox"
                            checked={Boolean(sitemapPresetEnabled[item.id])}
                            disabled={!sitemapDenylistEnabled}
                            onChange={(e) =>
                              setSitemapPresetEnabled((prev) => ({
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
                        checked={sitemapRememberCustom}
                        disabled={!sitemapDenylistEnabled}
                        onChange={(e) => setSitemapRememberCustom(e.target.checked)}
                      />
                      {lang === "ko" ? "기억하기" : "Remember"}
                      <span className="muted">
                        {lang === "ko" ? "(새로고침 후에도 유지)" : "(persist across refresh)"}
                      </span>
                    </label>
                  </div>

                  <div style={{ marginTop: 10 }}>
                    <AutoSizeTextarea
                      value={sitemapCustomDenylist}
                      aria-label={lang === "ko" ? "사용자 정의 패턴" : "Custom patterns"}
                      onChange={(e) => setSitemapCustomDenylist(e.target.value)}
                      placeholder={
                        lang === "ko"
                          ? "예: facebook.com\nhttps://example.com/\n=exact.example.com\nblog\n(쉼표/줄바꿈으로 구분)"
                          : "e.g. facebook.com\nhttps://example.com/\n=exact.example.com\nblog\n(separated by commas/newlines)"
                      }
                      disabled={!sitemapDenylistEnabled}
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
                {status === "running" ? t.runningButton : t.runButton}
              </button>
              <span className={statusTagClass}>{statusLabel}</span>
            </div>
          </form>

          <details open={false} style={{ marginTop: 18 }}>
            <summary>{t.presetsTitle}</summary>
            <div style={{ marginTop: 12 }}>
              <div className="panel-stack" style={{ gap: 14 }}>
                <div>
                  <h3 className="muted" style={{ margin: "0 0 10px" }}>
                    {t.presetsSaveTitle}
                  </h3>
                  <form onSubmit={handleSavePreset}>
                    <label>
                      {t.presetsNameLabel}
                      <input
                        value={presetName}
                        onChange={(e) => setPresetName(e.target.value)}
                        placeholder={lang === "ko" ? "예: 스테이징-기본" : "e.g. staging-default"}
                      />
                    </label>

                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={presetIncludePassword}
                        onChange={(e) => setPresetIncludePassword(e.target.checked)}
                        disabled={!loginEnabled}
                      />
                      {t.presetsIncludePassword}
                    </label>

                    <div className="inline">
                      <button className="btn" type="submit">
                        {t.presetsSave}
                      </button>
                      {presetMessage ? <span className="tag">{presetMessage}</span> : null}
                    </div>
                  </form>
                </div>

                <div>
                  <h3 className="muted" style={{ margin: "0 0 10px" }}>
                    {t.presetsListTitle}
                  </h3>
                  {presets.length ? (
                    <div className="panel-stack" style={{ gap: 10 }}>
                      {presets.map((preset) => (
                        <div
                          key={preset.id}
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
                            <div style={{ fontWeight: 800 }}>{preset.name}</div>
                            <div className="muted" style={{ fontSize: "0.85rem" }}>
                              {(preset.config.domain || "-").slice(0, 80)}
                            </div>
                          </div>
                          <div className="inline" style={{ flexWrap: "wrap" }}>
                            <button
                              type="button"
                              className="btn"
                              onClick={() => handleLoadPreset(preset)}
                            >
                              {t.presetsLoad}
                            </button>
                            <button
                              type="button"
                              className="btn"
                              onClick={() => handleDeletePreset(preset.id)}
                              style={{
                                background: "transparent",
                                color: "var(--ink)",
                                border: "1px solid var(--border)",
                              }}
                            >
                              {t.presetsDelete}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="muted">{t.presetsNone}</p>
                  )}
                </div>
              </div>
            </div>
          </details>
        </div>

        <div className="card panel-stack">
          <div>
            <h2>{t.latestSummary}</h2>
            {errorMessage ? (
              <p className="tag error">{errorMessage}</p>
            ) : (
              <p className="muted">
                {response
                  ? t.hasResults
                  : t.noRuns}
              </p>
            )}
            <ul className="result-list">
              <li>
                {t.summarySubdomains} {response?.subdomains?.length ?? 0}
              </li>
              <li>
                {t.summarySitemap} {response?.sitemapTree ? t.yes : t.no}
              </li>
              <li>
                {lang === "ko" ? "주요 경로 탐색" : "Major Dir/File"}: {majorDirStats.found}
                {majorDirStats.errors ? ` (${lang === "ko" ? "오류" : "errors"}: ${majorDirStats.errors})` : ""}
              </li>
              <li>
                {lang === "ko" ? "중요 정보" : "Important Search"}: {importantStats.exposureTypes}
                {importantStats.exposureMatches
                  ? ` (${lang === "ko" ? "매치" : "matches"}: ${importantStats.exposureMatches})`
                  : ""}
              </li>
              <li>
                {lang === "ko" ? "포트" : "Ports"}: {portStats.openPortEntries}
                {portStats.ipCount ? ` (${lang === "ko" ? "IP" : "IPs"}: ${portStats.ipCount})` : ""}
              </li>
              <li>
                {lang === "ko" ? "쿠키" : "Cookies"}: {cookieStats.cookieCount}
                {cookieStats.mfaYes ? ` (MFA: ${cookieStats.mfaYes})` : ""}
              </li>
              <li>
                {lang === "ko" ? "라이브러리" : "Libraries"}: {libraryScan?.libraries?.length ?? 0}
                {vulnerableLibraries.length ? ` (vuln: ${vulnerableLibraries.length})` : ""}
              </li>
              <li>
                {t.summaryLogSize} {response?.log ? response.log.length : 0} {t.chars}
              </li>
            </ul>
          </div>
          <div>
            <h2>{t.subdomains}</h2>
            {response?.subdomains?.length ? (
              <ul className="result-list">
                {response.subdomains.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : (
              <p className="muted">{t.noSubdomains}</p>
            )}
          </div>
        </div>
      </section>

      <section className="grid" style={{ marginTop: 24 }}>
        <div className="card">
          <h2>{t.log}</h2>
          <AutoSizeTextarea
            readOnly
            value={response?.log || ""}
            placeholder={t.logPlaceholder}
          />
        </div>
        <div className="card">
          <h2>{t.sitemapTree}</h2>
          <AutoSizeTextarea
            readOnly
            value={response?.sitemapTree || ""}
            placeholder={t.sitemapPlaceholder}
          />
        </div>
      </section>

      <section className="grid" style={{ marginTop: 24 }}>
        <div className="card panel-stack">
          <div>
            <h2>{t.libraryScanTitle}</h2>
            <p className="muted">{t.libraryScanSubtitle}</p>
            {libraryScan?.error ? <p className="tag error">{libraryScan.error}</p> : null}
          </div>

          <div>
            <h2>{lang === "ko" ? "요약" : "Summary"}</h2>
            <ul className="result-list">
              <li>
                {t.libraryScanPages} {libraryScan?.pages?.scanned ?? 0} (ok:{" "}
                {libraryScan?.pages?.ok ?? 0}, failed:{" "}
                {libraryScan?.pages?.failed ?? 0})
              </li>
              <li>
                {t.libraryScanLibraries} {libraryScan?.libraries?.length ?? 0}
              </li>
              <li>
                {lang === "ko" ? "OSV 확인" : "OSV checked"}: {osvStats.eligible}
                {osvStats.missingVersion
                  ? ` (${lang === "ko" ? "버전 없음" : "missing version"}: ${osvStats.missingVersion})`
                  : ""}
                {osvStats.errors
                  ? ` (${lang === "ko" ? "오류" : "errors"}: ${osvStats.errors})`
                  : ""}
              </li>
              <li>
                {t.libraryScanVulnerable} {vulnerableLibraries.length}
              </li>
              <li>
                {t.libraryScanErrors} {libraryScan?.pageErrors?.length ?? 0}
              </li>
            </ul>
          </div>

          <div>
            <h2>{lang === "ko" ? "취약 라이브러리" : "Vulnerable Libraries"}</h2>
            {vulnerableLibraries.length ? (
              <ul className="result-list">
                {vulnerableLibraries.slice(0, 20).map((lib) => (
                  <li key={`${lib.name}@${lib.version || ""}`}>
                    {lib.name}
                    {lib.version ? `@${lib.version}` : ""} ({lib.vulnerabilityCount})
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">
                {response
                  ? (lang === "ko"
                      ? "취약 라이브러리가 없습니다."
                      : "No vulnerable libraries detected.")
                  : t.noRuns}
              </p>
            )}
          </div>
        </div>

        <div className="card">
          <h2>{lang === "ko" ? "라이브러리 목록" : "Libraries"}</h2>

          {libraryScan?.libraries?.length ? (
            <details open={false}>
              <summary>
                {lang === "ko"
                  ? `전체 보기 (${libraryScan.libraries.length})`
                  : `Show all (${libraryScan.libraries.length})`}
              </summary>
              <div style={{ marginTop: 12 }}>
                <AutoSizeTextarea
                  readOnly
                  value={librariesText}
                  placeholder=""
                  style={{ minHeight: 0 }}
                />
              </div>
            </details>
          ) : (
            <p className="muted">
              {response
                ? (lang === "ko" ? "발견된 라이브러리가 없습니다." : "No libraries detected.")
                : t.noRuns}
            </p>
          )}

        </div>
      </section>

      <section style={{ marginTop: 24 }}>
        <div className="card">
          <h2>{t.libraryScanLog}</h2>
          <AutoSizeTextarea readOnly value={libraryScan?.log || ""} placeholder="" />
        </div>
      </section>

      <section className="grid" style={{ marginTop: 24 }}>
        <div className="card">
          <h2>{lang === "ko" ? "주요 경로 탐색 결과" : "Major Dir/File Findings"}</h2>
          {perTarget.length ? (
            <div className="panel-stack">
              {perTarget.map((item) => {
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
                  <details key={item.target} open={false}>
                    <summary>
                      {item.url} ({lang === "ko" ? "발견" : "found"}: {foundItems.length}
                      {errorItems.length
                        ? `, ${lang === "ko" ? "오류" : "errors"}: ${errorItems.length}`
                        : ""}
                      )
                    </summary>
                    {foundItems.length ? (
                      <ul className="result-list">
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
                      <p className="muted">{lang === "ko" ? "발견된 경로가 없습니다." : "No findings."}</p>
                    )}

                    {errorItems.length ? (
                      <>
                        <h3 className="muted" style={{ marginTop: 16 }}>
                          {lang === "ko" ? "요청 오류" : "Request errors"}
                        </h3>
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
            <p className="muted">
              {response ? (lang === "ko" ? "결과가 없습니다." : "No results.") : t.noRuns}
            </p>
          )}
        </div>

        <div className="card">
          <h2>{lang === "ko" ? "중요 정보 탐지 결과" : "Important Search Findings"}</h2>
          {perTarget.length ? (
            <div className="panel-stack">
              {perTarget.map((item) => {
                const imp = item.important_search;
                const exposures = imp?.exposures || {};
                const exposureKeys = Object.keys(exposures);
                const headerInfos = Array.isArray(imp?.header_infos) ? imp.header_infos : [];

                return (
                  <details key={item.target} open={false}>
                    <summary>
                      {item.url} ({lang === "ko" ? "노출" : "exposures"}: {exposureKeys.length})
                    </summary>

                    <ul className="result-list">
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
                        <h3 className="muted" style={{ marginTop: 16 }}>
                          {lang === "ko" ? "헤더" : "Headers"}
                        </h3>
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
                        <h3 className="muted" style={{ marginTop: 16 }}>
                          {lang === "ko" ? "노출 패턴" : "Exposure patterns"}
                        </h3>
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
                                      style={{ minHeight: 0 }}
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
                        {lang === "ko" ? "노출 패턴이 탐지되지 않았습니다." : "No exposure patterns detected."}
                      </p>
                    )}
                  </details>
                );
              })}
            </div>
          ) : (
            <p className="muted">{response ? (lang === "ko" ? "결과가 없습니다." : "No results.") : t.noRuns}</p>
          )}
        </div>
      </section>

      <section className="grid" style={{ marginTop: 24 }}>
        <div className="card">
          <h2>{lang === "ko" ? "포트 스캔 결과" : "Port Scan"}</h2>
          {perTarget.length ? (
            <div className="panel-stack">
              {Array.from(
                new Map(perTarget.map((item) => [item.host || item.port_scan?.target, item])).values()
              ).map((item) => {
                const scan = item.port_scan;
                const ips = Array.isArray(scan?.ip_addresses) ? scan.ip_addresses : [];
                const openPorts = scan?.open_ports || {};
                return (
                  <details key={`port-${item.host}`} open={false}>
                    <summary>
                      {item.host} ({lang === "ko" ? "IP" : "IPs"}: {ips.length})
                    </summary>
                    {scan?.error ? <p className="muted">{scan.error}</p> : null}
                    {ips.length ? (
                      <ul className="result-list">
                        {ips.map((ip) => {
                          const ports = openPorts[ip];
                          const list = Array.isArray(ports) ? ports.join(", ") : "-";
                          return (
                            <li key={`${item.host}-${ip}`}>
                              {ip}: {list}
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p className="muted">{lang === "ko" ? "IP를 찾지 못했습니다." : "No IP addresses."}</p>
                    )}
                  </details>
                );
              })}
            </div>
          ) : (
            <p className="muted">{response ? (lang === "ko" ? "결과가 없습니다." : "No results.") : t.noRuns}</p>
          )}
        </div>

        <div className="card">
          <h2>{lang === "ko" ? "쿠키 & MFA" : "Cookie & MFA"}</h2>
          {perTarget.length ? (
            <div className="panel-stack">
              {perTarget.map((item) => {
                const scan = item.cookie_scan;
                const cookies = Array.isArray(scan?.cookies) ? scan.cookies : [];
                const names = Array.from(new Set(cookies.map((c) => c.name).filter(Boolean)));
                return (
                  <details key={`cookie-${item.target}`} open={false}>
                    <summary>
                      {item.url} ({lang === "ko" ? "쿠키" : "cookies"}: {cookies.length}, MFA:{" "}
                      {scan?.mfa_detected ? "true" : "false"})
                    </summary>

                    {names.length ? (
                      <ul className="result-list">
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
                      <p className="muted">{lang === "ko" ? "쿠키가 없습니다." : "No cookies."}</p>
                    )}
                  </details>
                );
              })}
            </div>
          ) : (
            <p className="muted">{response ? (lang === "ko" ? "결과가 없습니다." : "No results.") : t.noRuns}</p>
          )}
        </div>
      </section>
    </main>
  );
}
