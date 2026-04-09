## Learned User Preferences

- Geocode station locations with address plus country only (e.g. `…, Lietuva`); omit region/municipality from the query when it hurts match quality.
- For comma-separated address fields, normalize so the town or locality is last and the street (or single town-only value) ordering is consistent before geocoding.

## Learned Workspace Facts

- This project is a Lithuanian fuel-price map built with Astro, TypeScript, and React; the map uses Leaflet with marker clustering and OpenStreetMap tiles, and default marker images should come from bundled Leaflet assets rather than remote CDN URLs.
- Excel inputs follow `DK-YYYY-MM-DD.xlsx` naming; files are not committed to the repo—GitHub Actions downloads them in CI for GitHub Pages builds, then runs npm scripts `import:data`, `geocode:data`, and `build:data`.
- Geocoding uses OpenStreetMap Nominatim with a persistent cache at `data/geocode-cache.json`; lookups skip the network when a normalized address is already cached.
- The UI uses shadcn/ui; fuel kinds in code and generated data use English identifiers (`gasoline`, `diesel`, `lpg`) while Lithuanian names are used in the UI.
