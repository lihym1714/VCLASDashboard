import { NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";

import { isValidTarget, readLines, runCommand, vulnRoot } from "../_shared";

export const runtime = "nodejs";

type Body = {
  domain: string;
};

export async function POST(request: Request) {
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

    const cmd = await runCommand(
      "python3",
      ["information_scrp/subdomain_scan.py", domain],
      vulnRoot,
      10 * 60 * 1000
    );

    const subdomains = await readLines(subdomainsPath);
    const log = `[*] Subdomain scan\n${cmd.output}\n`;

    return NextResponse.json({ log, subdomains });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
