import { NextResponse } from "next/server";
import { existsSync } from "fs";

import { isValidTarget, runCommand, vulnRoot } from "../_shared";

export const runtime = "nodejs";

type Body = {
  host: string;
};

export async function POST(request: Request) {
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

    const cmd = await runCommand(
      "python3",
      ["information_scrp/port_scan.py", host],
      vulnRoot,
      5 * 60 * 1000
    );

    return NextResponse.json({ log: cmd.output || "" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
