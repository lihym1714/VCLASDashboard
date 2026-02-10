import { NextResponse } from "next/server";

import { appendAuditEvent } from "../_shared/audit";
import { getUserIdFromRequest, sanitizeUserId, USER_COOKIE_NAME } from "../_shared/user";

export const runtime = "nodejs";

type LoginBody = {
  userId?: string;
  days?: number;
};

function firstForwardedIp(value: string | null): string | undefined {
  if (!value) return undefined;
  const first = value.split(",")[0]?.trim();
  return first || undefined;
}

function clampDays(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 30;
  return Math.max(1, Math.min(365, Math.floor(raw)));
}

export async function GET(request: Request) {
  const userId = getUserIdFromRequest(request) || "guest";
  return NextResponse.json({ userId });
}

export async function POST(request: Request) {
  const prevUserId = getUserIdFromRequest(request) || "guest";

  let body: LoginBody = {};
  try {
    body = (await request.json()) as LoginBody;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid JSON";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const nextUserId = sanitizeUserId(body.userId);
  if (!nextUserId) {
    return NextResponse.json(
      { error: "Invalid userId" },
      { status: 400 }
    );
  }

  const days = clampDays(body.days);
  const res = NextResponse.json({ ok: true, userId: nextUserId });
  res.cookies.set({
    name: USER_COOKIE_NAME,
    value: nextUserId,
    path: "/",
    maxAge: days * 24 * 60 * 60,
    sameSite: "lax",
    httpOnly: false,
  });

  try {
    const ip =
      firstForwardedIp(request.headers.get("x-forwarded-for")) ||
      request.headers.get("x-real-ip") ||
      undefined;
    const ua = request.headers.get("user-agent") || undefined;

    await appendAuditEvent({
      userId: nextUserId,
      type: "session.set",
      path: "/api/session",
      method: "POST",
      ip,
      ua,
      extra: {
        from: prevUserId,
        to: nextUserId,
        days,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[audit] failed to append session.set: ${message}`);
  }

  return res;
}

export async function DELETE(request: Request) {
  const prevUserId = getUserIdFromRequest(request) || "guest";
  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: USER_COOKIE_NAME,
    value: "",
    path: "/",
    maxAge: 0,
    sameSite: "lax",
    httpOnly: false,
  });

  try {
    const ip =
      firstForwardedIp(request.headers.get("x-forwarded-for")) ||
      request.headers.get("x-real-ip") ||
      undefined;
    const ua = request.headers.get("user-agent") || undefined;

    await appendAuditEvent({
      userId: prevUserId,
      type: "session.clear",
      path: "/api/session",
      method: "DELETE",
      ip,
      ua,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[audit] failed to append session.clear: ${message}`);
  }

  return res;
}
