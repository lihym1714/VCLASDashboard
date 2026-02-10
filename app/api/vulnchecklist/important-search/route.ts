import { NextResponse } from "next/server";
import { existsSync } from "fs";

import {
  createHistoryRecord,
  finalizeHistoryRecord,
  writeArtifactText,
} from "../../_shared/history";
import { getUserIdFromRequest } from "../../_shared/user";

import { isValidTarget, normalizePath, pythonBin, runCommand, vulnRoot } from "../_shared";

export const runtime = "nodejs";

type VerifySslMode = "default" | "verify" | "no-verify";

type Body = {
  url: string;
  useSitemap?: boolean;
  sitemapDepth?: number;
  verifySsl?: VerifySslMode;
  loginEnabled?: boolean;
  loginUser?: string;
  loginPassword?: string;
  loginPath?: string;
  logoutPath?: string;
  disableWarnings?: boolean;
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
      kind: "important-search",
      target: url,
      requestBody: body,
    });

    const args = ["information_scrp/important_search.py", url];

    const useSitemap = body.useSitemap ?? true;
    if (useSitemap) {
      args.push("--sitemap");
    } else {
      args.push("--no-sitemap");
    }
    const depth = Number.isFinite(body.sitemapDepth) ? Number(body.sitemapDepth) : 2;
    args.push("--sitemap-depth", String(Math.max(0, Math.min(10, depth))));

    if (body.loginEnabled) {
      args.push("--login");
      if (body.loginUser) args.push("--login-user", body.loginUser);
      if (body.loginPassword) args.push("--login-password", body.loginPassword);
    }

    const loginPath = normalizePath(body.loginPath, "/api/auth/login");
    const logoutPath = normalizePath(body.logoutPath, "/api/auth/logout");
    args.push("--login-path", loginPath);
    args.push("--logout-path", logoutPath);

    if (body.verifySsl === "verify") args.push("--verify-ssl");
    if (body.verifySsl === "no-verify") args.push("--no-verify-ssl");
    if (body.disableWarnings) args.push("--disable-warnings");

    const cmd = await runCommand(pythonBin, args, vulnRoot, 20 * 60 * 1000);

    const log = cmd.output || "";
    await writeArtifactText(history.recordDir, "log.txt", log);

    const ok = cmd.exitCode === 0;
    const responseBody = {
      historyId: history.id,
      log,
      error: ok ? undefined : "Important search failed. Check log for details.",
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
