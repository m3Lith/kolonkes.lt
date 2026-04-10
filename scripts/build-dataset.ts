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

import type {
  DailyFuelPriceRecord,
  FuelType,
  GeocodeCache,
  NormalizedFuelRow,
  StationCatalogRecord,
  StationGeocodeRecord,
} from "../src/lib/types";

type Mode = "import" | "geocode" | "build";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const CACHE_PATH = path.join(DATA_DIR, "geocode-cache.json");
const UNRESOLVED_PATH = path.join(DATA_DIR, "unresolved-geocodes.json");
const OUTPUT_FUEL_DIR = path.join(ROOT, "src", "data", "fuel-prices");
const OUTPUT_STATION_DIR = path.join(ROOT, "src", "data", "stations");
const OUTPUT_GEOCODE_DIR = path.join(ROOT, "src", "data", "station-geocodes");
const OUTPUT_STATION_CATALOG = path.join(OUTPUT_STATION_DIR, "catalog.json");
const OUTPUT_STATION_GEOCODES = path.join(OUTPUT_GEOCODE_DIR, "latest.json");
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
    const rawAddress = normalizeWhitespace(row.address);
    const parsedAddress = normalizeAddressTownLast(rawAddress);
    return {
      date,
      company,
      region,
      rawAddress,
      parsedAddress,
      fuelType: normalizeFuelType(row.fuelType),
      pricePerLiter: normalizePrice(row.priceRaw),
      stationId: buildStationId(company, region, rawAddress),
    };
  });
}

function rowsToStationSnapshot(
  rows: NormalizedFuelRow[],
): StationCatalogRecord[] {
  const stationMap = new Map<string, StationCatalogRecord>();
  for (const row of rows) {
    if (stationMap.has(row.stationId)) {
      continue;
    }
    stationMap.set(row.stationId, {
      station_id: row.stationId,
      company: row.company,
      region: row.region,
      raw_address: row.rawAddress,
      parsed_address: row.parsedAddress,
      created_at: "",
      updated_at: "",
    });
  }
  return [...stationMap.values()];
}

function rowsToDailyFuelPrices(
  rows: NormalizedFuelRow[],
): DailyFuelPriceRecord[] {
  const byStation = new Map<string, DailyFuelPriceRecord>();
  for (const row of rows) {
    if (!byStation.has(row.stationId)) {
      byStation.set(row.stationId, {
        station_id: row.stationId,
        date: row.date,
        gasoline: null,
        diesel: null,
        lpg: null,
      });
    }
    const record = byStation.get(row.stationId)!;
    record[row.fuelType] = row.pricePerLiter;
  }
  return [...byStation.values()].sort((a, b) =>
    a.station_id.localeCompare(b.station_id),
  );
}

function isLegacyFuelRow(
  value: unknown,
): value is {
  stationId: string;
  date: string;
  fuelType: FuelType;
  pricePerLiter: number | null;
} {
  if (!value || typeof value !== "object") {
    return false;
  }
  const row = value as Record<string, unknown>;
  return (
    typeof row.stationId === "string" &&
    typeof row.date === "string" &&
    (row.fuelType === "gasoline" ||
      row.fuelType === "diesel" ||
      row.fuelType === "lpg")
  );
}

function legacyRowsToDailyFuelPrices(
  rows: Array<{
    stationId: string;
    date: string;
    fuelType: FuelType;
    pricePerLiter: number | null;
  }>,
): DailyFuelPriceRecord[] {
  const grouped = new Map<string, DailyFuelPriceRecord>();
  for (const row of rows) {
    const key = `${row.stationId}|${row.date}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        station_id: row.stationId,
        date: row.date,
        gasoline: null,
        diesel: null,
        lpg: null,
      });
    }
    const record = grouped.get(key)!;
    record[row.fuelType] = row.pricePerLiter;
  }
  return [...grouped.values()].sort(
    (a, b) =>
      a.date.localeCompare(b.date) || a.station_id.localeCompare(b.station_id),
  );
}

async function ensureOutputDirs(): Promise<void> {
  await Promise.all([
    fs.mkdir(OUTPUT_FUEL_DIR, { recursive: true }),
    fs.mkdir(OUTPUT_STATION_DIR, { recursive: true }),
    fs.mkdir(OUTPUT_GEOCODE_DIR, { recursive: true }),
    fs.mkdir(path.dirname(OUTPUT_LATEST), { recursive: true }),
  ]);
}

async function readJsonOptional<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    const maybe = error as NodeJS.ErrnoException;
    if (maybe.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

async function loadStationCatalog(): Promise<StationCatalogRecord[]> {
  return readJsonOptional<StationCatalogRecord[]>(OUTPUT_STATION_CATALOG, []);
}

async function loadStationGeocodes(): Promise<StationGeocodeRecord[]> {
  return readJsonOptional<StationGeocodeRecord[]>(OUTPUT_STATION_GEOCODES, []);
}

function mergeStationCatalog(
  existingCatalog: StationCatalogRecord[],
  snapshot: StationCatalogRecord[],
  nowIso: string,
): StationCatalogRecord[] {
  const catalogMap = new Map(
    existingCatalog.map((record) => [record.station_id, record] as const),
  );

  for (const station of snapshot) {
    const existing = catalogMap.get(station.station_id);
    if (!existing) {
      catalogMap.set(station.station_id, {
        ...station,
        created_at: nowIso,
        updated_at: nowIso,
      });
      continue;
    }

    catalogMap.set(station.station_id, {
      ...existing,
      company: station.company,
      region: station.region,
      raw_address: station.raw_address,
      parsed_address: station.parsed_address,
      updated_at: nowIso,
    });
  }

  return [...catalogMap.values()].sort(
    (a, b) =>
      a.company.localeCompare(b.company) ||
      a.region.localeCompare(b.region) ||
      a.parsed_address.localeCompare(b.parsed_address),
  );
}

function geocodeQueryMatchesParsedAddress(
  geocodeQuery: string,
  parsedAddress: string,
): boolean {
  const fromQuery = geocodeQuery.replace(/,\s*Lietuva\s*$/i, "").trim();
  return buildGeocodeKey(fromQuery) === buildGeocodeKey(parsedAddress);
}

function seedStationGeocodes(
  catalog: StationCatalogRecord[],
  cache: GeocodeCache,
  existingGeocodes: StationGeocodeRecord[],
): StationGeocodeRecord[] {
  const existingMap = new Map(
    existingGeocodes.map((record) => [record.station_id, record] as const),
  );
  return catalog
    .map((station) => {
      const existing = existingMap.get(station.station_id);
      const cacheEntry = cache[buildGeocodeKey(station.parsed_address)];
      if (cacheEntry) {
        return {
          station_id: station.station_id,
          lat: cacheEntry.lat,
          lon: cacheEntry.lon,
          display_name: cacheEntry.displayName ?? null,
          query: cacheEntry.query,
          geocode_updated_at: cacheEntry.updatedAt,
          status: "resolved" as const,
        };
      }
      const query = `${station.parsed_address}, Lietuva`;
      if (existing) {
        if (
          !geocodeQueryMatchesParsedAddress(
            existing.query,
            station.parsed_address,
          )
        ) {
          return {
            station_id: station.station_id,
            lat: null,
            lon: null,
            display_name: null,
            query,
            geocode_updated_at: null,
            status: "unresolved" as const,
          };
        }
        return { ...existing, query };
      }
      return {
        station_id: station.station_id,
        lat: null,
        lon: null,
        display_name: null,
        query,
        geocode_updated_at: null,
        status: "unresolved" as const,
      };
    })
    .sort((a, b) => a.station_id.localeCompare(b.station_id));
}

async function geocodeStations(
  geocodes: StationGeocodeRecord[],
  catalogById: Map<string, StationCatalogRecord>,
  cache: GeocodeCache,
): Promise<{ unresolvedCount: number; updatedCache: GeocodeCache }> {
  let unresolvedCount = 0;
  let processed = 0;
  let consecutiveUnresolved = 0;

  for (let index = 0; index < geocodes.length; index += 1) {
    const geocode = geocodes[index];
    const station = catalogById.get(geocode.station_id);
    if (!station) {
      continue;
    }

    const cacheKey = buildGeocodeKey(station.parsed_address);
    const cached = cache[cacheKey];
    if (cached) {
      geocode.lat = cached.lat;
      geocode.lon = cached.lon;
      geocode.display_name = cached.displayName ?? null;
      geocode.query = cached.query;
      geocode.geocode_updated_at = cached.updatedAt;
      geocode.status = "resolved";
      consecutiveUnresolved = 0;
      continue;
    }

    const resolved = await geocodeWithRateLimit(
      geocode.query,
      USER_AGENT,
      1337,
    );
    processed += 1;

    if (!resolved) {
      geocode.lat = null;
      geocode.lon = null;
      geocode.display_name = null;
      geocode.status = "unresolved";
      geocode.geocode_updated_at ??= new Date().toISOString();
      unresolvedCount += 1;
      consecutiveUnresolved += 1;
      if (consecutiveUnresolved >= 10) {
        for (const remaining of geocodes.slice(index + 1)) {
          const remainingStation = catalogById.get(remaining.station_id);
          if (!remainingStation) {
            continue;
          }
          const remainingKey = buildGeocodeKey(remainingStation.parsed_address);
          const remainingCached = cache[remainingKey];
          if (remainingCached) {
            remaining.lat = remainingCached.lat;
            remaining.lon = remainingCached.lon;
            remaining.display_name = remainingCached.displayName ?? null;
            remaining.query = remainingCached.query;
            remaining.geocode_updated_at = remainingCached.updatedAt;
            remaining.status = "resolved";
          } else {
            remaining.lat = null;
            remaining.lon = null;
            remaining.display_name = null;
            remaining.status = "unresolved";
            remaining.geocode_updated_at ??= new Date().toISOString();
            unresolvedCount += 1;
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
    geocode.lat = resolved.lat;
    geocode.lon = resolved.lon;
    geocode.display_name = resolved.displayName ?? null;
    geocode.query = resolved.query;
    geocode.geocode_updated_at = resolved.updatedAt;
    geocode.status = "resolved";

    if (processed % 25 === 0) {
      await saveGeocodeCache(CACHE_PATH, cache);
      // Keep cache safe during long geocode runs.
      console.log(`Geocoded ${processed} new addresses...`);
    }
  }

  return { unresolvedCount, updatedCache: cache };
}

async function writeOutputs(
  date: string,
  dailyPrices: DailyFuelPriceRecord[],
  catalog: StationCatalogRecord[],
  geocodes: StationGeocodeRecord[],
): Promise<void> {
  const fuelByDatePath = path.join(OUTPUT_FUEL_DIR, `${date}.json`);
  const fuelLatestPath = path.join(OUTPUT_FUEL_DIR, "latest.json");

  await Promise.all([
    fs.writeFile(
      fuelByDatePath,
      `${JSON.stringify(dailyPrices, null, 2)}\n`,
      "utf8",
    ),
    fs.writeFile(
      fuelLatestPath,
      `${JSON.stringify(dailyPrices, null, 2)}\n`,
      "utf8",
    ),
    fs.writeFile(
      OUTPUT_STATION_CATALOG,
      `${JSON.stringify(catalog, null, 2)}\n`,
      "utf8",
    ),
    fs.writeFile(
      OUTPUT_STATION_GEOCODES,
      `${JSON.stringify(geocodes, null, 2)}\n`,
      "utf8",
    ),
    fs.writeFile(
      OUTPUT_LATEST,
      `${JSON.stringify(
        {
          date,
          stations_catalog_path: "src/data/stations/catalog.json",
          station_geocodes_path: "src/data/station-geocodes/latest.json",
          fuel_prices_path: `src/data/fuel-prices/${date}.json`,
        },
        null,
        2,
      )}\n`,
      "utf8",
    ),
  ]);
}

async function cleanupLegacyOutputs(): Promise<void> {
  try {
    const fuelFiles = await fs.readdir(OUTPUT_FUEL_DIR);
    for (const fileName of fuelFiles) {
      if (!fileName.endsWith(".json")) {
        continue;
      }
      const filePath = path.join(OUTPUT_FUEL_DIR, fileName);
      const parsed = await readJsonOptional<unknown>(filePath, []);
      if (
        !Array.isArray(parsed) ||
        parsed.length === 0 ||
        !isLegacyFuelRow(parsed[0])
      ) {
        continue;
      }
      const migrated = legacyRowsToDailyFuelPrices(
        parsed.filter(isLegacyFuelRow),
      );
      await fs.writeFile(
        filePath,
        `${JSON.stringify(migrated, null, 2)}\n`,
        "utf8",
      );
    }
  } catch (error) {
    const maybe = error as NodeJS.ErrnoException;
    if (maybe.code !== "ENOENT") {
      throw error;
    }
  }

  try {
    const stationFiles = await fs.readdir(OUTPUT_STATION_DIR);
    await Promise.all(
      stationFiles
        .filter(
          (fileName) =>
            fileName.endsWith(".json") && fileName !== "catalog.json",
        )
        .map((fileName) => fs.unlink(path.join(OUTPUT_STATION_DIR, fileName))),
    );
  } catch (error) {
    const maybe = error as NodeJS.ErrnoException;
    if (maybe.code !== "ENOENT") {
      throw error;
    }
  }

  await fs.unlink(UNRESOLVED_PATH).catch((error: unknown) => {
    const maybe = error as NodeJS.ErrnoException;
    if (maybe.code !== "ENOENT") {
      throw error;
    }
  });
}

async function main(): Promise<void> {
  const mode = getMode();
  const latest = await findLatestWorkbook();
  await ensureOutputDirs();

  const rows = normalizeRows(latest.filePath, latest.date);
  const stationSnapshot = rowsToStationSnapshot(rows);
  const dailyPrices = rowsToDailyFuelPrices(rows);
  const nowIso = new Date().toISOString();

  const existingCatalog = await loadStationCatalog();
  const catalog = mergeStationCatalog(existingCatalog, stationSnapshot, nowIso);
  const catalogById = new Map(
    catalog.map((station) => [station.station_id, station] as const),
  );

  const cache = await loadGeocodeCache(CACHE_PATH);
  const existingGeocodes = await loadStationGeocodes();
  const geocodes = seedStationGeocodes(catalog, cache, existingGeocodes);

  if (mode === "import") {
    await writeOutputs(latest.date, dailyPrices, catalog, geocodes);
    await cleanupLegacyOutputs();
    console.log(
      `Imported ${dailyPrices.length} station price rows from ${path.basename(latest.filePath)}`,
    );
    return;
  }

  const { unresolvedCount, updatedCache } = await geocodeStations(
    geocodes,
    catalogById,
    cache,
  );
  await saveGeocodeCache(CACHE_PATH, updatedCache);
  await writeOutputs(latest.date, dailyPrices, catalog, geocodes);
  await cleanupLegacyOutputs();

  console.log(
    `${mode === "geocode" ? "Geocoded" : "Built"} dataset: ${catalog.length} stations, ${unresolvedCount} unresolved.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
