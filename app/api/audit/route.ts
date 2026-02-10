import { NextResponse } from "next/server";

import { appendAuditEvent } from "../_shared/audit";
import { getUserIdFromRequest } from "../_shared/user";

export const runtime = "nodejs";

type Body = {
  type?: string;
  path?: string;
  historyId?: string;
  kind?: string;
  target?: string;
  artifact?: string;
  from?: string;
  to?: string;
};

function firstForwardedIp(value: string | null): string | undefined {
  if (!value) return undefined;
  const first = value.split(",")[0]?.trim();
  return first || undefined;
}

export async function POST(request: Request) {
  const userId = getUserIdFromRequest(request) || "guest";

  let body: Body = {};
  try {
    body = (await request.json()) as Body;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid JSON";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const ip =
    firstForwardedIp(request.headers.get("x-forwarded-for")) ||
    request.headers.get("x-real-ip") ||
    undefined;
  const ua = request.headers.get("user-agent") || undefined;

  try {
    await appendAuditEvent({
      userId,
      type: body.type || "client.event",
      path: body.path,
      historyId: body.historyId,
      kind: body.kind,
      target: body.target,
      artifact: body.artifact,
      ip,
      ua,
      extra: {
        from: body.from,
        to: body.to,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Audit write failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
