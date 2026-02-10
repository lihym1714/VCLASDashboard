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

type Body = {
  host: string;
};

export async function POST(request: Request) {
  const userId = getUserIdFromRequest(request) || "guest";
  let history: { id: string; recordDir: string } | null = null;

  try {
    const body = (await request.json()) as Body;
    const host = (body.host || "").trim();
    if (!host) {
      return NextResponse.json({ error: "Host is required." }, { status: 400 });
    }
    if (!isValidTarget(host)) {
      return NextResponse.json(
        { error: "Host contains invalid characters." },
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
      kind: "port-scan",
      target: host,
      requestBody: body,
    });

    const cmd = await runCommand(
      pythonBin,
      ["information_scrp/port_scan.py", host],
      vulnRoot,
      5 * 60 * 1000
    );

    const log = cmd.output || "";
    await writeArtifactText(history.recordDir, "log.txt", log);

    const ok = cmd.exitCode === 0;
    const responseBody = {
      historyId: history.id,
      log,
      error: ok ? undefined : "Port scan failed. Check log for details.",
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
