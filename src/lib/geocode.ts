import fs from "node:fs/promises";
import path from "node:path";
import { domainToASCII } from "node:url";

import type { GeocodeCache, GeocodeEntry } from "./types";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const GOOGLE_GEOCODING_URL =
  "https://maps.googleapis.com/maps/api/geocode/json";
type GeocodingProvider = "google" | "nominatim";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeHeaderValue(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x00-\xff]/g, "");
}

function normalizeReferer(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    const asciiHost = domainToASCII(parsed.hostname);
    if (asciiHost) {
      parsed.hostname = asciiHost;
    }
    const safe = sanitizeHeaderValue(parsed.toString());
    return safe || undefined;
  } catch {
    return undefined;
  }
}

function getGeocodingProvider(): GeocodingProvider {
  const raw = (process.env.GEOCODING_PROVIDER ?? "google").trim().toLowerCase();
  if (raw === "google" || raw === "nominatim") {
    return raw;
  }
  throw new Error(
    `Unsupported GEOCODING_PROVIDER "${process.env.GEOCODING_PROVIDER}". Use "google" or "nominatim".`,
  );
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
  const referer = normalizeReferer(
    process.env.NOMINATIM_REFERER ?? "https://kolonkės.lt/",
  );
  const safeUserAgent = sanitizeHeaderValue(userAgent) || "fuel-map/1.0";
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
      const headers: Record<string, string> = {
        "User-Agent": safeUserAgent,
        "Accept-Language": "lt,en",
      };
      if (referer) {
        headers.Referer = referer;
      }

      response = await fetch(url, {
        headers,
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

export async function geocodeWithGoogle(
  queryAddress: string,
): Promise<GeocodeEntry | null> {
  const apiKey = process.env.GOOGLE_GEOCODING_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Missing GOOGLE_GEOCODING_API_KEY for Google geocoding.");
  }

  const language = (process.env.GOOGLE_GEOCODING_LANGUAGE ?? "lt").trim();
  const region = (process.env.GOOGLE_GEOCODING_REGION ?? "lt").trim();
  const url = new URL(GOOGLE_GEOCODING_URL);
  url.searchParams.set("address", queryAddress);
  url.searchParams.set("key", apiKey);
  if (language) {
    url.searchParams.set("language", language);
  }
  if (region) {
    url.searchParams.set("region", region);
  }
  url.searchParams.set("components", "country:LT");

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    } catch (error) {
      if (attempt < 3) {
        await sleep(attempt * 1500);
        continue;
      }
      throw error;
    }

    if (!response.ok) {
      if (attempt < 3) {
        await sleep(attempt * 1500);
        continue;
      }
      return null;
    }

    const data = (await response.json()) as {
      status?: string;
      error_message?: string;
      results?: Array<{
        formatted_address?: string;
        geometry?: { location?: { lat?: number; lng?: number } };
      }>;
    };
    console.log("data", data);
    const status = data.status ?? "UNKNOWN_ERROR";

    if (status === "OK") {
      const hit = data.results?.[0];
      const lat = hit?.geometry?.location?.lat;
      const lon = hit?.geometry?.location?.lng;
      if (typeof lat !== "number" || typeof lon !== "number") {
        return null;
      }
      return {
        lat,
        lon,
        displayName: hit?.formatted_address,
        updatedAt: new Date().toISOString(),
        query: queryAddress,
      };
    }

    if (status === "ZERO_RESULTS") {
      return null;
    }

    if (status === "UNKNOWN_ERROR" && attempt < 3) {
      await sleep(attempt * 1500);
      continue;
    }

    if (
      status === "REQUEST_DENIED" ||
      status === "INVALID_REQUEST" ||
      status === "OVER_DAILY_LIMIT" ||
      status === "OVER_QUERY_LIMIT"
    ) {
      throw new Error(
        `Google geocoding failed with ${status}${data.error_message ? `: ${data.error_message}` : ""}`,
      );
    }

    return null;
  }

  return null;
}

export async function geocodeWithRateLimit(
  queryAddress: string,
  userAgent: string,
  delayMs: number,
): Promise<GeocodeEntry | null> {
  const provider = getGeocodingProvider();
  const result =
    provider === "google"
      ? await geocodeWithGoogle(queryAddress)
      : await geocodeWithNominatim(queryAddress, userAgent);
  await sleep(delayMs);
  return result;
}
