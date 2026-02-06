"use client";

import { useMemo, useState } from "react";

import { useUiPrefs } from "./_lib/uiPrefs";

type VerifySslMode = "default" | "verify" | "no-verify";

type RunResponse = {
  log: string;
  subdomains: string[];
  sitemapTree: string;
  error?: string | null;
};

const defaultLoginPath = "/api/auth/login";
const defaultLogoutPath = "/api/auth/logout";

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
  const [status, setStatus] = useState<"idle" | "running" | "success" | "error">("idle");
  const [response, setResponse] = useState<RunResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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
      },
    };

    return dict[lang];
  }, [lang]);

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

            <div className="inline">
              <button className="btn" type="submit" disabled={status === "running"}>
                {status === "running" ? t.runningButton : t.runButton}
              </button>
              <span className={statusTagClass}>{statusLabel}</span>
            </div>
          </form>
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
          <textarea
            readOnly
            value={response?.log || ""}
            placeholder={t.logPlaceholder}
          />
        </div>
        <div className="card">
          <h2>{t.sitemapTree}</h2>
          <textarea
            readOnly
            value={response?.sitemapTree || ""}
            placeholder={t.sitemapPlaceholder}
          />
        </div>
      </section>
    </main>
  );
}
