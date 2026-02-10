import { createHash } from "crypto";

export const USER_COOKIE_NAME = "vcld_user";

export function sanitizeUserId(raw: string | null | undefined): string | null {
  const value = (raw || "").trim();
  if (!value) return null;
  if (value.length > 64) return null;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._@-]*$/.test(value)) return null;
  return value;
}

function parseCookieHeader(cookieHeader: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;

  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx);
    const rawValue = trimmed.slice(idx + 1);
    try {
      out[key] = decodeURIComponent(rawValue);
    } catch {
      out[key] = rawValue;
    }
  }

  return out;
}

export function getUserIdFromRequest(request: Request): string | null {
  const cookies = parseCookieHeader(request.headers.get("cookie"));
  return sanitizeUserId(cookies[USER_COOKIE_NAME]);
}

export function userKeyFromUserId(userId: string): string {
  return createHash("sha256").update(userId).digest("hex").slice(0, 16);
}
