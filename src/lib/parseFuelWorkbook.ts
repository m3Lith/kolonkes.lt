import path from "node:path";
import xlsx from "xlsx";
import { z } from "zod";
import { normalizeWhitespace } from "./normalize";
import type { RawFuelRow } from "./types";

const EXPECTED_HEADERS = [
  "Imone (Degaliniu tinklas)",
  "Degalines vieta (Savivaldybe)",
  "Degalines Vieta (Gyvenviete, Gatve)",
  "Degalai",
  "Kaina uz 1 l",
] as const;

interface HeaderMap {
  rowIndex: number;
  company: number;
  region: number;
  address: number;
  fuelType: number;
  price: number;
}

const rawRowSchema = z.object({
  company: z.string().min(1),
  region: z.string().min(1),
  address: z.string().min(1),
  fuelType: z.string().min(1),
  priceRaw: z.union([z.string(), z.number()]),
});

function normalizeHeader(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findHeaders(rows: Array<Array<string | number>>): HeaderMap {
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i].map((v) => normalizeHeader(String(v ?? "")));
    const company = row.indexOf(EXPECTED_HEADERS[0]);
    const region = row.indexOf(EXPECTED_HEADERS[1]);
    const address = row.indexOf(EXPECTED_HEADERS[2]);
    const fuelType = row.indexOf(EXPECTED_HEADERS[3]);
    const price = row.indexOf(EXPECTED_HEADERS[4]);

    if (
      company !== -1 &&
      region !== -1 &&
      address !== -1 &&
      fuelType !== -1 &&
      price !== -1
    ) {
      return { rowIndex: i, company, region, address, fuelType, price };
    }
  }
  throw new Error("Could not find expected Lithuanian header row in workbook.");
}

export function parseFuelWorkbook(filePath: string): RawFuelRow[] {
  const workbook = xlsx.readFile(filePath, { cellDates: false });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error(`Workbook has no sheets: ${path.basename(filePath)}`);
  }

  const sheet = workbook.Sheets[firstSheetName];
  const rows = xlsx.utils.sheet_to_json<Array<string | number>>(sheet, {
    header: 1,
    raw: true,
    defval: "",
  });

  const headers = findHeaders(rows);
  const dataRows = rows.slice(headers.rowIndex + 1);
  const parsed: RawFuelRow[] = [];

  for (const row of dataRows) {
    const companyRaw = row[headers.company];
    const regionRaw = row[headers.region];
    const addressRaw = row[headers.address];
    const fuelTypeRaw = row[headers.fuelType];
    const priceRaw = row[headers.price];
    const company = normalizeWhitespace(String(companyRaw ?? ""));
    const region = normalizeWhitespace(String(regionRaw ?? ""));
    const address = normalizeWhitespace(String(addressRaw ?? ""));
    const fuelType = normalizeWhitespace(String(fuelTypeRaw ?? ""));
    if (!company || !region || !address || !fuelType) {
      continue;
    }
    const candidate = {
      company,
      region,
      address,
      fuelType,
      priceRaw: typeof priceRaw === "number" ? priceRaw : String(priceRaw ?? ""),
    };
    parsed.push(rawRowSchema.parse(candidate));
  }

  if (!parsed.length) {
    throw new Error(`No data rows parsed from ${path.basename(filePath)}`);
  }

  return parsed;
}
