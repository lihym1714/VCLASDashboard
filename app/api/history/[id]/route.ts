import { existsSync } from "fs";
import { NextRequest, NextResponse } from "next/server";

import { appendAuditEvent } from "../../_shared/audit";
import { getHistoryRecordDir, listArtifacts, readMeta } from "../../_shared/history";
import { getUserIdFromRequest } from "../../_shared/user";

export const runtime = "nodejs";

type Params = {
  params: {
    id: string;
  };
};

type Context = {
  params: Promise<Params["params"]>;
};

export async function GET(request: NextRequest, { params }: Context) {
  const userId = getUserIdFromRequest(request) || "guest";
  const resolved = await params;
  const recordId = (resolved.id || "").trim();

  const isValidId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    recordId
  );

  try {
    await appendAuditEvent({
      userId,
      type: "history.detail",
      path: "/api/history/[id]",
      method: "GET",
      historyId: recordId,
      ip: request.headers.get("x-real-ip") || undefined,
      ua: request.headers.get("user-agent") || undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[audit] failed to append history.detail: ${message}`);
  }

  if (!recordId) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  if (!isValidId) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const recordDir = getHistoryRecordDir(userId, recordId);
  if (!existsSync(recordDir)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const meta = await readMeta(recordDir);
  const artifacts = await listArtifacts(recordDir);
  return NextResponse.json({ userId, meta, artifacts });
}
