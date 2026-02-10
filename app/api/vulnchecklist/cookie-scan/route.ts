import { NextResponse } from "next/server";
import { existsSync } from "fs";

import {
  createHistoryRecord,
  finalizeHistoryRecord,
  writeArtifactText,
} from "../../_shared/history";
import { getUserIdFromRequest } from "../../_shared/user";

import { isValidTarget, pythonBin, runCommand, vulnRoot } from "../_shared";

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
  const userId = getUserIdFromRequest(request) || "guest";
  let history: { id: string; recordDir: string } | null = null;

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

    history = await createHistoryRecord({
      userId,
      kind: "cookie-scan",
      target: url,
      requestBody: body,
    });

    const timeoutSeconds = Number.isFinite(body.timeout)
      ? Math.max(1, Math.min(60, Number(body.timeout)))
      : 5;

    const cmd = await runCommand(
      pythonBin,
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

    const log = cmd.output || "";
    await writeArtifactText(history.recordDir, "log.txt", log);
    await writeArtifactText(history.recordDir, "raw.json.txt", raw);

    const ok = cmd.exitCode === 0;
    const responseBody = {
      historyId: history.id,
      log,
      cookies,
      mfaDetected,
      rawJson: raw,
      error: ok ? undefined : "Cookie scan failed. Check log for details.",
    };

    await finalizeHistoryRecord({
      recordDir: history.recordDir,
      status: ok ? "success" : "error",
      error: responseBody.error,
      responseBody,
    });

    return NextResponse.json(responseBody);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";

    if (history) {
      await finalizeHistoryRecord({
        recordDir: history.recordDir,
        status: "error",
        error: message,
        responseBody: { historyId: history.id, error: message },
      });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
