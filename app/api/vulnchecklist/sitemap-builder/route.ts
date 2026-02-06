import { NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";

import { isValidTarget, readText, runCommand, vulnRoot } from "../_shared";

export const runtime = "nodejs";

type Body = {
  startUrl: string;
  maxDepth?: number;
};

export async function POST(request: Request) {
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

    const dataDir = path.join(vulnRoot, "data");
    await fs.mkdir(dataDir, { recursive: true });
    const sitemapPath = path.join(dataDir, "sitemap_tree.txt");

    const cmd = await runCommand(
      "python3",
      ["information_scrp/sitemap_builder.py", startUrl, String(maxDepth)],
      vulnRoot,
      20 * 60 * 1000
    );

    const sitemapTree = await readText(sitemapPath);
    const log = cmd.output || "";

    return NextResponse.json({ log, sitemapTree });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
