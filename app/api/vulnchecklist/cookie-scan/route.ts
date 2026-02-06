import { NextResponse } from "next/server";
import { existsSync } from "fs";

import { isValidTarget, runCommand, vulnRoot } from "../_shared";

export const runtime = "nodejs";

type CookieItem = {
  name: string;
  value: string | null;
  raw_header: string;
};

type Body = {
  url: string;
  timeout?: number;
};

type CookieScanJson = {
  cookies?: CookieItem[];
  mfa_detected?: boolean;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    const url = (body.url || "").trim();
    if (!url) {
      return NextResponse.json({ error: "URL is required." }, { status: 400 });
    }
    if (!isValidTarget(url)) {
      return NextResponse.json(
        { error: "URL contains invalid characters." },
        { status: 400 }
      );
    }
    if (!existsSync(vulnRoot)) {
      return NextResponse.json(
        { error: "VulnCheckList root directory not found." },
        { status: 500 }
      );
    }

    const timeoutSeconds = Number.isFinite(body.timeout)
      ? Math.max(1, Math.min(60, Number(body.timeout)))
      : 5;

    const cmd = await runCommand(
      "python3",
      [
        "information_scrp/cookie_scan.py",
        url,
        "--timeout",
        String(timeoutSeconds),
        "--json",
      ],
      vulnRoot,
      5 * 60 * 1000
    );

    const raw = (cmd.output || "").trim();
    let parsed: CookieScanJson = {};
    try {
      parsed = JSON.parse(raw) as CookieScanJson;
    } catch {
      parsed = {};
    }

    const cookies = Array.isArray(parsed.cookies) ? parsed.cookies : [];
    const mfaDetected = Boolean(parsed.mfa_detected);

    return NextResponse.json({
      log: cmd.output || "",
      cookies,
      mfaDetected,
      rawJson: raw,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
