import { NextResponse } from "next/server";
import { gunzipSync } from "zlib";

import {
  createHistoryRecord,
  finalizeHistoryRecord,
  writeArtifactText,
} from "../../_shared/history";
import { getUserIdFromRequest } from "../../_shared/user";
import { isValidTarget } from "../_shared";

export const runtime = "nodejs";

type Ecosystem = "npm";

type Body = {
  baseUrl: string;
  urls?: string[];
  maxPages?: number;
  maxSitemaps?: number;
  concurrency?: number;
  requestTimeoutMs?: number;
  checkVulnerabilities?: boolean;
};

type PageError = {
  url: string;
  status: number | null;
  error: string;
};

type VulnerabilitySummary = {
  id: string;
  summary?: string;
  aliases?: string[];
  modified?: string;
  published?: string;
  references?: string[];
};

type LibrarySummary = {
  ecosystem: Ecosystem | null;
  name: string;
  version: string | null;
  pages: string[];
  sources: string[];
  occurrences: number;
  vulnerabilityCount: number;
  vulnerabilityIds: string[];
  vulnerabilities?: VulnerabilitySummary[];
  vulnerabilityError?: string;
};

type ApiResponse = {
  historyId?: string;
  log: string;
  pages: {
    discovered: number;
    scanned: number;
    ok: number;
    failed: number;
  };
  pageErrors: PageError[];
  libraries: LibrarySummary[];
  rawJson: string;
  error?: string;
};

type DetectedLibrary = {
  ecosystem: Ecosystem | null;
  name: string;
  version: string | null;
  sourceUrl: string;
};

type OsvVulnerability = {
  id: string;
  summary?: string;
  aliases?: string[];
  modified?: string;
  published?: string;
  references?: { url?: string }[];
};

type OsvQuery = {
  package: { ecosystem: Ecosystem; name: string };
  version: string;
};

type OsvQueryBatchResponse = {
  results?: { vulns?: OsvVulnerability[] }[];
};

function clampInt(value: unknown, fallback: number, min: number, max: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(numeric)));
}

function stripWww(hostname: string) {
  return hostname.toLowerCase().startsWith("www.")
    ? hostname.toLowerCase().slice(4)
    : hostname.toLowerCase();
}

function normalizeInputUrl(raw: string) {
  const trimmed = raw.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withScheme);
  return url;
}

function isAllowedHost(base: URL, candidate: URL) {
  const baseHost = stripWww(base.hostname);
  const candidateHost = stripWww(candidate.hostname);
  if (candidateHost === baseHost) return true;
  if (!baseHost.includes(".")) return false;
  return candidateHost.endsWith(`.${baseHost}`);
}

function normalizeProvidedUrls(rawUrls: string[], base: URL) {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const raw of rawUrls) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;

    let parsed: URL;
    try {
      parsed = new URL(trimmed, base.origin);
    } catch {
      continue;
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
    if (!isAllowedHost(base, parsed)) continue;

    parsed.hash = "";
    const normalized = parsed.toString();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }

  return out;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url: string, timeoutMs: number, accept: string) {
  const res = await fetchWithTimeout(
    url,
    {
      method: "GET",
      headers: {
        Accept: accept,
        "User-Agent": "VCLASDashboard/0.1 (library-scan)",
      },
      redirect: "follow",
    },
    timeoutMs
  );

  const contentType = res.headers.get("content-type");

  if (url.toLowerCase().endsWith(".gz")) {
    const buf = Buffer.from(await res.arrayBuffer());
    let unzipped: Buffer;
    try {
      unzipped = gunzipSync(buf);
    } catch {
      unzipped = buf;
    }
    return {
      ok: res.ok,
      status: res.status,
      contentType,
      text: unzipped.toString("utf-8"),
    };
  }

  const text = await res.text();
  return { ok: res.ok, status: res.status, contentType, text };
}

function decodeXmlText(raw: string) {
  const trimmed = raw.trim();
  const noCdata = trimmed
    .replace(/^<!\[CDATA\[/i, "")
    .replace(/\]\]>$/i, "");
  return noCdata
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractSitemapLocs(xml: string) {
  const locs: string[] = [];
  const regex = /<loc>([\s\S]*?)<\/loc>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml))) {
    const value = decodeXmlText(match[1] || "");
    if (value) locs.push(value);
  }
  return locs;
}

function looksLikeSitemapIndex(xml: string) {
  return /<sitemapindex\b/i.test(xml);
}

async function discoverSitemapUrls(base: URL, timeoutMs: number) {
  const candidates: string[] = [];
  const robotsUrl = new URL("/robots.txt", base.origin).toString();
  try {
    const robotsRes = await fetchWithTimeout(
      robotsUrl,
      {
        method: "GET",
        headers: {
          Accept: "text/plain,*/*",
          "User-Agent": "VCLASDashboard/0.1 (library-scan)",
        },
      },
      timeoutMs
    );
    if (robotsRes.ok) {
      const robotsText = await robotsRes.text();
      for (const line of robotsText.split("\n")) {
        const match = /^\s*sitemap\s*:\s*(\S+)\s*$/i.exec(line);
        if (!match) continue;
        try {
          const parsed = new URL(match[1], base.origin);
          candidates.push(parsed.toString());
        } catch {
          // Ignore invalid sitemap URLs.
        }
      }
    }
  } catch {
    // Ignore robots fetch failures.
  }

  for (const suffix of ["/sitemap.xml", "/sitemap_index.xml", "/sitemap-index.xml"]) {
    candidates.push(new URL(suffix, base.origin).toString());
  }

  return Array.from(new Set(candidates));
}

async function loadSitemapPages(
  base: URL,
  sitemapUrls: string[],
  maxSitemaps: number,
  timeoutMs: number
) {
  const queue = [...sitemapUrls];
  const seen = new Set<string>();
  const pageUrls: string[] = [];

  while (queue.length && seen.size < maxSitemaps) {
    const next = queue.shift();
    if (!next) break;
    if (seen.has(next)) continue;
    seen.add(next);

    let xml = "";
    try {
      const res = await fetchText(next, timeoutMs, "application/xml,text/xml,*/*");
      if (!res.ok) continue;
      xml = res.text;
    } catch {
      continue;
    }

    const locs = extractSitemapLocs(xml);
    if (!locs.length) continue;

    if (looksLikeSitemapIndex(xml)) {
      for (const loc of locs) {
        try {
          const parsed = new URL(loc, base.origin);
          queue.push(parsed.toString());
        } catch {
          // ignore
        }
      }
      continue;
    }

    for (const loc of locs) {
      try {
        const parsed = new URL(loc, base.origin);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
        if (!isAllowedHost(base, parsed)) continue;
        pageUrls.push(parsed.toString());
      } catch {
        // ignore
      }
    }
  }

  return { pageUrls: Array.from(new Set(pageUrls)), sitemapCount: seen.size };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
) {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    async () => {
      while (true) {
        const index = cursor++;
        if (index >= items.length) return;
        results[index] = await mapper(items[index], index);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

function getAttr(tag: string, name: string) {
  const regex = new RegExp(
    `\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i"
  );
  const match = regex.exec(tag);
  return (match?.[1] || match?.[2] || match?.[3] || "").trim() || null;
}

function extractHtmlAssets(html: string) {
  const assets: { url: string; kind: "script" | "style" }[] = [];

  const scriptTagRegex = /<script\b[^>]*>/gi;
  const linkTagRegex = /<link\b[^>]*>/gi;

  let match: RegExpExecArray | null;
  while ((match = scriptTagRegex.exec(html))) {
    const tag = match[0] || "";
    const src = getAttr(tag, "src");
    if (src) assets.push({ url: src, kind: "script" });
  }

  while ((match = linkTagRegex.exec(html))) {
    const tag = match[0] || "";
    const href = getAttr(tag, "href");
    if (!href) continue;
    const rel = (getAttr(tag, "rel") || "").toLowerCase();
    const isStylesheet = rel.split(/\s+/).includes("stylesheet") || /\.css(\?|#|$)/i.test(href);
    if (!isStylesheet) continue;
    assets.push({ url: href, kind: "style" });
  }

  return assets;
}

function looksLikeVersion(value: string) {
  const trimmed = value.trim();
  return /^\d+(?:\.\d+){0,3}(?:[-+][0-9A-Za-z.-]+)?$/.test(trimmed);
}

function splitAtLastAt(value: string) {
  const idx = value.lastIndexOf("@");
  if (idx <= 0) return { left: value, right: null as string | null };
  const left = value.slice(0, idx);
  const right = value.slice(idx + 1);
  return { left, right: right || null };
}

function inferNameFromFilename(filename: string) {
  const cleaned = filename
    .replace(/\?.*$/, "")
    .replace(/#.*$/, "")
    .replace(/\.(min|bundle|umd|prod|production)\b/gi, "")
    .replace(/\.(js|css)\b/gi, "")
    .trim();
  return cleaned || null;
}

function detectLibrary(assetUrl: string): { ecosystem: Ecosystem | null; name: string; version: string | null } | null {
  let url: URL;
  try {
    url = new URL(assetUrl);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  const pathParts = url.pathname.split("/").filter(Boolean);

  if (host === "cdn.jsdelivr.net") {
    const npmIdx = pathParts.indexOf("npm");
    if (npmIdx !== -1 && npmIdx + 1 < pathParts.length) {
      const first = pathParts[npmIdx + 1];
      if (first.startsWith("@") && npmIdx + 2 < pathParts.length) {
        const second = pathParts[npmIdx + 2];
        const split = splitAtLastAt(second);
        return {
          ecosystem: "npm",
          name: `${first}/${split.left}`,
          version: split.right,
        };
      }
      const split = splitAtLastAt(first);
      return { ecosystem: "npm", name: split.left, version: split.right };
    }
  }

  if (host === "unpkg.com") {
    if (pathParts.length) {
      const first = pathParts[0];
      if (first.startsWith("@") && pathParts.length >= 2) {
        const second = pathParts[1];
        const split = splitAtLastAt(second);
        return { ecosystem: "npm", name: `${first}/${split.left}`, version: split.right };
      }
      const split = splitAtLastAt(first);
      return { ecosystem: "npm", name: split.left, version: split.right };
    }
  }

  if (host === "cdnjs.cloudflare.com" || host === "ajax.googleapis.com") {
    const ajaxIdx = pathParts.indexOf("ajax");
    const libsIdx = pathParts.indexOf("libs");
    const start = ajaxIdx !== -1 && libsIdx === ajaxIdx + 1 ? ajaxIdx + 2 : -1;
    if (start !== -1 && start + 1 < pathParts.length) {
      const name = pathParts[start];
      const version = pathParts[start + 1];
      return { ecosystem: "npm", name, version: looksLikeVersion(version) ? version : null };
    }
  }

  if (host === "code.jquery.com") {
    const file = pathParts[pathParts.length - 1] || "";
    const match = /^jquery-(\d+(?:\.\d+){0,3}(?:[-+][0-9A-Za-z.-]+)?)\b/i.exec(file);
    if (match) {
      return { ecosystem: "npm", name: "jquery", version: match[1] };
    }
  }

  if (host.endsWith("bootstrapcdn.com") || host === "maxcdn.bootstrapcdn.com") {
    if (pathParts.length >= 2) {
      const name = pathParts[0];
      const version = pathParts[1];
      return { ecosystem: "npm", name, version: looksLikeVersion(version) ? version : null };
    }
  }

  const versionParam =
    url.searchParams.get("ver") ||
    url.searchParams.get("version") ||
    url.searchParams.get("v");
  if (versionParam && looksLikeVersion(versionParam)) {
    const file = pathParts[pathParts.length - 1] || "";
    const inferred = inferNameFromFilename(file);
    if (inferred) return { ecosystem: "npm", name: inferred, version: versionParam };
  }

  const file = pathParts[pathParts.length - 1] || "";
  const filename = file.toLowerCase();
  if (!filename.endsWith(".js") && !filename.endsWith(".css")) {
    return null;
  }

  const base = file
    .replace(/\?.*$/, "")
    .replace(/#.*$/, "")
    .replace(/\.(min|bundle)\.(js|css)$/i, ".$2")
    .replace(/\.(js|css)$/i, "");

  const dashMatch = /^(.+?)[-_]v?(\d+(?:\.\d+){0,3}(?:[-+][0-9A-Za-z.-]+)?)$/i.exec(base);
  if (dashMatch) {
    return { ecosystem: "npm", name: dashMatch[1], version: dashMatch[2] };
  }

  return null;
}

async function queryOsv(
  queries: OsvQuery[],
  timeoutMs: number
): Promise<{ results: { vulns?: OsvVulnerability[]; error?: string }[] }> {
  if (!queries.length) return { results: [] };
  try {
    const res = await fetchWithTimeout(
      "https://api.osv.dev/v1/querybatch",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ queries }),
      },
      timeoutMs
    );

    if (!res.ok) {
      return {
        results: queries.map(() => ({ error: `OSV request failed (${res.status}).` })),
      };
    }

    const data = (await res.json()) as OsvQueryBatchResponse;
    const results = Array.isArray(data.results) ? data.results : [];
    return {
      results: queries.map((_, idx) =>
        results[idx] ? results[idx] : { error: "OSV response missing result." }
      ),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected OSV error";
    return {
      results: queries.map(() => ({ error: message })),
    };
  }
}

function summarizeVulns(vulns: OsvVulnerability[]) {
  const summaries: VulnerabilitySummary[] = vulns.map((v) => ({
    id: v.id,
    summary: v.summary,
    aliases: Array.isArray(v.aliases) ? v.aliases : undefined,
    modified: v.modified,
    published: v.published,
    references: Array.isArray(v.references)
      ? v.references.map((ref) => ref.url).filter(Boolean) as string[]
      : undefined,
  }));
  return summaries;
}

export async function POST(request: Request) {
  const userId = getUserIdFromRequest(request) || "guest";
  let history: { id: string; recordDir: string } | null = null;
  let log = "";

  const embeddedFlag = (request.headers.get("x-vcld-embedded") || "").trim().toLowerCase();
  const parentHistoryId = (request.headers.get("x-vcld-parent-history-id") || "").trim();
  const isValidParentHistoryId =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      parentHistoryId
    );
  const embeddedInRun = embeddedFlag === "run" && isValidParentHistoryId;

  try {
    const body = (await request.json()) as Body;
    const baseUrlRaw = (body.baseUrl || "").trim();

    if (!baseUrlRaw) {
      return NextResponse.json({ error: "Base URL is required." }, { status: 400 });
    }
    if (!isValidTarget(baseUrlRaw)) {
      return NextResponse.json(
        { error: "Base URL contains invalid characters." },
        { status: 400 }
      );
    }

    let baseUrl: URL;
    try {
      baseUrl = normalizeInputUrl(baseUrlRaw);
    } catch {
      return NextResponse.json({ error: "Base URL is invalid." }, { status: 400 });
    }
    if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
      return NextResponse.json(
        { error: "Only http/https URLs are supported." },
        { status: 400 }
      );
    }

    if (!embeddedInRun) {
      history = await createHistoryRecord({
        userId,
        kind: "library-scan",
        target: baseUrlRaw,
        requestBody: body,
      });
    }

    const requestTimeoutMs = clampInt(body.requestTimeoutMs, 12_000, 2_000, 60_000);
    const concurrency = clampInt(body.concurrency, 6, 1, 20);
    const maxPages = clampInt(body.maxPages, 60, 1, 500);
    const maxSitemaps = clampInt(body.maxSitemaps, 20, 1, 100);
    const checkVulnerabilities = body.checkVulnerabilities ?? true;

    log += `[*] Base: ${baseUrl.origin}\n`;
    log += `[*] Options: maxPages=${maxPages}, concurrency=${concurrency}, timeoutMs=${requestTimeoutMs}, maxSitemaps=${maxSitemaps}, osv=${checkVulnerabilities}\n`;

    const providedUrls = Array.isArray(body.urls) ? body.urls : [];
    const providedPages = providedUrls.length
      ? normalizeProvidedUrls(providedUrls, baseUrl)
      : ([] as string[]);

    if (providedUrls.length) {
      log += `[*] URL list provided: ${providedUrls.length}\n`;
      log += `[*] URL list after filtering: ${providedPages.length}\n`;
    }

    const sitemapUrls = await discoverSitemapUrls(baseUrl, requestTimeoutMs);
    log += `[*] Sitemap candidates: ${sitemapUrls.length}\n`;

    const loaded = await loadSitemapPages(
      baseUrl,
      sitemapUrls,
      maxSitemaps,
      requestTimeoutMs
    );
    const sitemapPages = loaded.pageUrls;
    const sitemapCount = loaded.sitemapCount;
    log += `[*] Sitemaps fetched: ${sitemapCount}\n`;
    log += `[*] Pages discovered (sitemap): ${sitemapPages.length}\n`;

    const combinedPages: string[] = [];
    const seenPages = new Set<string>();

    for (const url of [...providedPages, ...sitemapPages]) {
      if (seenPages.has(url)) continue;
      seenPages.add(url);
      combinedPages.push(url);
    }

    const discoveredPages = combinedPages.length ? combinedPages : [baseUrl.toString()];
    if (!combinedPages.length) {
      log += "[!] No pages discovered from provided URLs or sitemap. Falling back to scanning base URL only.\n";
    }

    const truncated = discoveredPages.length > maxPages;
    const pagesToScan = discoveredPages.slice(0, maxPages);
    log += `[*] Pages to scan: ${pagesToScan.length}${truncated ? " (truncated)" : ""}\n`;

    const pageErrors: PageError[] = [];
    const libAgg = new Map<
      string,
      {
        ecosystem: Ecosystem | null;
        name: string;
        version: string | null;
        occurrences: number;
        pages: Set<string>;
        sources: Set<string>;
      }
    >();

    const pageResults = await mapWithConcurrency(pagesToScan, concurrency, async (pageUrl) => {
      try {
        const res = await fetchWithTimeout(
          pageUrl,
          {
            method: "GET",
            headers: {
              Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
              "User-Agent": "VCLASDashboard/0.1 (library-scan)",
            },
            redirect: "follow",
          },
          requestTimeoutMs
        );

        const contentType = res.headers.get("content-type") || "";
        if (!res.ok) {
          pageErrors.push({ url: pageUrl, status: res.status, error: "Non-2xx response" });
          return { ok: false };
        }

        if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
          pageErrors.push({
            url: pageUrl,
            status: res.status,
            error: `Skipped non-HTML content-type: ${contentType}`,
          });
          return { ok: false };
        }

        const html = await res.text();
        const assets = extractHtmlAssets(html);
        const detected: DetectedLibrary[] = [];
        for (const asset of assets) {
          let absolute = "";
          try {
            absolute = new URL(asset.url, pageUrl).toString();
          } catch {
            continue;
          }
          const lib = detectLibrary(absolute);
          if (!lib) continue;
          detected.push({ ...lib, sourceUrl: absolute });
        }

        const seenForPage = new Set<string>();
        for (const lib of detected) {
          const key = `${lib.ecosystem || "unknown"}:${lib.name}@${lib.version || "unknown"}`;
          if (!seenForPage.has(key)) {
            seenForPage.add(key);
          }
          const current = libAgg.get(key);
          if (current) {
            current.occurrences += 1;
            current.pages.add(pageUrl);
            current.sources.add(lib.sourceUrl);
          } else {
            libAgg.set(key, {
              ecosystem: lib.ecosystem,
              name: lib.name,
              version: lib.version,
              occurrences: 1,
              pages: new Set([pageUrl]),
              sources: new Set([lib.sourceUrl]),
            });
          }
        }

        return { ok: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected fetch error";
        pageErrors.push({ url: pageUrl, status: null, error: message });
        return { ok: false };
      }
    });

    const pagesOk = pageResults.filter((p) => p.ok).length;
    const pagesFailed = pagesToScan.length - pagesOk;

    const libraries: LibrarySummary[] = Array.from(libAgg.values()).map((entry) => ({
      ecosystem: entry.ecosystem,
      name: entry.name,
      version: entry.version,
      pages: Array.from(entry.pages).slice(0, 50),
      sources: Array.from(entry.sources).slice(0, 50),
      occurrences: entry.occurrences,
      vulnerabilityCount: 0,
      vulnerabilityIds: [],
    }));

    if (checkVulnerabilities) {
      const eligible = libraries.filter(
        (lib) => lib.ecosystem === "npm" && lib.version && looksLikeVersion(lib.version)
      );

      log += `[*] OSV queries: ${eligible.length}\n`;

      const batchSize = 50;
      for (let i = 0; i < eligible.length; i += batchSize) {
        const chunk = eligible.slice(i, i + batchSize);
        const queries: OsvQuery[] = chunk.map((lib) => ({
          package: { ecosystem: "npm", name: lib.name },
          version: lib.version as string,
        }));

        const osv = await queryOsv(queries, requestTimeoutMs);
        for (let idx = 0; idx < chunk.length; idx += 1) {
          const lib = chunk[idx];
          const result = osv.results[idx] || {};
          if (result.error) {
            lib.vulnerabilityError = result.error;
            continue;
          }

          const vulns = Array.isArray(result.vulns) ? result.vulns : [];
          lib.vulnerabilityCount = vulns.length;
          lib.vulnerabilityIds = vulns.map((v) => v.id);
          lib.vulnerabilities = vulns.length ? summarizeVulns(vulns).slice(0, 10) : undefined;
        }
      }
    } else {
      log += "[*] OSV disabled\n";
    }

    libraries.sort((a, b) => {
      if (b.vulnerabilityCount !== a.vulnerabilityCount) {
        return b.vulnerabilityCount - a.vulnerabilityCount;
      }
      if (b.occurrences !== a.occurrences) return b.occurrences - a.occurrences;
      return `${a.name}@${a.version || ""}`.localeCompare(`${b.name}@${b.version || ""}`);
    });

    const report = {
      pages: {
        discovered: discoveredPages.length,
        scanned: pagesToScan.length,
        ok: pagesOk,
        failed: pagesFailed,
      },
      pageErrors,
      libraries,
    };

    const rawJson = JSON.stringify(report, null, 2);
    const response: ApiResponse = {
      historyId: history?.id,
      log,
      ...report,
      rawJson,
    };

    if (history) {
      await writeArtifactText(history.recordDir, "log.txt", log);
      await writeArtifactText(history.recordDir, "raw.json", rawJson);
      await finalizeHistoryRecord({
        recordDir: history.recordDir,
        status: "success",
        responseBody: response,
      });
    }

    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    const response: ApiResponse = {
      historyId: history?.id,
      log,
      pages: { discovered: 0, scanned: 0, ok: 0, failed: 0 },
      pageErrors: [],
      libraries: [],
      rawJson: "{}",
      error: message,
    };

    if (history) {
      await writeArtifactText(history.recordDir, "log.txt", log);
      await finalizeHistoryRecord({
        recordDir: history.recordDir,
        status: "error",
        error: message,
        responseBody: response,
      });
    }

    return NextResponse.json(response, { status: 500 });
  }
}
