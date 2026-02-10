import { existsSync } from "fs";
import fs from "fs/promises";
import path from "path";

import { NextRequest } from "next/server";

import { appendAuditEvent } from "../../../../_shared/audit";
import { getHistoryRecordDir } from "../../../../_shared/history";
import { getUserIdFromRequest } from "../../../../_shared/user";

export const runtime = "nodejs";

type Params = {
  params: {
    id: string;
    name: string;
  };
};

type Context = {
  params: Promise<Params["params"]>;
};

function contentTypeFor(name: string): string {
  const ext = path.extname(name).toLowerCase();
  switch (ext) {
    case ".json":
      return "application/json; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".txt":
    case ".log":
      return "text/plain; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

export async function GET(request: NextRequest, { params }: Context) {
  const userId = getUserIdFromRequest(request) || "guest";
  const resolved = await params;
  const recordId = (resolved.id || "").trim();
  const requested = (resolved.name || "").trim();

  const isValidId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    recordId
  );

  try {
    await appendAuditEvent({
      userId,
      type: "history.artifact",
      path: "/api/history/[id]/artifact/[name]",
      method: "GET",
      historyId: recordId,
      artifact: requested,
      ip: request.headers.get("x-real-ip") || undefined,
      ua: request.headers.get("user-agent") || undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[audit] failed to append history.artifact: ${message}`);
  }

  if (!recordId || !requested) {
    return new Response("Bad request", { status: 400 });
  }

  if (!isValidId) {
    return new Response("Bad request", { status: 400 });
  }

  const safeName = path.basename(requested);
  if (safeName !== requested || safeName.includes("..") || safeName.includes("/") || safeName.includes("\\")) {
    return new Response("Bad request", { status: 400 });
  }

  const recordDir = getHistoryRecordDir(userId, recordId);
  if (!existsSync(recordDir)) {
    return new Response("Not found", { status: 404 });
  }

  const filePath = path.join(recordDir, safeName);
  if (!existsSync(filePath)) {
    return new Response("Not found", { status: 404 });
  }

  const data = await fs.readFile(filePath);
  return new Response(data, {
    status: 200,
    headers: {
      "content-type": contentTypeFor(safeName),
      "content-disposition": `inline; filename="${safeName}"`,
    },
  });
}
