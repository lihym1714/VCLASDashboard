"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type Lang = "ko" | "en";
export type Theme = "light" | "dark";

type Dict = Record<string, string>;

const DICT: Record<Lang, Dict> = {
  en: {
    navDashboard: "Dashboard",
    navTools: "Tools",
    langKo: "Korean",
    langEn: "English",
    themeLight: "Light",
    themeDark: "Dark",
    back: "Back",
    status: "Status",
    input: "Input",
    output: "Output",
    log: "Log",
    run: "Run",
    running: "Running...",
    noResultsYet: "No results yet.",
    failed: "Failed.",
    unexpectedError: "Unexpected error.",
  },
  ko: {
    navDashboard: "대시보드",
    navTools: "기능별 도구",
    langKo: "한국어",
    langEn: "English",
    themeLight: "라이트",
    themeDark: "다크",
    back: "뒤로",
    status: "상태",
    input: "입력",
    output: "출력",
    log: "로그",
    run: "실행",
    running: "실행 중...",
    noResultsYet: "결과가 없습니다.",
    failed: "실행에 실패했습니다.",
    unexpectedError: "예상치 못한 오류가 발생했습니다.",
  },
};

export function useUiPrefs() {
  const ctx = useContext(UiPrefsContext);
  if (!ctx) {
    throw new Error("useUiPrefs must be used within UiPrefsProvider");
  }
  return ctx;
}

type UiPrefsValue = {
  lang: Lang;
  theme: Theme;
  t: Dict;
  switchLang: (next: Lang) => void;
  toggleTheme: () => void;
};

const UiPrefsContext = createContext<UiPrefsValue | null>(null);

export function UiPrefsProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<Lang>("en");
  const [theme, setTheme] = useState<Theme>("light");

  const t = useMemo(() => DICT[lang], [lang]);

  useEffect(() => {
    const storedLang = window.localStorage.getItem("vcld_lang");
    if (storedLang === "ko" || storedLang === "en") {
      setLang(storedLang);
    }

    const storedTheme = window.localStorage.getItem("vcld_theme");
    if (storedTheme === "light" || storedTheme === "dark") {
      setTheme(storedTheme);
      document.documentElement.dataset.theme = storedTheme;
    } else {
      document.documentElement.dataset.theme = "light";
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("vcld_theme", theme);
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem("vcld_lang", lang);
  }, [lang]);

  const switchLang = (next: Lang) => {
    setLang(next);
  };

  const toggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  };

  const value: UiPrefsValue = {
    lang,
    theme,
    t,
    switchLang,
    toggleTheme,
  };

  return <UiPrefsContext.Provider value={value}>{children}</UiPrefsContext.Provider>;
}
