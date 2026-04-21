#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function readMarker(markerPath) {
  try {
    const payload = JSON.parse(fs.readFileSync(markerPath, "utf8"));
    process.stdout.write(`${payload.date ?? ""}\t${payload.source_url ?? ""}`);
  } catch {
    process.stdout.write("\t");
  }
}

function writeMarker(markerPath, dateIso, sourceUrl) {
  const payload = {
    date: dateIso,
    source_url: sourceUrl,
    marked_at: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(markerPath), { recursive: true });
  fs.writeFileSync(markerPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function isXlsx(filePath) {
  const file = fs.openSync(filePath, "r");
  try {
    const header = Buffer.alloc(2);
    fs.readSync(file, header, 0, 2, 0);
    process.exit(header[0] === 0x50 && header[1] === 0x4b ? 0 : 1);
  } finally {
    fs.closeSync(file);
  }
}

const [command, ...args] = process.argv.slice(2);
if (command === "read-marker" && args.length === 1) {
  readMarker(args[0]);
} else if (command === "write-marker" && args.length === 3) {
  writeMarker(args[0], args[1], args[2]);
} else if (command === "is-xlsx" && args.length === 1) {
  isXlsx(args[0]);
} else {
  process.stderr.write(
    "Usage:\n" +
      "  node scripts/workflow-utils.mjs read-marker <marker-path>\n" +
      "  node scripts/workflow-utils.mjs write-marker <marker-path> <date-iso> <source-url>\n" +
      "  node scripts/workflow-utils.mjs is-xlsx <file-path>\n",
  );
  process.exit(1);
}
