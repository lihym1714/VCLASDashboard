export type DenylistPresetItem = {
  id: string;
  labelEn: string;
  labelKo: string;
  patterns: string[];
};

export type DenylistPresetGroup = {
  id: string;
  titleEn: string;
  titleKo: string;
  items: DenylistPresetItem[];
};

export type PresetState = Record<string, boolean>;

export type SitemapScopeEntry = {
  id: string;
  value: string;
  allowSubdomains: boolean;
  enabled: boolean;
};

export const SITEMAP_DENYLIST_PRESETS: DenylistPresetGroup[] = [
  {
    id: "dev",
    titleEn: "Developer domains",
    titleKo: "개발자 관련 도메인",
    items: [
      {
        id: "github",
        labelEn: "GitHub",
        labelKo: "GitHub",
        patterns: ["github.com", "github.io", "githubusercontent.com"],
      },
      {
        id: "gitlab",
        labelEn: "GitLab",
        labelKo: "GitLab",
        patterns: ["gitlab.com"],
      },
      {
        id: "bitbucket",
        labelEn: "Bitbucket",
        labelKo: "Bitbucket",
        patterns: ["bitbucket.org"],
      },
      {
        id: "stackoverflow",
        labelEn: "Stack Overflow",
        labelKo: "Stack Overflow",
        patterns: ["stackoverflow.com", "stackexchange.com"],
      },
      {
        id: "npm",
        labelEn: "npm",
        labelKo: "npm",
        patterns: ["npmjs.com"],
      },
      {
        id: "pypi",
        labelEn: "PyPI",
        labelKo: "PyPI",
        patterns: ["pypi.org"],
      },
    ],
  },
  {
    id: "sns",
    titleEn: "SNS / communities",
    titleKo: "SNS / 커뮤니티",
    items: [
      {
        id: "facebook",
        labelEn: "Facebook",
        labelKo: "Facebook",
        patterns: ["facebook.com", "fb.com"],
      },
      {
        id: "instagram",
        labelEn: "Instagram",
        labelKo: "Instagram",
        patterns: ["instagram.com"],
      },
      {
        id: "twitter",
        labelEn: "X / Twitter",
        labelKo: "X / Twitter",
        patterns: ["twitter.com", "x.com", "t.co"],
      },
      {
        id: "linkedin",
        labelEn: "LinkedIn",
        labelKo: "LinkedIn",
        patterns: ["linkedin.com"],
      },
      {
        id: "youtube",
        labelEn: "YouTube",
        labelKo: "YouTube",
        patterns: ["youtube.com", "youtu.be"],
      },
      {
        id: "tiktok",
        labelEn: "TikTok",
        labelKo: "TikTok",
        patterns: ["tiktok.com"],
      },
      {
        id: "discord",
        labelEn: "Discord",
        labelKo: "Discord",
        patterns: ["discord.gg", "discord.com"],
      },
      {
        id: "reddit",
        labelEn: "Reddit",
        labelKo: "Reddit",
        patterns: ["reddit.com"],
      },
      {
        id: "telegram",
        labelEn: "Telegram",
        labelKo: "Telegram",
        patterns: ["t.me", "telegram.me", "telegram.org"],
      },
    ],
  },
];

export const DENYLIST_PATTERN_RE = /^=?[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export type SitemapDenylistPrefs = {
  enabled: boolean;
  presets: PresetState;
  scopeEnabled: boolean;
  scopeAutoAllowSubdomains: boolean;
  scopes: SitemapScopeEntry[];
  rememberCustom: boolean;
  custom: string;
};

const STORAGE_KEY = "vcld.sitemapDenylist.v1";

export function buildDefaultPresetState(): PresetState {
  const state: PresetState = {};
  for (const group of SITEMAP_DENYLIST_PRESETS) {
    for (const item of group.items) {
      state[item.id] = true;
    }
  }
  return state;
}

function mergePresetState(defaults: PresetState, raw: unknown): PresetState {
  const out: PresetState = { ...defaults };

  if (!raw || typeof raw !== "object") return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!(key in defaults)) continue;
    if (typeof value !== "boolean") continue;
    out[key] = value;
  }
  return out;
}

export function defaultSitemapDenylistPrefs(): SitemapDenylistPrefs {
  return {
    enabled: true,
    presets: buildDefaultPresetState(),
    scopeEnabled: true,
    scopeAutoAllowSubdomains: true,
    scopes: [],
    rememberCustom: false,
    custom: "",
  };
}

function sanitizeScopeEntry(raw: unknown): SitemapScopeEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const id = typeof obj.id === "string" ? obj.id.trim() : "";
  const value = typeof obj.value === "string" ? obj.value.trim() : "";
  if (!id || !value) return null;

  const allowSubdomains = typeof obj.allowSubdomains === "boolean" ? obj.allowSubdomains : true;
  const enabled = typeof obj.enabled === "boolean" ? obj.enabled : true;

  return {
    id: id.slice(0, 64),
    value: value.slice(0, 512),
    allowSubdomains,
    enabled,
  };
}

function sanitizeScopeEntries(raw: unknown): SitemapScopeEntry[] {
  if (!Array.isArray(raw)) return [];
  const entries = raw
    .map((item) => sanitizeScopeEntry(item))
    .filter((item): item is SitemapScopeEntry => item !== null);

  const seen = new Set<string>();
  const out: SitemapScopeEntry[] = [];
  for (const entry of entries) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push(entry);
    if (out.length >= 64) break;
  }
  return out;
}

export function loadSitemapDenylistPrefs(): SitemapDenylistPrefs {
  const defaults = defaultSitemapDenylistPrefs();
  if (typeof window === "undefined") return defaults;

  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return defaults;
  }
  if (!raw) return defaults;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return defaults;
  }

  if (!parsed || typeof parsed !== "object") return defaults;
  const obj = parsed as Record<string, unknown>;

  const enabled = typeof obj.enabled === "boolean" ? obj.enabled : defaults.enabled;
  const scopeEnabled =
    typeof obj.scopeEnabled === "boolean" ? obj.scopeEnabled : defaults.scopeEnabled;
  const scopeAutoAllowSubdomains =
    typeof obj.scopeAutoAllowSubdomains === "boolean"
      ? obj.scopeAutoAllowSubdomains
      : defaults.scopeAutoAllowSubdomains;
  const scopes = sanitizeScopeEntries(obj.scopes);
  const rememberCustom =
    typeof obj.rememberCustom === "boolean" ? obj.rememberCustom : defaults.rememberCustom;
  const presets = mergePresetState(defaults.presets, obj.presets);
  const customRaw = typeof obj.custom === "string" ? obj.custom : "";
  const custom = rememberCustom ? customRaw.slice(0, 4096) : "";

  return {
    enabled,
    presets,
    scopeEnabled,
    scopeAutoAllowSubdomains,
    scopes,
    rememberCustom,
    custom,
  };
}

export function saveSitemapDenylistPrefs(next: SitemapDenylistPrefs) {
  if (typeof window === "undefined") return;

  const defaults = defaultSitemapDenylistPrefs();
  const safe: SitemapDenylistPrefs = {
    enabled: Boolean(next.enabled),
    presets: mergePresetState(defaults.presets, next.presets),
    scopeEnabled: Boolean(next.scopeEnabled),
    scopeAutoAllowSubdomains: Boolean(next.scopeAutoAllowSubdomains),
    scopes: sanitizeScopeEntries(next.scopes),
    rememberCustom: Boolean(next.rememberCustom),
    custom: next.rememberCustom ? String(next.custom || "").slice(0, 4096) : "",
  };

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
  } catch {
    // Ignore storage/quota errors.
  }
}

export function normalizeDenylistPatterns(value: string[]): string[] {
  const normalized = value
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .filter((item) => item.length <= 64)
    .filter((item) => DENYLIST_PATTERN_RE.test(item));

  return Array.from(new Set(normalized)).slice(0, 64);
}
