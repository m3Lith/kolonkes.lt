## Learned User Preferences

- Geocode station locations with address plus country only (e.g. `…, Lietuva`); omit region/municipality from the query when it hurts match quality.
- For comma-separated address fields, normalize so the town or locality is last and the street (or single town-only value) ordering is consistent before geocoding.

## Learned Workspace Facts

- This project is a Lithuanian fuel-price map built with Astro, TypeScript, and React; the map uses Leaflet with marker clustering and OpenStreetMap tiles, and default marker images should come from bundled Leaflet assets rather than remote CDN URLs.
- Excel inputs are not committed: GitHub Actions downloads them from ENA.lt under `uploads/{year}-EDAC/dk-degalinese-{year}/`, tries `dk-YYYY-MM-DD.xlsx` first then `DK-YYYY-MM-DD.xlsx`, saves as `data/dk-YYYY-MM-DD.xlsx`, then runs `import:data`, `geocode:data`, and `build:data` for GitHub Pages builds.
- Workbooks use a wide table (one row per station with separate price columns per fuel type); the parser finds the header row by matching expected column names after normalizing Lithuanian text (e.g. stripping diacritics for comparison).
- Geocoding uses OpenStreetMap Nominatim with a persistent cache at `data/geocode-cache.json`; lookups skip the network when a normalized address is already cached.
- The UI uses shadcn/ui; fuel kinds in code and generated data use English identifiers (`gasoline`, `diesel`, `lpg`) while Lithuanian names are used in the UI.
