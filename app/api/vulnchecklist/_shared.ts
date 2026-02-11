import { spawn } from "child_process";
import { existsSync } from "fs";
import path from "path";
import fs from "fs/promises";

export type CommandResult = {
  output: string;
  exitCode: number | null;
};

export const vulnRoot =
  (process.env.VULNCHECKLIST_ROOT || "").trim() || "/opt/VulnCheckListDashboard";

const venvPython = path.join(vulnRoot, "venv", "bin", "python");
export const pythonBin =
  (process.env.VULNCHECKLIST_PYTHON || "").trim() ||
  (existsSync(venvPython) ? venvPython : "python3.11");

export const isValidTarget = (value: string) =>
  /^[a-zA-Z0-9][a-zA-Z0-9.:/_?&=%#-]*$/.test(value);

export const normalizePath = (value: string | undefined, fallback: string) => {
  const next = (value || fallback).trim() || fallback;
  return next.startsWith("/") ? next : `/${next}`;
};

export const runCommand = (
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number
): Promise<CommandResult> => {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env: process.env });
    let output = "";
    let settled = false;

    const finalize = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      resolve({ output, exitCode });
    };

    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });

    child.on("close", (code) => finalize(code));

    const timer = setTimeout(() => {
      output += `\n[-] Process timeout after ${timeoutMs}ms\n`;
      child.kill("SIGTERM");
      finalize(-1);
    }, timeoutMs);

    child.on("exit", () => clearTimeout(timer));
  });
};

export const readLines = async (filePath: string) => {
  if (!existsSync(filePath)) {
    return [] as string[];
  }
  const content = await fs.readFile(filePath, "utf-8");
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
};

export const readText = async (filePath: string) => {
  if (!existsSync(filePath)) {
    return "";
  }
  return fs.readFile(filePath, "utf-8");
};

const DENYLIST_PATTERN_RE = /^=?[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export const normalizeDenylist = (value: unknown) => {
  if (!Array.isArray(value)) return [] as string[];

  const normalized = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .filter((item) => item.length <= 64)
    .filter((item) => DENYLIST_PATTERN_RE.test(item));

  return Array.from(new Set(normalized)).slice(0, 64);
};

const HOST_RE = /^[a-zA-Z0-9][a-zA-Z0-9.-]*$/;

const extractHostname = (raw: string): string | null => {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    const url =
      trimmed.toLowerCase().startsWith("http://") ||
      trimmed.toLowerCase().startsWith("https://")
        ? new URL(trimmed)
        : new URL(`https://${trimmed}`);
    return url.hostname.toLowerCase();
  } catch {
    const candidate = trimmed.split(/[/?#]/)[0] || trimmed;
    const host = candidate.split(":")[0] || candidate;
    return host ? host.toLowerCase() : null;
  }
};

export const normalizeHostList = (value: unknown) => {
  if (!Array.isArray(value)) return [] as string[];

  const normalized = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => extractHostname(item))
    .filter((item): item is string => Boolean(item))
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .filter((item) => item.length <= 253)
    .filter((item) => HOST_RE.test(item));

  return Array.from(new Set(normalized)).slice(0, 64);
};
