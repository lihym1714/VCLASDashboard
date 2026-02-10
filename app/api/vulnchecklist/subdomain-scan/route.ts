import { NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";

import {
  copyArtifact,
  createHistoryRecord,
  finalizeHistoryRecord,
  writeArtifactText,
} from "../../_shared/history";
import { getUserIdFromRequest } from "../../_shared/user";

import { isValidTarget, pythonBin, readLines, runCommand, vulnRoot } from "../_shared";

export const runtime = "nodejs";

type Body = {
  domain: string;
};

export async function POST(request: Request) {
  const userId = getUserIdFromRequest(request) || "guest";
  let history: { id: string; recordDir: string } | null = null;

  try {
    const body = (await request.json()) as Body;
    const domain = (body.domain || "").trim();

    if (!domain) {
      return NextResponse.json({ error: "Domain is required." }, { status: 400 });
    }
    if (!isValidTarget(domain)) {
      return NextResponse.json(
        { error: "Domain contains invalid characters." },
        { status: 400 }
      );
    }
    if (!existsSync(vulnRoot)) {
      return NextResponse.json(
        { error: "VulnCheckList root directory not found." },
        { status: 500 }
      );
    }

    const dataDir = path.join(vulnRoot, "data");
    await fs.mkdir(dataDir, { recursive: true });
    const subdomainsPath = path.join(dataDir, "subdomains.txt");

    history = await createHistoryRecord({
      userId,
      kind: "subdomain-scan",
      target: domain,
      requestBody: body,
    });

    await fs.rm(subdomainsPath, { force: true });

    const cmd = await runCommand(
      pythonBin,
      ["information_scrp/subdomain_scan.py", domain],
      vulnRoot,
      10 * 60 * 1000
    );

    const subdomains = await readLines(subdomainsPath);
    const log = `[*] Subdomain scan\n${cmd.output}\n`;

    await writeArtifactText(history.recordDir, "log.txt", log);
    await copyArtifact(history.recordDir, subdomainsPath, "subdomains.txt");

    const ok = cmd.exitCode === 0;
    const responseBody = {
      historyId: history.id,
      log,
      subdomains,
      error: ok ? undefined : "Subdomain scan failed. Check log for details.",
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
