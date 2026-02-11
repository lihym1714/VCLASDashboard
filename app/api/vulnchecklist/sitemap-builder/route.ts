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

import {
  isValidTarget,
  normalizeDenylist,
  normalizeHostList,
  pythonBin,
  readText,
  runCommand,
  vulnRoot,
} from "../_shared";

export const runtime = "nodejs";

type Body = {
  startUrl: string;
  maxDepth?: number;
  denylist?: string[];
  scopeExact?: string[];
  scopeDomains?: string[];
};

export async function POST(request: Request) {
  const userId = getUserIdFromRequest(request) || "guest";
  let history: { id: string; recordDir: string } | null = null;

  try {
    const body = (await request.json()) as Body;
    const startUrl = (body.startUrl || "").trim();
    if (!startUrl) {
      return NextResponse.json(
        { error: "Start URL is required." },
        { status: 400 }
      );
    }
    if (!isValidTarget(startUrl)) {
      return NextResponse.json(
        { error: "Start URL contains invalid characters." },
        { status: 400 }
      );
    }
    if (!existsSync(vulnRoot)) {
      return NextResponse.json(
        { error: "VulnCheckList root directory not found." },
        { status: 500 }
      );
    }

    const depth = Number.isFinite(body.maxDepth) ? Number(body.maxDepth) : 2;
    const maxDepth = Math.max(0, Math.min(20, depth));
    const denylist = normalizeDenylist(body.denylist);
    const scopeExact = normalizeHostList(body.scopeExact);
    const scopeDomains = normalizeHostList(body.scopeDomains);

    const dataDir = path.join(vulnRoot, "data");
    await fs.mkdir(dataDir, { recursive: true });
    const sitemapPath = path.join(dataDir, "sitemap_tree.txt");

    history = await createHistoryRecord({
      userId,
      kind: "sitemap-builder",
      target: startUrl,
      requestBody: body,
    });

    await fs.rm(sitemapPath, { force: true });

    const args = ["information_scrp/sitemap_builder.py", startUrl, String(maxDepth)];
    for (const pattern of denylist) {
      args.push("--deny", pattern);
    }

    for (const host of scopeExact) {
      args.push("--scope", host);
    }
    for (const domain of scopeDomains) {
      args.push("--scope-subdomains", domain);
    }

    const cmd = await runCommand(pythonBin, args, vulnRoot, 20 * 60 * 1000);

    const sitemapTree = await readText(sitemapPath);
    const log = cmd.output || "";

    await writeArtifactText(history.recordDir, "log.txt", log);
    await copyArtifact(history.recordDir, sitemapPath, "sitemap_tree.txt");

    const ok = cmd.exitCode === 0;
    const responseBody = {
      historyId: history.id,
      log,
      sitemapTree,
      error: ok ? undefined : "Sitemap builder failed. Check log for details.",
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
