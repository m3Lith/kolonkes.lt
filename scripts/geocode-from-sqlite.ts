import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { StationCatalogRecord, StationGeocodeRecord } from "../src/lib/types";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const STATION_CATALOG_PATH = path.join(ROOT, "src", "data", "stations", "catalog.json");
const STATION_GEOCODES_PATH = path.join(
  ROOT,
  "src",
  "data",
  "station-geocodes",
  "latest.json",
);
const DEFAULT_DB_PATH = path.join(DATA_DIR, "addresses.sqlite");

interface CliOptions {
  dbPath: string;
  dryRun: boolean;
}

interface ResidentialAreaRow {
  lat: number;
  lon: number;
  name: string;
}

interface FuzzyMatch {
  area: ResidentialAreaRow;
  distance: number;
  similarity: number;
}

function parseCliOptions(argv: string[]): CliOptions {
  let dbPath = DEFAULT_DB_PATH;
  let dryRun = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg.startsWith("--db=")) {
      dbPath = path.resolve(ROOT, arg.slice("--db=".length));
      continue;
    }
    if (arg === "--db") {
      const next = argv[index + 1];
      if (!next) {
        throw new Error("Missing value for --db");
      }
      dbPath = path.resolve(ROOT, next);
      index += 1;
      continue;
    }
  }

  return { dbPath, dryRun };
}

async function readJson<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

function buildQuery(company: string, parsedAddress: string): string {
  return `${company}, ${parsedAddress}, Lietuva`;
}

function hasComma(value: string): boolean {
  return value.includes(",");
}

function normalizeSpace(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeAreaName(value: string): string {
  return normalizeSpace(value)
    .replace(/\bkm\./gi, "k.")
    .replace(/\bkm\b/gi, "k.")
    .replace(/\s+\./g, ".")
    .replace(/\.{2,}/g, ".")
    .trim();
}

function toFuzzyKey(value: string): string {
  return normalizeAreaName(value)
    .toLowerCase()
    .replace(/[.,'"`"]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  if (!a.length) {
    return b.length;
  }
  if (!b.length) {
    return a.length;
  }

  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) {
    prev[j] = j;
  }

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost,
      );
    }
    for (let j = 0; j <= b.length; j += 1) {
      prev[j] = curr[j];
    }
  }

  return prev[b.length];
}

function chooseFuzzyMatch(
  inputName: string,
  candidates: ResidentialAreaRow[],
): FuzzyMatch | null {
  const inputKey = toFuzzyKey(inputName);
  if (!inputKey) {
    return null;
  }

  const scored: FuzzyMatch[] = [];
  for (const area of candidates) {
    const areaKey = toFuzzyKey(area.name);
    if (!areaKey || areaKey[0] !== inputKey[0]) {
      continue;
    }
    const distance = levenshtein(inputKey, areaKey);
    const similarity = 1 - distance / Math.max(inputKey.length, areaKey.length);
    scored.push({ area, distance, similarity });
  }

  scored.sort(
    (a, b) => a.distance - b.distance || b.similarity - a.similarity,
  );

  const best = scored[0];
  if (!best) {
    return null;
  }

  const bestLen = Math.max(inputKey.length, toFuzzyKey(best.area.name).length);
  const maxDistance = bestLen <= 8 ? 1 : 2;
  if (best.distance > maxDistance || best.similarity < 0.85) {
    return null;
  }

  const second = scored[1];
  if (
    second &&
    second.distance === best.distance &&
    Math.abs(second.similarity - best.similarity) < 0.03
  ) {
    return null;
  }

  return best;
}

async function main(): Promise<void> {
  const { dbPath, dryRun } = parseCliOptions(process.argv.slice(2));
  const nowIso = new Date().toISOString();

  const [catalog, existingGeocodes] = await Promise.all([
    readJson<StationCatalogRecord[]>(STATION_CATALOG_PATH),
    readJson<StationGeocodeRecord[]>(STATION_GEOCODES_PATH).catch(
      () => [] as StationGeocodeRecord[],
    ),
  ]);

  const existingByStationId = new Map(
    existingGeocodes.map((row) => [row.station_id, row] as const),
  );

  const db = new DatabaseSync(dbPath);
  const municipalityStmt = db.prepare(
    "SELECT code FROM municipalities WHERE name = ? LIMIT 1",
  );
  const residentialAreaStmt = db.prepare(
    [
      "SELECT center_lat AS lat, center_lng AS lon, name",
      "FROM residential_areas",
      "WHERE name = ?",
      "  AND municipality_code = ?",
      "  AND center_lat IS NOT NULL",
      "  AND center_lng IS NOT NULL",
      "LIMIT 1",
    ].join(" "),
  );
  const residentialAreasByMunicipalityStmt = db.prepare(
    [
      "SELECT center_lat AS lat, center_lng AS lon, name",
      "FROM residential_areas",
      "WHERE municipality_code = ?",
      "  AND center_lat IS NOT NULL",
      "  AND center_lng IS NOT NULL",
    ].join(" "),
  );

  let skippedCommaLookup = 0;
  let lookedUpCount = 0;
  let resolvedCount = 0;
  let unresolvedCount = 0;
  let fuzzyResolvedCount = 0;
  const newlyResolvedLogs: string[] = [];
  const fuzzyResolvedLogs: string[] = [];
  const unresolvedLogs: string[] = [];
  const residentialAreaCacheByMunicipality = new Map<number, ResidentialAreaRow[]>();

  const geocodes: StationGeocodeRecord[] = [];

  for (const station of catalog) {
    const query = buildQuery(station.company, station.parsed_address);
    const existing = existingByStationId.get(station.station_id);

    if (hasComma(station.parsed_address)) {
      skippedCommaLookup += 1;
      if (existing) {
        geocodes.push({ ...existing, query });
      } else {
        geocodes.push({
          station_id: station.station_id,
          lat: null,
          lon: null,
          display_name: null,
          query,
          geocode_updated_at: null,
          status: "unresolved",
        });
      }
      continue;
    }

    lookedUpCount += 1;

    const municipality = municipalityStmt.get(station.region) as
      | { code: number }
      | undefined;

    if (!municipality) {
      unresolvedCount += 1;
      geocodes.push({
        station_id: station.station_id,
        lat: null,
        lon: null,
        display_name: null,
        query,
        geocode_updated_at: null,
        status: "unresolved",
      });
      unresolvedLogs.push(
        `${station.station_id} | ${station.parsed_address} | ${station.region} | municipality_not_found`,
      );
      continue;
    }

    const exactNameCandidates = [
      station.parsed_address,
      normalizeAreaName(station.parsed_address),
    ].filter((value, index, array) => array.indexOf(value) === index);

    let area: ResidentialAreaRow | undefined;
    for (const candidateName of exactNameCandidates) {
      area = residentialAreaStmt.get(
        candidateName,
        municipality.code,
      ) as ResidentialAreaRow | undefined;
      if (area) {
        break;
      }
    }

    let fuzzyMatch: FuzzyMatch | null = null;
    if (!area) {
      if (!residentialAreaCacheByMunicipality.has(municipality.code)) {
        const rows = residentialAreasByMunicipalityStmt.all(
          municipality.code,
        ) as ResidentialAreaRow[];
        residentialAreaCacheByMunicipality.set(municipality.code, rows);
      }
      const candidates =
        residentialAreaCacheByMunicipality.get(municipality.code) ?? [];
      fuzzyMatch = chooseFuzzyMatch(station.parsed_address, candidates);
      area = fuzzyMatch?.area;
    }

    if (!area) {
      unresolvedCount += 1;
      geocodes.push({
        station_id: station.station_id,
        lat: null,
        lon: null,
        display_name: null,
        query,
        geocode_updated_at: null,
        status: "unresolved",
      });
      unresolvedLogs.push(
        `${station.station_id} | ${station.parsed_address} | ${station.region} | residential_area_not_found`,
      );
      continue;
    }

    resolvedCount += 1;
    if (fuzzyMatch) {
      fuzzyResolvedCount += 1;
      fuzzyResolvedLogs.push(
        `${station.station_id} | ${station.parsed_address} | ${station.region} -> ${area.name} | d=${fuzzyMatch.distance} s=${fuzzyMatch.similarity.toFixed(3)}`,
      );
    }
    geocodes.push({
      station_id: station.station_id,
      lat: area.lat,
      lon: area.lon,
      display_name: `${area.name}, ${station.region}, Lietuva`,
      query,
      geocode_updated_at: nowIso,
      status: "resolved",
    });

    if (!existing || existing.status !== "resolved") {
      newlyResolvedLogs.push(
        `${station.station_id} | ${station.parsed_address} | ${station.region} -> (${area.lat}, ${area.lon})`,
      );
    }
  }

  geocodes.sort((a, b) => a.station_id.localeCompare(b.station_id));
  db.close();

  if (!dryRun) {
    await fs.writeFile(STATION_GEOCODES_PATH, `${JSON.stringify(geocodes, null, 2)}\n`, "utf8");
  }

  console.log(
    [
      `Mode: ${dryRun ? "dry-run" : "write"}`,
      `Catalog stations: ${catalog.length}`,
      `Lookups attempted (no comma): ${lookedUpCount}`,
      `Lookups skipped (has comma): ${skippedCommaLookup}`,
      `Resolved from SQLite: ${resolvedCount}`,
      `Resolved via fuzzy fallback: ${fuzzyResolvedCount}`,
      `Unresolved from SQLite: ${unresolvedCount}`,
      `Newly resolved: ${newlyResolvedLogs.length}`,
    ].join("\n"),
  );
  if (fuzzyResolvedLogs.length > 0) {
    console.log("\nFuzzy-resolved stations:");
    for (const line of fuzzyResolvedLogs) {
      console.log(`  ~ ${line}`);
    }
  }


  if (newlyResolvedLogs.length > 0) {
    console.log("\nNewly resolved stations:");
    for (const line of newlyResolvedLogs) {
      console.log(`  + ${line}`);
    }
  }

  if (unresolvedLogs.length > 0) {
    console.log("\nUnresolved stations:");
    for (const line of unresolvedLogs) {
      console.log(`  - ${line}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
