import { NextResponse } from "next/server";
import { existsSync } from "fs";
import fs from "fs/promises";
import path from "path";

import {
  copyArtifact,
  createHistoryRecord,
  finalizeHistoryRecord,
  writeArtifactText,
} from "../../_shared/history";
import { getUserIdFromRequest } from "../../_shared/user";

import {
  isValidTarget,
  normalizePath,
  pythonBin,
  readLines,
  readText,
  runCommand,
  vulnRoot,
} from "../_shared";

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

type AutoScriptResults = unknown;

type LibraryScanResponse = {
  log: string;
  pages: {
    discovered: number;
    scanned: number;
    ok: number;
    failed: number;
  };
  pageErrors: { url: string; status: number | null; error: string }[];
  libraries: {
    ecosystem?: string | null;
    name: string;
    version: string | null;
    occurrences: number;
    pages: string[];
    sources: string[];
    vulnerabilityCount: number;
    vulnerabilityIds: string[];
    vulnerabilityError?: string;
  }[];
  rawJson: string;
  error?: string;
};

function emptyLibraryScan(error: string): LibraryScanResponse {
  return {
    log: "",
    pages: { discovered: 0, scanned: 0, ok: 0, failed: 0 },
    pageErrors: [],
    libraries: [],
    rawJson: "{}",
    error,
  };
}

const stripPort = (value: string) => {
  if (value.startsWith("[")) return value;
  const idx = value.indexOf(":");
  if (idx === -1) return value;
  return value.slice(0, idx);
};

const deriveTargets = (raw: string) => {
  const trimmed = raw.trim();

  const hasScheme =
    trimmed.toLowerCase().startsWith("http://") ||
    trimmed.toLowerCase().startsWith("https://");

  if (hasScheme) {
    try {
      const url = new URL(trimmed);
      const host = stripPort(url.host);
      const startUrl = `${url.origin}/`;
      return { host, startUrl };
    } catch {
      // Fall through to best-effort parsing below.
    }
  }

  try {
    const url = new URL(`https://${trimmed}`);
    return {
      host: url.hostname,
      startUrl: `${url.origin}/`,
    };
  } catch {
    const hostCandidate = trimmed.split(/[/?#]/)[0] || trimmed;
    const host = stripPort(hostCandidate);
    return {
      host,
      startUrl: `https://${host}/`,
    };
  }
};

const stripWww = (hostname: string) => {
  const lower = hostname.toLowerCase();
  return lower.startsWith("www.") ? lower.slice(4) : lower;
};

const isAllowedHost = (base: URL, candidate: URL) => {
  return stripWww(base.hostname) === stripWww(candidate.hostname);
};

const ASSET_EXT_RE =
  /\.(?:css|js|mjs|cjs|map|png|jpg|jpeg|gif|svg|ico|webp|avif|woff2?|ttf|otf|eot|pdf|zip|gz|br|json|xml|txt|mp4|mp3|webm|wav)(?:$|\?|#)/i;

const extractUrlsFromText = (text: string) => {
  const out: string[] = [];
  const regex = /https?:\/\/[^\s]+/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text))) {
    out.push(match[0]);
  }
  return out;
};

const normalizeSitemapTreeUrls = (base: URL, rawUrls: string[]) => {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const raw of rawUrls) {
    const trimmed = raw.trim();
    if (!trimmed) continue;

    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      continue;
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") continue;
    if (!isAllowedHost(base, url)) continue;
    if (ASSET_EXT_RE.test(url.pathname)) continue;

    url.hash = "";
    const normalized = url.toString();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }

  return out;
};

export async function POST(request: Request) {
  const userId = getUserIdFromRequest(request) || "guest";
  let history: { id: string; recordDir: string } | null = null;

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

    history = await createHistoryRecord({
      userId,
      kind: "run",
      target: domain,
      requestBody: body,
    });

    const dataDir = path.join(vulnRoot, "data");
    await fs.mkdir(dataDir, { recursive: true });

    const subdomainsPath = path.join(dataDir, "subdomains.txt");
    const sitemapPath = path.join(dataDir, "sitemap_tree.txt");
    const resultsPath = path.join(dataDir, "results.json");

    // Avoid showing stale artifacts from previous runs (often example.com).
    await Promise.all([
      fs.rm(subdomainsPath, { force: true }),
      fs.rm(sitemapPath, { force: true }),
      fs.rm(resultsPath, { force: true }),
    ]);

    const { host: targetHost, startUrl } = deriveTargets(domain);

    let log = "";

    const subdomainResult = await runCommand(
      pythonBin,
      ["information_scrp/subdomain_scan.py", targetHost],
      vulnRoot,
      10 * 60 * 1000
    );

    log += `[*] Subdomain scan\n${subdomainResult.output}\n`;

    const sitemapResult = await runCommand(
      pythonBin,
      ["information_scrp/sitemap_builder.py", startUrl, "2"],
      vulnRoot,
      20 * 60 * 1000
    );

    log += `\n[*] Sitemap builder\n${sitemapResult.output}\n`;

    const sitemapTree = await readText(sitemapPath);
    const baseForLibraryScan = new URL(startUrl);
    const urlsInTree = extractUrlsFromText(sitemapTree);
    let pageUrlsForLibraryScan = normalizeSitemapTreeUrls(baseForLibraryScan, urlsInTree);
    const startUrlNormalized = baseForLibraryScan.toString();
    if (!pageUrlsForLibraryScan.includes(startUrlNormalized)) {
      pageUrlsForLibraryScan = [startUrlNormalized, ...pageUrlsForLibraryScan];
    }

    const maxLibraryScanPages = 500;
    const truncated = pageUrlsForLibraryScan.length > maxLibraryScanPages;
    pageUrlsForLibraryScan = pageUrlsForLibraryScan.slice(0, maxLibraryScanPages);

    log += `\n[*] Library scan input\n`;
    log += `[*] Sitemap tree URLs: ${urlsInTree.length}\n`;
    log += `[*] Page URLs (filtered): ${pageUrlsForLibraryScan.length}${truncated ? " (truncated)" : ""}\n`;

    const libraryScanUrl = new URL("/api/vulnchecklist/library-scan", request.url);
    const cookieHeader = request.headers.get("cookie");
    const libraryScanPromise: Promise<LibraryScanResponse> = (async () => {
      try {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        headers["x-vcld-embedded"] = "run";
        headers["x-vcld-parent-history-id"] = history.id;
        if (cookieHeader) {
          headers.cookie = cookieHeader;
        }

        const res = await fetch(libraryScanUrl, {
          method: "POST",
          headers,
          body: JSON.stringify({
            baseUrl: startUrl,
            urls: pageUrlsForLibraryScan,
            maxPages: 500,
            maxSitemaps: 20,
            concurrency: 6,
            requestTimeoutMs: 10_000,
            checkVulnerabilities: true,
          }),
        });

        let data: LibraryScanResponse;
        try {
          data = (await res.json()) as LibraryScanResponse;
        } catch {
          return emptyLibraryScan(`Library scan returned invalid JSON (HTTP ${res.status}).`);
        }

        if (!res.ok || data.error) {
          return {
            ...data,
            error: data.error || `Library scan failed (HTTP ${res.status}).`,
          };
        }

        return data;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unexpected library scan error";
        return emptyLibraryScan(message);
      }
    })();

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
      pythonBin,
      args,
      vulnRoot,
      20 * 60 * 1000
    );

    log += `\n[*] Main scan\n${mainResult.output}\n`;

    const subdomains = await readLines(subdomainsPath);

    let results: AutoScriptResults = null;
    try {
      const raw = await fs.readFile(resultsPath, "utf-8");
      results = JSON.parse(raw) as AutoScriptResults;
    } catch {
      results = null;
    }

    const libraryScan = await libraryScanPromise;
    log += `\n[*] Library scan\n`;
    if (libraryScan.error) {
      log += `[!] ${libraryScan.error}\n`;
    }
    if (libraryScan.log) {
      log += `${libraryScan.log}\n`;
    }

    const exitCodes = [
      subdomainResult.exitCode,
      sitemapResult.exitCode,
      mainResult.exitCode,
    ].filter((code) => code !== 0);

    await writeArtifactText(history.recordDir, "log.txt", log);
    await Promise.all([
      writeArtifactText(history.recordDir, "library_scan_response.json", JSON.stringify(libraryScan, null, 2)),
      writeArtifactText(history.recordDir, "library_scan.json", libraryScan.rawJson || "{}"),
      writeArtifactText(history.recordDir, "library_scan_log.txt", libraryScan.log || ""),
    ]);
    await Promise.all([
      copyArtifact(history.recordDir, subdomainsPath, "subdomains.txt"),
      copyArtifact(history.recordDir, sitemapPath, "sitemap_tree.txt"),
      copyArtifact(history.recordDir, path.join(dataDir, "results.json"), "results.json"),
      copyArtifact(history.recordDir, path.join(dataDir, "results.html"), "results.html"),
      copyArtifact(history.recordDir, path.join(dataDir, "subdomains.json"), "subdomains.json"),
      copyArtifact(history.recordDir, path.join(dataDir, "major_dir_file.json"), "major_dir_file.json"),
      copyArtifact(history.recordDir, path.join(dataDir, "important_search.json"), "important_search.json"),
      copyArtifact(history.recordDir, path.join(dataDir, "port_scan.json"), "port_scan.json"),
      copyArtifact(history.recordDir, path.join(dataDir, "cookie_scan.json"), "cookie_scan.json"),
    ]);

    if (exitCodes.length) {
      const responseBody = {
        historyId: history.id,
        error: "One or more steps failed. Check log for details.",
          log,
          subdomains,
          sitemapTree,
          results,
          libraryScan,
        };

      await finalizeHistoryRecord({
        recordDir: history.recordDir,
        status: "error",
        error: responseBody.error,
        responseBody,
      });

      return NextResponse.json(responseBody, { status: 500 });
    }

    const responseBody = {
      historyId: history.id,
      log,
      subdomains,
      sitemapTree,
      results,
      libraryScan,
    };

    await finalizeHistoryRecord({
      recordDir: history.recordDir,
      status: "success",
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
