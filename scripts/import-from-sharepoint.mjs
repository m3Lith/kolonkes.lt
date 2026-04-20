#!/usr/bin/env node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const ROOT = process.cwd();
const DISCOVER_SCRIPT = path.join(ROOT, "scripts", "discover-ena-source.mjs");
const execFileAsync = promisify(execFile);
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";

function parseArgs(argv) {
  let url = "";
  let date = "";
  let pageUrl = "https://www.ena.lt/degalu-kainos-degalinese/";
  let keepTemp = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--url") {
      url = argv[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (arg.startsWith("--url=")) {
      url = arg.slice("--url=".length);
      continue;
    }
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
      pageUrl = argv[i + 1] ?? pageUrl;
      i += 1;
      continue;
    }
    if (arg.startsWith("--page-url=")) {
      pageUrl = arg.slice("--page-url=".length);
      continue;
    }
    if (arg === "--keep-temp") {
      keepTemp = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  return { url: url.trim(), date: date.trim(), pageUrl: pageUrl.trim(), keepTemp };
}

function printHelp() {
  process.stdout.write(
    [
      "Import dataset from ENA SharePoint source URL.",
      "",
      "Usage:",
      "  node scripts/import-from-sharepoint.mjs [--date YYYY-MM-DD]",
      "  node scripts/import-from-sharepoint.mjs --url <sharepoint-url> [--date YYYY-MM-DD]",
      "",
      "Options:",
      "  --url       Explicit SharePoint URL. If omitted, auto-discover from ENA page.",
      "  --date      Target date (filters discovery and names imported dataset).",
      "  --page-url  ENA page URL for discovery (default official ENA page).",
      "  --keep-temp Keep downloaded temporary XLSX file for debugging.",
      "",
    ].join("\n"),
  );
}

function appendDownloadParam(url) {
  return url.includes("?") ? `${url}&download=1` : `${url}?download=1`;
}

function inferDateFromValue(value) {
  return value.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? "";
}

async function discoverSource({ date, pageUrl }) {
  const args = [DISCOVER_SCRIPT, "--page-url", pageUrl, "--format", "json"];
  if (date) {
    args.push("--date", date);
  }
  const { stdout } = await execFileAsync(process.execPath, args, { encoding: "utf8" });
  return JSON.parse(stdout);
}

async function resolveSource(options) {
  if (!options.url) {
    return discoverSource({ date: options.date, pageUrl: options.pageUrl });
  }

  const inferredDate = options.date || inferDateFromValue(options.url);
  if (!inferredDate) {
    throw new Error(
      [
        "Could not determine date for --url.",
        "Pass --date YYYY-MM-DD or use a URL that contains the date.",
      ].join(" "),
    );
  }

  return {
    date: inferredDate,
    href: options.url,
    title: "",
    text: "",
  };
}

async function downloadWorkbook(url, date) {
  const downloadUrl = appendDownloadParam(url);
  const tempPath = path.join(
    os.tmpdir(),
    `dk-${date}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.xlsx`,
  );
  const cookieJarPath = path.join(
    os.tmpdir(),
    `ena-sharepoint-cookies-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`,
  );

  try {
    await execFileAsync(
      "curl",
      [
        "-fsSL",
        "-A",
        BROWSER_UA,
        "-c",
        cookieJarPath,
        "-b",
        cookieJarPath,
        downloadUrl,
        "-o",
        tempPath,
      ],
      { encoding: "utf8" },
    );

    const file = await fs.open(tempPath, "r");
    try {
      const headerBuffer = Buffer.alloc(2);
      const { bytesRead } = await file.read(headerBuffer, 0, 2, 0);
      if (bytesRead < 2 || headerBuffer[0] !== 0x50 || headerBuffer[1] !== 0x4b) {
        throw new Error(
          [
            "Downloaded file is not XLSX (ZIP header missing).",
            "Source may require browser authentication or access has changed.",
          ].join(" "),
        );
      }
    } finally {
      await file.close();
    }

    return tempPath;
  } catch (error) {
    await fs.unlink(tempPath).catch(() => undefined);
    throw error;
  } finally {
    await fs.unlink(cookieJarPath).catch(() => undefined);
  }
}

function runImport(workbookPath, date) {
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  return new Promise((resolve, reject) => {
    const child = spawn(
      npmCmd,
      [
        "run",
        "import:workbook",
        "--",
        "--workbook",
        workbookPath,
        "--date",
        date,
      ],
      { stdio: "inherit", cwd: ROOT },
    );

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Import command failed with exit code ${code ?? "unknown"}`));
    });
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const source = await resolveSource(options);

  console.log(`Using source date: ${source.date}`);
  console.log(`Using source URL: ${source.href}`);

  const tempWorkbookPath = await downloadWorkbook(source.href, source.date);
  console.log(`Downloaded workbook: ${tempWorkbookPath}`);

  try {
    await runImport(tempWorkbookPath, source.date);
    console.log("Import completed successfully.");
  } finally {
    if (!options.keepTemp) {
      await fs.unlink(tempWorkbookPath).catch(() => undefined);
    } else {
      console.log(`Temporary workbook kept at: ${tempWorkbookPath}`);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
