import fs from "fs/promises";
import path from "path";

import { vulnRoot } from "../vulnchecklist/_shared";
import { userKeyFromUserId } from "./user";

export type AuditEvent = {
  ts: string;
  userId: string;
  type: string;
  path?: string;
  method?: string;
  status?: number;
  durationMs?: number;
  historyId?: string;
  kind?: string;
  target?: string;
  artifact?: string;
  ip?: string;
  ua?: string;
  extra?: Record<string, string | number | boolean | null>;
};

const AUDIT_DIR_NAME = "audit";

function limitString(value: string, maxLen: number): string {
  if (value.length <= maxLen) return value;
  return value.slice(0, maxLen);
}

function sanitizeType(raw: string): string {
  const value = raw.trim();
  if (!value) return "unknown";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)) return "unknown";
  return limitString(value, 64);
}

function sanitizeOptionalString(raw: unknown, maxLen: number): string | undefined {
  if (typeof raw !== "string") return undefined;
  const value = raw.trim();
  if (!value) return undefined;
  return limitString(value, maxLen);
}

function sanitizeOptionalNumber(raw: unknown, min: number, max: number): number | undefined {
  if (typeof raw !== "number") return undefined;
  if (!Number.isFinite(raw)) return undefined;
  const clamped = Math.max(min, Math.min(max, raw));
  return Math.round(clamped);
}

function currentDateKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function auditRootDir(): string {
  return path.join(vulnRoot, "data", AUDIT_DIR_NAME);
}

export async function appendAuditEvent(input: {
  userId: string;
  type: string;
  path?: string;
  method?: string;
  status?: number;
  durationMs?: number;
  historyId?: string;
  kind?: string;
  target?: string;
  artifact?: string;
  ip?: string;
  ua?: string;
  extra?: Record<string, unknown>;
}) {
  const userId = (input.userId || "guest").trim() || "guest";
  const now = new Date();
  const userKey = userKeyFromUserId(userId);
  const dir = path.join(auditRootDir(), userKey);
  await fs.mkdir(dir, { recursive: true });

  const record: AuditEvent = {
    ts: now.toISOString(),
    userId,
    type: sanitizeType(input.type),
    path: sanitizeOptionalString(input.path, 256),
    method: sanitizeOptionalString(input.method, 16),
    status: sanitizeOptionalNumber(input.status, 0, 999),
    durationMs: sanitizeOptionalNumber(input.durationMs, 0, 86_400_000),
    historyId: sanitizeOptionalString(input.historyId, 128),
    kind: sanitizeOptionalString(input.kind, 64),
    target: sanitizeOptionalString(input.target, 512),
    artifact: sanitizeOptionalString(input.artifact, 128),
    ip: sanitizeOptionalString(input.ip, 128),
    ua: sanitizeOptionalString(input.ua, 256),
  };

  if (input.extra && typeof input.extra === "object") {
    const extra: Record<string, string | number | boolean | null> = {};
    for (const [key, rawValue] of Object.entries(input.extra)) {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(key)) continue;
      if (typeof rawValue === "string") {
        extra[key] = limitString(rawValue, 256);
      } else if (typeof rawValue === "number") {
        if (Number.isFinite(rawValue)) extra[key] = rawValue;
      } else if (typeof rawValue === "boolean") {
        extra[key] = rawValue;
      } else if (rawValue === null) {
        extra[key] = null;
      }
    }
    if (Object.keys(extra).length) {
      record.extra = extra;
    }
  }

  const filePath = path.join(dir, `${currentDateKey(now)}.ndjson`);
  await fs.appendFile(filePath, JSON.stringify(record) + "\n", "utf-8");
}
