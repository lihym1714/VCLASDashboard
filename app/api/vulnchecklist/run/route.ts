import { NextResponse } from "next/server";
import { existsSync } from "fs";
import fs from "fs/promises";
import path from "path";

import { isValidTarget, normalizePath, readLines, readText, runCommand, vulnRoot } from "../_shared";

export const runtime = "nodejs";

type VerifySslMode = "default" | "verify" | "no-verify";

type RunRequest = {
  domain: string;
  loginEnabled?: boolean;
  loginUser?: string;
  loginPassword?: string;
  loginPath?: string;
  logoutPath?: string;
  verifySsl?: VerifySslMode;
  disableWarnings?: boolean;
};

type CommandResult = {
  output: string;
  exitCode: number | null;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RunRequest;
    const domain = (body.domain || "").trim();

    if (!domain) {
      return NextResponse.json(
        { error: "Domain is required." },
        { status: 400 }
      );
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
    const sitemapPath = path.join(dataDir, "sitemap_tree.txt");

    let log = "";

    const subdomainResult = await runCommand(
      "python3",
      ["information_scrp/subdomain_scan.py", domain],
      vulnRoot,
      10 * 60 * 1000
    );

    log += `[*] Subdomain scan\n${subdomainResult.output}\n`;

    const loginPath = normalizePath(body.loginPath, "/api/auth/login");
    const logoutPath = normalizePath(body.logoutPath, "/api/auth/logout");

    const args = ["main.py", "data/subdomains.txt"];

    if (body.loginEnabled) {
      args.push("--login");
      if (body.loginUser) args.push("--login-user", body.loginUser);
      if (body.loginPassword) args.push("--login-password", body.loginPassword);
    }

    if (loginPath) args.push("--login-path", loginPath);
    if (logoutPath) args.push("--logout-path", logoutPath);

    if (body.verifySsl === "verify") {
      args.push("--verify-ssl");
    }
    if (body.verifySsl === "no-verify") {
      args.push("--no-verify-ssl");
    }
    if (body.disableWarnings) {
      args.push("--disable-warnings");
    }

    const mainResult = await runCommand(
      "python3",
      args,
      vulnRoot,
      20 * 60 * 1000
    );

    log += `\n[*] Main scan\n${mainResult.output}\n`;

    const subdomains = await readLines(subdomainsPath);
    const sitemapTree = await readText(sitemapPath);

    return NextResponse.json({
      log,
      subdomains,
      sitemapTree,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
