"use client";

import { useState } from "react";

import { AutoSizeTextarea } from "../../_components/AutoSizeTextarea";
import { useUiPrefs } from "../../_lib/uiPrefs";

type VerifySslMode = "default" | "verify" | "no-verify";

type ApiResponse = {
  log: string;
  error?: string;
};

export default function ImportantSearchPage() {
  const { lang, t } = useUiPrefs();
  const [url, setUrl] = useState("");
  const [useSitemap, setUseSitemap] = useState(true);
  const [sitemapDepth, setSitemapDepth] = useState(2);
  const [verifySsl, setVerifySsl] = useState<VerifySslMode>("default");

  const [loginEnabled, setLoginEnabled] = useState(false);
  const [loginUser, setLoginUser] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginPath, setLoginPath] = useState("/api/auth/login");
  const [logoutPath, setLogoutPath] = useState("/api/auth/logout");
  const [disableWarnings, setDisableWarnings] = useState(false);

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
      const res = await fetch("/api/vulnchecklist/important-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          useSitemap,
          sitemapDepth,
          verifySsl,
          loginEnabled,
          loginUser: loginEnabled ? loginUser : undefined,
          loginPassword: loginEnabled ? loginPassword : undefined,
          loginPath,
          logoutPath,
          disableWarnings,
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
      setErrorMessage(err instanceof Error ? err.message : "Unexpected error.");
    }
  };

  return (
    <main>
      <header>
        <div className="title-block">
          <h1>{lang === "ko" ? "중요 정보 탐지" : "Important Search"}</h1>
          <p>
            {lang === "ko"
              ? "헤더/응답/JS에서 중요 정보 노출 패턴을 탐지합니다."
              : "Scans headers, response bodies, and JS for sensitive exposure patterns."}
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
                placeholder="https://example.com/"
                required
              />
            </label>

            <div className="inline">
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={useSitemap}
                  onChange={(e) => setUseSitemap(e.target.checked)}
                />
                {lang === "ko" ? "사이트맵 크롤링" : "Use sitemap crawl"}
              </label>
              <label>
                {lang === "ko" ? "깊이" : "Depth"}
                <input
                  type="number"
                  value={sitemapDepth}
                  min={0}
                  max={6}
                  onChange={(e) => setSitemapDepth(Number(e.target.value))}
                  disabled={!useSitemap}
                />
              </label>
            </div>

            <div className="inline">
              <label>
                {lang === "ko" ? "SSL 검증" : "Verify SSL"}
                <select
                  value={verifySsl}
                  onChange={(e) => setVerifySsl(e.target.value as VerifySslMode)}
                >
                  <option value="default">{lang === "ko" ? "기본값" : "Default"}</option>
                  <option value="verify">{lang === "ko" ? "검증" : "Verify"}</option>
                  <option value="no-verify">{lang === "ko" ? "검증 끔" : "Disable"}</option>
                </select>
              </label>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={disableWarnings}
                  onChange={(e) => setDisableWarnings(e.target.checked)}
                />
                {lang === "ko" ? "경고 비활성화" : "Disable warnings"}
              </label>
            </div>

            <label className="toggle">
              <input
                type="checkbox"
                checked={loginEnabled}
                onChange={(e) => setLoginEnabled(e.target.checked)}
              />
              {lang === "ko" ? "로그인 세션 사용" : "Enable login session"}
            </label>

            <div className="inline">
              <label>
                {lang === "ko" ? "아이디" : "User"}
                <input
                  value={loginUser}
                  onChange={(e) => setLoginUser(e.target.value)}
                  disabled={!loginEnabled}
                />
              </label>
              <label>
                {lang === "ko" ? "비밀번호" : "Password"}
                <input
                  type="password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  disabled={!loginEnabled}
                />
              </label>
            </div>

            <div className="inline">
              <label>
                {lang === "ko" ? "로그인 경로" : "Login path"}
                <input
                  value={loginPath}
                  onChange={(e) => setLoginPath(e.target.value)}
                />
              </label>
              <label>
                {lang === "ko" ? "로그아웃 경로" : "Logout path"}
                <input
                  value={logoutPath}
                  onChange={(e) => setLogoutPath(e.target.value)}
                />
              </label>
            </div>

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
