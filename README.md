# Fuel Map Website

Astro + TypeScript web app that:

- parses Lithuanian fuel price Excel files from `data/`
- normalizes rows into structured JSON datasets
- geocodes station addresses (Google Geocoding API by default) with persistent cache
- renders clustered station markers on a Leaflet map

## Input format

Place files in `data/` using this name format:

- `dk-YYYY-MM-DD.xlsx`

Example:

- `dk-2026-04-08.xlsx` -> dataset date `2026-04-08`

Note: `.xlsx` source files are intentionally ignored by git. CI downloads them on demand.

The parser expects these Lithuanian table columns:

- `Data`
- `Imone (Degaliniu tinklas)`
- `Degalines vieta (Savivaldybe)`
- `Degalines vieta (Gyvenviete, gatve)`
- `95 benzinas`
- `Dyzelinas`
- `SND`

The script handles diacritics and non-breaking spaces, and converts `Neprekiauja` to `null`.

## Data outputs

Generated files:

- `src/data/fuel-prices/<date>.json`
- `src/data/fuel-prices/latest.json`
- `src/data/stations/catalog.json`
- `src/data/station-geocodes/latest.json`
- `src/data/latest.json`
- `data/geocode-cache.json`

## Commands

- `npm install` - install dependencies
- `npm run import:data` - parse and normalize latest workbook
- `npm run geocode:data` - geocode latest stations and refresh outputs
- `npm run build:data` - full pipeline (parse + geocode + outputs)
- `npm run dev` - start local app
- `npm run build` - production build
- `npm run test` - run unit tests

## Geocoding provider setup

Geocoding is provider-based:

- default provider: `google`
- optional provider: `nominatim`

Google setup (default):

- `GOOGLE_GEOCODING_API_KEY` (required)
- `GOOGLE_GEOCODING_LANGUAGE` (optional, default `lt`)
- `GOOGLE_GEOCODING_REGION` (optional, default `lt`)

Optional fallback to Nominatim:

- `GEOCODING_PROVIDER=nominatim`
- `NOMINATIM_USER_AGENT`
- `NOMINATIM_REFERER`

Example (Google):

```sh
export GEOCODING_PROVIDER=google
export GOOGLE_GEOCODING_API_KEY="your-api-key"
npm run geocode:data
```

If provider throttling happens, unresolved stations remain in `src/data/station-geocodes/latest.json` with `status: "unresolved"` and `lat/lon: null`. Re-run `npm run geocode:data` later; cached results are reused and only missing addresses are queried.

## GitHub Pages deployment

This repo includes a workflow at `.github/workflows/deploy.yml` that deploys to GitHub Pages on each push to `main`.

Setup steps in GitHub:

- Go to **Settings -> Pages**
- Set **Source** to **GitHub Actions**

The workflow automatically computes Astro `site` and `base`:

- User/org site repo (`<owner>.github.io`) -> base `/`
- Project site repo (`<owner>.github.io/<repo>`) -> base `/<repo>`
- Custom domain via repository variable `PAGES_CUSTOM_DOMAIN` -> base `/`

For custom domains with GitHub Actions deployment:

- Keep custom domain configured in **Settings -> Pages**
- Add repository variable `PAGES_CUSTOM_DOMAIN`
- `public/CNAME` is not required

If you update data before deployment, run:

```sh
npm run build:data
npm run build
```

## Scheduled ENA sync

This repo also includes `.github/workflows/sync-data.yml` that can run daily and fetch the source file from:

- `https://www.ena.lt/uploads/<year>-EDAC/dk-degalinese-<year>/dk-<YYYY-MM-DD>.xlsx` (fallback to uppercase `DK-...`)

The workflow:

- downloads `dk-YYYY-MM-DD.xlsx` into `data/`
- runs `npm run build:data` and `npm run build`
- removes downloaded `.xlsx`
- commits changed JSON data files back to `main`

When that commit lands, `.github/workflows/deploy.yml` publishes the updated site to GitHub Pages.
