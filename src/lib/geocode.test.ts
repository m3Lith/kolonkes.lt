import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadGeocodeCache, saveGeocodeCache } from "./geocode";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true });
    }),
  );
  tempDirs.length = 0;
});

describe("geocode cache persistence", () => {
  it("loads empty cache when file is missing", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fuel-map-test-"));
    tempDirs.push(dir);
    const cachePath = path.join(dir, "cache.json");
    await expect(loadGeocodeCache(cachePath)).resolves.toEqual({});
  });

  it("writes and reads cache entries", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fuel-map-test-"));
    tempDirs.push(dir);
    const cachePath = path.join(dir, "cache.json");
    const cache = {
      key: {
        lat: 55.93,
        lon: 23.31,
        updatedAt: "2026-04-08T00:00:00.000Z",
        query: "Vilniaus g.16, Siauliai, Lietuva",
      },
    };
    await saveGeocodeCache(cachePath, cache);
    await expect(loadGeocodeCache(cachePath)).resolves.toEqual(cache);
  });
});
