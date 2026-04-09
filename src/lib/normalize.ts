import { createHash } from "node:crypto";
import { FUEL_TYPES, type FuelType } from "./types";

const FUEL_ALIASES: Record<string, FuelType> = {
  "95 markes benzinas": "gasoline",
  dyzelinas: "diesel",
  "suskystintosios naftos dujos": "lpg",
  gasoline: "gasoline",
  diesel: "diesel",
  lpg: "lpg",
};

export function normalizeWhitespace(input: string): string {
  return input.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

export function removeDiacritics(input: string): string {
  return input.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function normalizeText(input: string): string {
  return removeDiacritics(normalizeWhitespace(input));
}

const STREET_HINT_RE =
  /\b(g\.|gatve|pr\.|prospektas|pl\.|plentas|aleja|al\.|kelias|kel\.)\b/i;

function looksLikeStreetPart(value: string): boolean {
  const normalized = normalizeText(value).toLowerCase();
  return STREET_HINT_RE.test(normalized) || /\d+[a-z]?/i.test(normalized);
}

export function normalizeAddressTownLast(address: string): string {
  const clean = normalizeWhitespace(address);
  const parts = clean.split(",").map((part) => normalizeWhitespace(part));
  if (parts.length !== 2) {
    return clean;
  }
  const [left, right] = parts;
  const leftStreet = looksLikeStreetPart(left);
  const rightStreet = looksLikeStreetPart(right);

  if (!leftStreet && rightStreet) {
    return `${right}, ${left}`;
  }
  return clean;
}

export function parseDateFromFilename(fileName: string): string {
  const dkMatch = fileName.match(/dk-(\d{4})-(\d{2})-(\d{2})\.xlsx$/i);
  if (dkMatch) {
    return `${dkMatch[1]}-${dkMatch[2]}-${dkMatch[3]}`;
  }

  throw new Error(`Could not parse date from file name: ${fileName}`);
}

export function normalizeFuelType(value: string): FuelType {
  const key = normalizeText(value).toLowerCase();
  const fuel = FUEL_ALIASES[key];
  if (!fuel) {
    throw new Error(
      `Unsupported fuel type "${value}". Supported: ${FUEL_TYPES.join(", ")}`,
    );
  }
  return fuel;
}

export function normalizePrice(value: string | number): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Number(value.toFixed(3)) : null;
  }
  const clean = normalizeWhitespace(String(value));
  const normalized = normalizeText(clean).toLowerCase();
  if (!clean || normalized === "neprekiauja" || normalized === "nepateike") {
    return null;
  }
  const parsed = Number(clean.replace(",", "."));
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid price value: ${value}`);
  }
  return Number(parsed.toFixed(3));
}

export function buildStationId(
  company: string,
  region: string,
  address: string,
): string {
  return createHash("sha1")
    .update(`${company}|${region}|${address}`)
    .digest("hex")
    .slice(0, 16);
}

export function buildGeocodeKey(address: string): string {
  return normalizeText(address).toLowerCase();
}
