"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useUiPrefs } from "../_lib/uiPrefs";

export default function UiChrome() {
  const pathname = usePathname();
  const { lang, theme, t, switchLang, toggleTheme } = useUiPrefs();

  const isDashboard = pathname === "/";

  return (
    <>
      <div className="lang-switch" role="group" aria-label="Language">
        <button
          type="button"
          className={lang === "ko" ? "lang-btn active" : "lang-btn"}
          onClick={() => switchLang("ko")}
        >
          {t.langKo}
        </button>
        <button
          type="button"
          className={lang === "en" ? "lang-btn active" : "lang-btn"}
          onClick={() => switchLang("en")}
        >
          {t.langEn}
        </button>
      </div>

      <div className="theme-switch">
        <button type="button" className="theme-btn" onClick={toggleTheme}>
          {theme === "dark" ? t.themeLight : t.themeDark}
        </button>
      </div>

      <div className="nav-fab">
        {isDashboard ? (
          <Link className="nav-btn" href="/tools">
            {t.navTools}
          </Link>
        ) : (
          <Link className="nav-btn" href="/">
            {t.navDashboard}
          </Link>
        )}
      </div>
    </>
  );
}
