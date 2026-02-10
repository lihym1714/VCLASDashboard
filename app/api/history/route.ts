import { existsSync } from "fs";
import fs from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

import { appendAuditEvent } from "../_shared/audit";
import type { HistoryMeta } from "../_shared/history";
import { getHistoryRoot, readMeta } from "../_shared/history";
import { getUserIdFromRequest, userKeyFromUserId } from "../_shared/user";

export const runtime = "nodejs";

function firstForwardedIp(value: string | null): string | undefined {
  if (!value) return undefined;
  const first = value.split(",")[0]?.trim();
  return first || undefined;
}

export async function GET(request: Request) {
  const userId = getUserIdFromRequest(request) || "guest";
  const url = new URL(request.url);
  const kind = (url.searchParams.get("kind") || "").trim();
  const limitRaw = url.searchParams.get("limit");
  const parsedLimit = limitRaw === null ? Number.NaN : Number(limitRaw);
  const limit = Number.isFinite(parsedLimit) ? parsedLimit : 50;
  const max = Math.max(1, Math.min(200, limit));

  try {
    await appendAuditEvent({
      userId,
      type: "history.list",
      path: "/api/history",
      method: "GET",
      ip:
        firstForwardedIp(request.headers.get("x-forwarded-for")) ||
        request.headers.get("x-real-ip") ||
        undefined,
      ua: request.headers.get("user-agent") || undefined,
      extra: {
        kind,
        limit: max,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[audit] failed to append history.list: ${message}`);
  }

  const userDir = path.join(getHistoryRoot(), userKeyFromUserId(userId));
  if (!existsSync(userDir)) {
    return NextResponse.json({ userId, records: [] as HistoryMeta[] });
  }

  const entries = await fs.readdir(userDir, { withFileTypes: true });
  const recordDirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(userDir, entry.name));

  const metas = await Promise.all(recordDirs.map((dir) => readMeta(dir)));
  const records = metas.filter((meta): meta is HistoryMeta => meta !== null);
  const filtered = kind ? records.filter((meta) => meta.kind === kind) : records;
  const sorted = filtered.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

  return NextResponse.json({ userId, records: sorted.slice(0, max) });
}
