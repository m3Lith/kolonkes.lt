import fs from 'node:fs/promises'
import path from 'node:path'

import type { GeocodeCache, GeocodeEntry } from "./types";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function loadGeocodeCache(
  cachePath: string,
): Promise<GeocodeCache> {
  try {
    const content = await fs.readFile(cachePath, "utf8");
    return JSON.parse(content) as GeocodeCache;
  } catch (error) {
    const maybe = error as NodeJS.ErrnoException;
    if (maybe.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

export async function saveGeocodeCache(
  cachePath: string,
  cache: GeocodeCache,
): Promise<void> {
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}

export async function geocodeWithNominatim(
  queryAddress: string,
  userAgent: string,
): Promise<GeocodeEntry | null> {
  const referer = process.env.NOMINATIM_REFERER ?? "https://kolonkės.lt/";
  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("q", queryAddress);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "lt");
  url.searchParams.set("addressdetails", "0");

  console.log("Geocoding:", url.toString());

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          "User-Agent": userAgent,
          Referer: referer,
          "Accept-Language": "lt,en",
        },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      if (attempt < 3) {
        await sleep(attempt * 1500);
        continue;
      }
      throw error;
    }

    if (!response.ok) {
      if (attempt < 3) {
        const retryAfter = Number(response.headers.get("retry-after") ?? "0");
        const waitMs =
          response.status === 429
            ? Math.max(retryAfter * 1000, attempt * 5000)
            : attempt * 1500;
        await sleep(waitMs);
        continue;
      }
      return null;
    }

    const data = (await response.json()) as Array<{
      lat: string;
      lon: string;
      display_name?: string;
    }>;
    const hit = data[0];
    if (!hit) {
      return null;
    }

    return {
      lat: Number(hit.lat),
      lon: Number(hit.lon),
      displayName: hit.display_name,
      updatedAt: new Date().toISOString(),
      query: queryAddress,
    };
  }

  return null;
}

export async function geocodeWithRateLimit(
  queryAddress: string,
  userAgent: string,
  delayMs: number,
): Promise<GeocodeEntry | null> {
  const result = await geocodeWithNominatim(queryAddress, userAgent);
  await sleep(delayMs);
  return result;
}
