import path from "node:path";
import xlsx from "xlsx";
import { z } from "zod";
import { normalizeWhitespace } from "./normalize";
import type { RawFuelRow } from "./types";

const EXPECTED_HEADERS = [
  "Data",
  "Imone (Degaliniu tinklas)",
  "Degalines vieta (Savivaldybe)",
  "Degalines vieta (Gyvenviete, gatve)",
  "95 benzinas",
  "Dyzelinas",
  "SND",
] as const;

interface HeaderMap {
  rowIndex: number;
  date: number;
  company: number;
  region: number;
  address: number;
  gasoline: number;
  diesel: number;
  lpg: number;
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
    const date = row.indexOf(EXPECTED_HEADERS[0]);
    const company = row.indexOf(EXPECTED_HEADERS[1]);
    const region = row.indexOf(EXPECTED_HEADERS[2]);
    const address = row.indexOf(EXPECTED_HEADERS[3]);
    const gasoline = row.indexOf(EXPECTED_HEADERS[4]);
    const diesel = row.indexOf(EXPECTED_HEADERS[5]);
    const lpg = row.indexOf(EXPECTED_HEADERS[6]);

    if (
      date !== -1 &&
      company !== -1 &&
      region !== -1 &&
      address !== -1 &&
      gasoline !== -1 &&
      diesel !== -1 &&
      lpg !== -1
    ) {
      return {
        rowIndex: i,
        date,
        company,
        region,
        address,
        gasoline,
        diesel,
        lpg,
      };
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
    const company = normalizeWhitespace(String(companyRaw ?? ""));
    const region = normalizeWhitespace(String(regionRaw ?? ""));
    const address = normalizeWhitespace(String(addressRaw ?? ""));
    if (!company || !region || !address) {
      continue;
    }

    const toPrice = (value: unknown): string | number =>
      typeof value === "number" ? value : String(value ?? "");
    const candidates: RawFuelRow[] = [
      {
        company,
        region,
        address,
        fuelType: "gasoline",
        priceRaw: toPrice(row[headers.gasoline]),
      },
      {
        company,
        region,
        address,
        fuelType: "diesel",
        priceRaw: toPrice(row[headers.diesel]),
      },
      {
        company,
        region,
        address,
        fuelType: "lpg",
        priceRaw: toPrice(row[headers.lpg]),
      },
    ];
    parsed.push(...candidates.map((candidate) => rawRowSchema.parse(candidate)));
  }

  if (!parsed.length) {
    throw new Error(`No data rows parsed from ${path.basename(filePath)}`);
  }

  return parsed;
}
