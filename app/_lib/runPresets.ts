import {
  buildDefaultPresetState,
  type PresetState,
  type SitemapScopeEntry,
} from "./sitemapDenylist";

export type VerifySslMode = "default" | "verify" | "no-verify";

export type RunConfigSnapshot = {
  domain: string;
  loginEnabled: boolean;
  loginUser: string;
  loginPassword?: string;
  loginPath: string;
  logoutPath: string;
  verifySsl: VerifySslMode;
  disableWarnings: boolean;
  sitemapScopeEnabled: boolean;
  sitemapScopeAutoAllowSubdomains: boolean;
  sitemapScopes: SitemapScopeEntry[];
  sitemapDenylistEnabled: boolean;
  sitemapPresetEnabled: PresetState;
  sitemapRememberCustom: boolean;
  sitemapCustomDenylist: string;
};

export type RunConfigPreset = {
  id: string;
  name: string;
  createdAt: string;
  config: RunConfigSnapshot;
};

const STORAGE_KEY = "vcld.runConfigPresets.v1";
const MAX_PRESETS = 30;

function limitString(value: string, maxLen: number): string {
  if (value.length <= maxLen) return value;
  return value.slice(0, maxLen);
}

function sanitizeName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return limitString(raw.trim(), 64);
}

function sanitizeVerifySsl(raw: unknown): VerifySslMode {
  if (raw === "default" || raw === "verify" || raw === "no-verify") {
    return raw;
  }
  return "default";
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

function sanitizeScopeEntry(raw: unknown): SitemapScopeEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const id = typeof obj.id === "string" ? obj.id.trim() : "";
  const value = typeof obj.value === "string" ? obj.value.trim() : "";
  if (!value) return null;

  const allowSubdomains = typeof obj.allowSubdomains === "boolean" ? obj.allowSubdomains : true;
  const enabled = typeof obj.enabled === "boolean" ? obj.enabled : true;

  return {
    id: (id || value).slice(0, 64),
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

function sanitizeSnapshot(raw: unknown): RunConfigSnapshot {
  const defaultsPresets = buildDefaultPresetState();
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  const domain = typeof obj.domain === "string" ? limitString(obj.domain.trim(), 512) : "";
  const loginEnabled = typeof obj.loginEnabled === "boolean" ? obj.loginEnabled : false;
  const loginUser = typeof obj.loginUser === "string" ? limitString(obj.loginUser.trim(), 256) : "";
  const loginPassword =
    typeof obj.loginPassword === "string" ? limitString(obj.loginPassword, 512) : undefined;
  const loginPath = typeof obj.loginPath === "string" ? limitString(obj.loginPath.trim(), 256) : "/api/auth/login";
  const logoutPath = typeof obj.logoutPath === "string" ? limitString(obj.logoutPath.trim(), 256) : "/api/auth/logout";
  const verifySsl = sanitizeVerifySsl(obj.verifySsl);
  const disableWarnings = typeof obj.disableWarnings === "boolean" ? obj.disableWarnings : false;

  const sitemapScopeEnabled =
    typeof obj.sitemapScopeEnabled === "boolean" ? obj.sitemapScopeEnabled : true;
  const sitemapScopeAutoAllowSubdomains =
    typeof obj.sitemapScopeAutoAllowSubdomains === "boolean"
      ? obj.sitemapScopeAutoAllowSubdomains
      : true;
  const sitemapScopes = sanitizeScopeEntries(obj.sitemapScopes);

  const sitemapDenylistEnabled =
    typeof obj.sitemapDenylistEnabled === "boolean" ? obj.sitemapDenylistEnabled : true;
  const sitemapPresetEnabled = mergePresetState(defaultsPresets, obj.sitemapPresetEnabled);
  const sitemapRememberCustom =
    typeof obj.sitemapRememberCustom === "boolean" ? obj.sitemapRememberCustom : false;
  const sitemapCustomDenylist =
    typeof obj.sitemapCustomDenylist === "string"
      ? limitString(obj.sitemapCustomDenylist, 4096)
      : "";

  return {
    domain,
    loginEnabled,
    loginUser,
    loginPassword,
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
}

function sanitizePreset(raw: unknown): RunConfigPreset | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  const id = typeof obj.id === "string" ? obj.id.trim() : "";
  if (!id) return null;

  const name = sanitizeName(obj.name);
  if (!name) return null;

  const createdAt = typeof obj.createdAt === "string" ? obj.createdAt : "";
  const config = sanitizeSnapshot(obj.config);
  return { id, name, createdAt, config };
}

export function loadRunConfigPresets(): RunConfigPreset[] {
  if (typeof window === "undefined") return [];

  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return [];
  }

  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  const presets = parsed
    .map((item) => sanitizePreset(item))
    .filter((item): item is RunConfigPreset => item !== null);

  return presets.slice(0, MAX_PRESETS);
}

export function saveRunConfigPresets(presets: RunConfigPreset[]) {
  if (typeof window === "undefined") return;
  try {
    const trimmed = presets.slice(0, MAX_PRESETS);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Ignore storage/quota errors.
  }
}

export function generatePresetId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
