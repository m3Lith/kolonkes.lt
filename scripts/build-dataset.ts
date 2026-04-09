import fs from 'node:fs/promises'
import path from 'node:path'

import { geocodeWithRateLimit, loadGeocodeCache, saveGeocodeCache } from '../src/lib/geocodeNominatim'
import {
  buildGeocodeKey,
  buildStationId,
  normalizeAddressTownLast,
  normalizeFuelType,
  normalizePrice,
  normalizeWhitespace,
  parseDateFromFilename,
} from '../src/lib/normalize'
import { parseFuelWorkbook } from '../src/lib/parseFuelWorkbook'
import { FUEL_SORT_ORDER } from '../src/lib/types'

import type {
  FuelType,
  GeocodeCache,
  NormalizedFuelRow,
  StationDataset,
  StationRecord,
} from "../src/lib/types";

type Mode = "import" | "geocode" | "build";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const CACHE_PATH = path.join(DATA_DIR, "geocode-cache.json");
const UNRESOLVED_PATH = path.join(DATA_DIR, "unresolved-geocodes.json");
const OUTPUT_FUEL_DIR = path.join(ROOT, "src", "data", "fuel-prices");
const OUTPUT_STATION_DIR = path.join(ROOT, "src", "data", "stations");
const OUTPUT_LATEST = path.join(ROOT, "src", "data", "latest.json");
const USER_AGENT =
  process.env.NOMINATIM_USER_AGENT ??
  "Mozilla/5.0 (compatible; fuel-map/1.0; +https://kolonkės.lt)";

function getMode(): Mode {
  const joinedArg = process.argv.find((arg) => arg.startsWith("--mode="));
  if (joinedArg) {
    const mode = joinedArg.split("=")[1];
    if (mode === "import" || mode === "geocode" || mode === "build") {
      return mode;
    }
  }

  const modeFlagIndex = process.argv.findIndex((arg) => arg === "--mode");
  if (modeFlagIndex !== -1) {
    const mode = process.argv[modeFlagIndex + 1];
    if (mode === "import" || mode === "geocode" || mode === "build") {
      return mode;
    }
  }

  if (!joinedArg && modeFlagIndex === -1) {
    return "build";
  }
  throw new Error("Unsupported mode. Use import, geocode, or build.");
}

async function findLatestWorkbook(): Promise<{
  filePath: string;
  date: string;
}> {
  const files = await fs.readdir(DATA_DIR);
  const candidates = files
    .filter((name) => /^dk-\d{4}-\d{2}-\d{2}\.xlsx$/i.test(name))
    .map((name) => ({ name, date: parseDateFromFilename(name) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const latest = candidates.at(-1);
  if (!latest) {
    throw new Error(
      [
        `No dk-YYYY-MM-DD.xlsx files found in ${DATA_DIR}.`,
        "Download one source file temporarily into data/ and rerun,",
        "or run the scheduled GitHub Actions sync workflow which downloads it automatically.",
      ].join(" "),
    );
  }
  return { filePath: path.join(DATA_DIR, latest.name), date: latest.date };
}

function normalizeRows(filePath: string, date: string): NormalizedFuelRow[] {
  return parseFuelWorkbook(filePath).map((row) => {
    const company = normalizeWhitespace(row.company);
    const region = normalizeWhitespace(row.region);
    const address = normalizeAddressTownLast(row.address);
    return {
      date,
      company,
      region,
      address,
      fuelType: normalizeFuelType(row.fuelType),
      pricePerLiter: normalizePrice(row.priceRaw),
      stationId: buildStationId(company, region, address),
    };
  });
}

function rowsToStations(rows: NormalizedFuelRow[]): StationRecord[] {
  const stationMap = new Map<string, StationRecord>();

  for (const row of rows) {
    const key = row.stationId;
    if (!stationMap.has(key)) {
      stationMap.set(key, {
        stationId: row.stationId,
        company: row.company,
        region: row.region,
        address: row.address,
        queryAddress: `${row.address}, Lietuva`,
        lat: null,
        lon: null,
        fuelPrices: [],
      });
    }
    const station = stationMap.get(key)!;
    station.fuelPrices.push({
      fuelType: row.fuelType,
      pricePerLiter: row.pricePerLiter,
    });
  }

  for (const station of stationMap.values()) {
    station.fuelPrices.sort(
      (a, b) =>
        FUEL_SORT_ORDER[a.fuelType as FuelType] -
        FUEL_SORT_ORDER[b.fuelType as FuelType],
    );
  }

  return [...stationMap.values()].sort(
    (a, b) =>
      a.company.localeCompare(b.company) ||
      a.region.localeCompare(b.region) ||
      a.address.localeCompare(b.address),
  );
}

function applyCachedCoordinates(
  stations: StationRecord[],
  cache: GeocodeCache,
): void {
  for (const station of stations) {
    const cacheKey = buildGeocodeKey(station.address);
    const cached = cache[cacheKey];
    if (!cached) {
      continue;
    }
    station.lat = cached.lat;
    station.lon = cached.lon;
  }
}

async function ensureOutputDirs(): Promise<void> {
  await Promise.all([
    fs.mkdir(OUTPUT_FUEL_DIR, { recursive: true }),
    fs.mkdir(OUTPUT_STATION_DIR, { recursive: true }),
    fs.mkdir(path.dirname(OUTPUT_LATEST), { recursive: true }),
  ]);
}

async function geocodeStations(
  stations: StationRecord[],
  cache: GeocodeCache,
): Promise<{ unresolved: StationRecord[]; updatedCache: GeocodeCache }> {
  const unresolved: StationRecord[] = [];
  let processed = 0;
  let consecutiveUnresolved = 0;

  for (let index = 0; index < stations.length; index += 1) {
    const station = stations[index];
    const cacheKey = buildGeocodeKey(station.address);
    const cached = cache[cacheKey];
    if (cached) {
      station.lat = cached.lat;
      station.lon = cached.lon;
      consecutiveUnresolved = 0;
      continue;
    }

    const resolved = await geocodeWithRateLimit(
      station.queryAddress,
      USER_AGENT,
      1337,
    );
    processed += 1;

    if (!resolved) {
      unresolved.push(station);
      consecutiveUnresolved += 1;
      if (consecutiveUnresolved >= 10) {
        for (const remaining of stations.slice(index + 1)) {
          const remainingKey = buildGeocodeKey(remaining.address);
          const remainingCached = cache[remainingKey];
          if (remainingCached) {
            remaining.lat = remainingCached.lat;
            remaining.lon = remainingCached.lon;
          } else {
            unresolved.push(remaining);
          }
        }
        console.warn(
          "Stopping geocode early after repeated unresolved responses (likely temporary provider throttling).",
        );
        break;
      }
      continue;
    }

    consecutiveUnresolved = 0;
    cache[cacheKey] = resolved;
    station.lat = resolved.lat;
    station.lon = resolved.lon;

    if (processed % 25 === 0) {
      await saveGeocodeCache(CACHE_PATH, cache);
      // Keep cache safe during long geocode runs.
      console.log(`Geocoded ${processed} new addresses...`);
    }
  }

  return { unresolved, updatedCache: cache };
}

async function writeOutputs(
  date: string,
  rows: NormalizedFuelRow[],
  stations: StationRecord[],
): Promise<void> {
  const fuelByDatePath = path.join(OUTPUT_FUEL_DIR, `${date}.json`);
  const stationByDatePath = path.join(OUTPUT_STATION_DIR, `${date}.json`);
  const fuelLatestPath = path.join(OUTPUT_FUEL_DIR, "latest.json");
  const stationLatestPath = path.join(OUTPUT_STATION_DIR, "latest.json");

  const stationDataset: StationDataset = {
    date,
    generatedAt: new Date().toISOString(),
    stations,
  };

  await Promise.all([
    fs.writeFile(fuelByDatePath, `${JSON.stringify(rows, null, 2)}\n`, "utf8"),
    fs.writeFile(fuelLatestPath, `${JSON.stringify(rows, null, 2)}\n`, "utf8"),
    fs.writeFile(
      stationByDatePath,
      `${JSON.stringify(stationDataset, null, 2)}\n`,
      "utf8",
    ),
    fs.writeFile(
      stationLatestPath,
      `${JSON.stringify(stationDataset, null, 2)}\n`,
      "utf8",
    ),
    fs.writeFile(
      OUTPUT_LATEST,
      `${JSON.stringify(
        {
          date,
          fuelPricesPath: `src/data/fuel-prices/${date}.json`,
          stationsPath: `src/data/stations/${date}.json`,
        },
        null,
        2,
      )}\n`,
      "utf8",
    ),
  ]);
}

async function main(): Promise<void> {
  const mode = getMode();
  const latest = await findLatestWorkbook();
  await ensureOutputDirs();

  const rows = normalizeRows(latest.filePath, latest.date);
  const stations = rowsToStations(rows);
  const cache = await loadGeocodeCache(CACHE_PATH);
  applyCachedCoordinates(stations, cache);

  if (mode === "import") {
    await writeOutputs(latest.date, rows, stations);
    console.log(
      `Imported ${rows.length} price rows from ${path.basename(latest.filePath)}`,
    );
    return;
  }

  const { unresolved, updatedCache } = await geocodeStations(stations, cache);
  await saveGeocodeCache(CACHE_PATH, updatedCache);
  await fs.writeFile(
    UNRESOLVED_PATH,
    `${JSON.stringify(unresolved, null, 2)}\n`,
    "utf8",
  );
  await writeOutputs(latest.date, rows, stations);

  console.log(
    `${mode === "geocode" ? "Geocoded" : "Built"} dataset: ${stations.length} stations, ${unresolved.length} unresolved.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
