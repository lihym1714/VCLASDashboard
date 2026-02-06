import { NextResponse } from "next/server";
import { existsSync } from "fs";

import { isValidTarget, normalizePath, runCommand, vulnRoot } from "../_shared";

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

    const cmd = await runCommand("python3", args, vulnRoot, 20 * 60 * 1000);
    return NextResponse.json({ log: cmd.output || "" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
