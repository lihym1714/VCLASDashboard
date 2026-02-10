import { randomUUID } from "crypto";
import { existsSync } from "fs";
import fs from "fs/promises";
import path from "path";

import { vulnRoot } from "../vulnchecklist/_shared";
import { appendAuditEvent } from "./audit";
import { userKeyFromUserId } from "./user";

export type HistoryKind =
  | "run"
  | "subdomain-scan"
  | "sitemap-builder"
  | "library-scan"
  | "port-scan"
  | "major-dir-file"
  | "important-search"
  | "cookie-scan";

export type HistoryStatus = "running" | "success" | "error";

export type HistoryMeta = {
  id: string;
  kind: HistoryKind;
  userId: string;
  createdAt: string;
  finishedAt?: string;
  status: HistoryStatus;
  target?: string;
  error?: string | null;
};

export type HistoryArtifact = {
  name: string;
  size: number;
};

const HISTORY_DIR_NAME = "history";
const META_FILE = "meta.json";
const REQUEST_FILE = "request.json";
const RESPONSE_FILE = "response.json";

const SECRET_KEYS = new Set(["loginPassword", "password", "pass", "token", "apiKey"]);

export function getHistoryRoot(): string {
  return path.join(vulnRoot, "data", HISTORY_DIR_NAME);
}

export function getHistoryRecordDir(userId: string, recordId: string): string {
  const userKey = userKeyFromUserId(userId);
  return path.join(getHistoryRoot(), userKey, recordId);
}

export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEYS.has(key)) {
        out[key] = "[redacted]";
        continue;
      }
      out[key] = redactSecrets(child);
    }
    return out;
  }
  return value;
}

async function writeJson(filePath: string, data: unknown) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
}

export async function createHistoryRecord(params: {
  userId: string;
  kind: HistoryKind;
  target?: string;
  requestBody?: unknown;
}): Promise<{ id: string; recordDir: string; meta: HistoryMeta }> {
  const id = randomUUID();
  const recordDir = getHistoryRecordDir(params.userId, id);
  await fs.mkdir(recordDir, { recursive: true });

  const meta: HistoryMeta = {
    id,
    kind: params.kind,
    userId: params.userId,
    createdAt: new Date().toISOString(),
    status: "running",
    target: params.target,
    error: null,
  };

  await writeJson(path.join(recordDir, META_FILE), meta);

  if (params.requestBody !== undefined) {
    const redacted = redactSecrets(params.requestBody);
    await writeJson(path.join(recordDir, REQUEST_FILE), redacted);
  }

  try {
    await appendAuditEvent({
      userId: params.userId,
      type: "history.create",
      historyId: id,
      kind: params.kind,
      target: params.target,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[audit] failed to append history.create: ${message}`);
  }

  return { id, recordDir, meta };
}

export async function finalizeHistoryRecord(params: {
  recordDir: string;
  status: HistoryStatus;
  error?: string | null;
  responseBody?: unknown;
}) {
  const metaPath = path.join(params.recordDir, META_FILE);
  let meta: HistoryMeta | null = null;
  try {
    const raw = await fs.readFile(metaPath, "utf-8");
    meta = JSON.parse(raw) as HistoryMeta;
  } catch {
    meta = null;
  }

  const next: HistoryMeta = {
    ...(meta || {
      id: path.basename(params.recordDir),
      kind: "run" as HistoryKind,
      userId: "unknown",
      createdAt: new Date().toISOString(),
      status: "running" as HistoryStatus,
    }),
    status: params.status,
    finishedAt: new Date().toISOString(),
    error: params.error ?? null,
  };

  await writeJson(metaPath, next);

  if (params.responseBody !== undefined) {
    await writeJson(path.join(params.recordDir, RESPONSE_FILE), params.responseBody);
  }

  try {
    await appendAuditEvent({
      userId: next.userId,
      type: "history.finalize",
      historyId: next.id,
      kind: next.kind,
      target: next.target,
      extra: {
        status: next.status,
        error: next.error,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[audit] failed to append history.finalize: ${message}`);
  }
}

export async function writeArtifactText(recordDir: string, name: string, content: string) {
  await fs.writeFile(path.join(recordDir, name), content, "utf-8");
}

export async function copyArtifact(recordDir: string, srcPath: string, destName?: string) {
  const dest = path.join(recordDir, destName || path.basename(srcPath));
  if (!existsSync(srcPath)) return false;
  await fs.copyFile(srcPath, dest);
  return true;
}

export async function listArtifacts(recordDir: string): Promise<HistoryArtifact[]> {
  const entries = await fs.readdir(recordDir, { withFileTypes: true });
  const artifacts: HistoryArtifact[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const name = entry.name;
    if (name === META_FILE) continue;
    const stat = await fs.stat(path.join(recordDir, name));
    artifacts.push({ name, size: stat.size });
  }

  artifacts.sort((a, b) => a.name.localeCompare(b.name));
  return artifacts;
}

export async function readMeta(recordDir: string): Promise<HistoryMeta | null> {
  try {
    const raw = await fs.readFile(path.join(recordDir, META_FILE), "utf-8");
    return JSON.parse(raw) as HistoryMeta;
  } catch {
    return null;
  }
}

export async function readArtifactText(recordDir: string, name: string, maxChars: number): Promise<string> {
  const filePath = path.join(recordDir, name);
  if (!existsSync(filePath)) return "";
  const content = await fs.readFile(filePath, "utf-8");
  if (content.length > maxChars) {
    return content.slice(0, maxChars) + "\n... (truncated)\n";
  }
  return content;
}

export const HISTORY_FILENAMES = {
  meta: META_FILE,
  request: REQUEST_FILE,
  response: RESPONSE_FILE,
};
