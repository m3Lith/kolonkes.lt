#!/usr/bin/env node

import fs from "node:fs/promises";

const DEFAULT_PAGE_URL = "https://www.ena.lt/degalu-kainos-degalinese/";
const DATE_FROM_TITLE_RE = /Degal\u0173 kainos (\d{4}-\d{2}-\d{2})/;
const DATE_FROM_TEXT_RE = /Naujausios degal\u0173 kainos \((\d{4}-\d{2}-\d{2})\)/;
const ANCHOR_RE = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
const ATTR_RE = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;

function parseArgs(argv) {
  let date = "";
  let pageUrl = DEFAULT_PAGE_URL;
  let outputPath = "";
  let format = "json";

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--date") {
      date = argv[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (arg.startsWith("--date=")) {
      date = arg.slice("--date=".length);
      continue;
    }
    if (arg === "--page-url") {
      pageUrl = argv[i + 1] ?? DEFAULT_PAGE_URL;
      i += 1;
      continue;
    }
    if (arg.startsWith("--page-url=")) {
      pageUrl = arg.slice("--page-url=".length);
      continue;
    }
    if (arg === "--output") {
      outputPath = argv[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (arg.startsWith("--output=")) {
      outputPath = arg.slice("--output=".length);
      continue;
    }
    if (arg === "--format") {
      format = argv[i + 1] ?? "json";
      i += 1;
      continue;
    }
    if (arg.startsWith("--format=")) {
      format = arg.slice("--format=".length);
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  if (format !== "json" && format !== "tsv") {
    throw new Error("Invalid --format. Allowed: json, tsv");
  }

  return { date: date.trim(), pageUrl: pageUrl.trim(), outputPath: outputPath.trim(), format };
}

function printHelp() {
  process.stdout.write(
    [
      "Discover latest ENA SharePoint source URL.",
      "",
      "Usage:",
      "  node scripts/discover-ena-source.mjs [--date YYYY-MM-DD] [--output path] [--format json|tsv]",
      "",
      "Options:",
      "  --date      Pick exact date; otherwise choose latest available",
      "  --page-url  Source page (default ENA fuel page)",
      "  --output    Write selected entry JSON to a file",
      "  --format    Output format to stdout: json (default) or tsv",
      "",
    ].join("\n"),
  );
}

function normalizeSpace(value) {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function decodeHtml(value) {
  return value
    .replace(/&#(\d+);/g, (_full, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_full, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function stripTags(value) {
  return value.replace(/<[^>]+>/g, "");
}

function parseAttrs(rawAttrs) {
  const attrs = {};
  let match;
  while ((match = ATTR_RE.exec(rawAttrs)) !== null) {
    const name = match[1].toLowerCase();
    const value = match[3] ?? match[4] ?? match[5] ?? "";
    attrs[name] = decodeHtml(value);
  }
  ATTR_RE.lastIndex = 0;
  return attrs;
}

function tryResolveUrl(href, pageUrl) {
  try {
    return new URL(href, pageUrl).toString();
  } catch {
    return "";
  }
}

function parseDate({ title, text }) {
  const fromTitle = title.match(DATE_FROM_TITLE_RE)?.[1];
  if (fromTitle) {
    return fromTitle;
  }
  return text.match(DATE_FROM_TEXT_RE)?.[1] ?? "";
}

function extractEntries(html, pageUrl) {
  const entries = [];
  let match;

  while ((match = ANCHOR_RE.exec(html)) !== null) {
    const attrs = parseAttrs(match[1] ?? "");
    const href = attrs.href ?? "";
    if (!href.includes("sharepoint.com")) {
      continue;
    }

    const title = normalizeSpace(attrs.title ?? "");
    const text = normalizeSpace(decodeHtml(stripTags(match[2] ?? "")));
    const date = parseDate({ title, text });
    if (!date) {
      continue;
    }

    const resolvedHref = tryResolveUrl(href, pageUrl);
    if (!resolvedHref) {
      continue;
    }

    entries.push({ date, href: resolvedHref, title, text });
  }

  return entries;
}

async function discover({ date, pageUrl }) {
  const response = await fetch(pageUrl, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
      "accept-language": "lt-LT,lt;q=0.9,en-US;q=0.8,en;q=0.7",
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${pageUrl}: HTTP ${response.status}`);
  }

  const html = await response.text();
  const entries = extractEntries(html, pageUrl);
  const filtered = date ? entries.filter((entry) => entry.date === date) : entries;
  if (filtered.length === 0) {
    throw new Error(date ? `No SharePoint source found for date ${date}` : "No SharePoint source found");
  }

  return filtered.reduce((latest, candidate) => (candidate.date > latest.date ? candidate : latest));
}

function toStdout(entry, format) {
  if (format === "tsv") {
    return `${entry.date}\t${entry.href}\t${entry.title}\t${entry.text}\n`;
  }
  return `${JSON.stringify(entry, null, 2)}\n`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const selected = await discover(options);

  if (options.outputPath) {
    await fs.writeFile(options.outputPath, `${JSON.stringify(selected, null, 2)}\n`, "utf8");
  }

  process.stdout.write(toStdout(selected, options.format));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
