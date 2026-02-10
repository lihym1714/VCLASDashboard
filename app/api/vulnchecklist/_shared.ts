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
