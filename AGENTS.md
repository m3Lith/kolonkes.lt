## Learned User Preferences

- Geocode station locations with address plus country only (e.g. `…, Lietuva`); omit region/municipality from the query when it hurts match quality.
- For comma-separated address fields, normalize so the town or locality is last and the street (or single town-only value) ordering is consistent before geocoding.
- Prefer Leaflet marker clustering that is less aggressive than library defaults (e.g. a smaller `maxClusterRadius`) so nearby stations stay as separate markers longer while zooming.

## Learned Workspace Facts

- This project is a Lithuanian fuel-price map built with Astro, TypeScript, and React; the map uses Leaflet with marker clustering and OpenStreetMap tiles, and default marker images should come from bundled Leaflet assets rather than remote CDN URLs.
- Source Excel workbooks are not kept in the repo: the ENA.lt sync workflow downloads from `uploads/{year}-EDAC/dk-degalinese-{year}/`, tries `dk-YYYY-MM-DD.xlsx` then `DK-YYYY-MM-DD.xlsx`, saves as `data/dk-YYYY-MM-DD.xlsx`, runs `build:data` and `build`, deletes the downloaded xlsx, and commits updates to `src/data/`, `data/geocode-cache.json`, and `data/unresolved-geocodes.json` when outputs change (scheduled sync uses `Europe/Vilnius` for the default date).
- GitHub Pages deploy builds set Astro `site` and `base` via `ASTRO_SITE` and `ASTRO_BASE` from the repository URL, or from `PAGES_CUSTOM_DOMAIN` with base `/` when that variable is set.
- Workbooks use a wide table (one row per station with separate price columns per fuel type); the parser finds the header row by matching expected column names after normalizing Lithuanian text (e.g. stripping diacritics for comparison).
- `station_id` is a stable hash of `company`, `region`, and **raw** workbook address (`raw_address`), not `parsed_address`.
- `raw_address` in the catalog reflects the XLS cell with whitespace normalization only; `parsed_address` is derived with `normalizeAddressTownLast` (trailing comma/space trimming lives inside that path). On merge, an existing station keeps its stored `raw_address` while `parsed_address` may update.
- After import, if a station’s stored geocode query no longer matches the catalog `parsed_address` (same normalized key as `buildGeocodeKey`), lat/lon/display_name are cleared and status is unresolved until geocoding runs again.
- `src/data/fuel-prices/latest.json` lists only stations present in the current import; stations absent from the file have no row. `catalog.json` `updated_at` changes only for stations that appear in the import snapshot.
- Geocoding uses OpenStreetMap Nominatim with a persistent cache at `data/geocode-cache.json`; lookups skip the network when a normalized address is already cached.
- The UI uses shadcn/ui; fuel kinds in code and generated data use English identifiers (`gasoline`, `diesel`, `lpg`) while Lithuanian names are used in the UI.
