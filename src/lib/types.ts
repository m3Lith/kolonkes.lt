export const FUEL_TYPES = ["gasoline", "diesel", "lpg"] as const;

export type FuelType = (typeof FUEL_TYPES)[number];

export const FUEL_LABELS_LT: Record<FuelType, string> = {
  gasoline: "Benzinas 95",
  diesel: "Dyzelinas",
  lpg: "SND",
};

export const FUEL_SORT_ORDER: Record<FuelType, number> = {
  gasoline: 0,
  diesel: 1,
  lpg: 2,
};

export interface RawFuelRow {
  company: string;
  region: string;
  address: string;
  fuelType: string;
  priceRaw: string | number;
}

export interface NormalizedFuelRow {
  date: string;
  company: string;
  region: string;
  rawAddress: string;
  parsedAddress: string;
  fuelType: FuelType;
  pricePerLiter: number | null;
  stationId: string;
}

export interface GeocodeEntry {
  lat: number;
  lon: number;
  displayName?: string;
  updatedAt: string;
  query: string;
}

export type GeocodeCache = Record<string, GeocodeEntry>;

export interface StationPrice {
  fuelType: FuelType;
  pricePerLiter: number | null;
}

export interface StationCatalogRecord {
  station_id: string;
  company: string;
  region: string;
  raw_address: string;
  parsed_address: string;
  created_at: string;
  updated_at: string;
}

export interface StationGeocodeRecord {
  station_id: string;
  lat: number | null;
  lon: number | null;
  display_name: string | null;
  query: string;
  geocode_updated_at: string | null;
  status: "resolved" | "unresolved";
}

export interface DailyFuelPriceRecord {
  station_id: string;
  date: string;
  gasoline: number | null;
  diesel: number | null;
  lpg: number | null;
}

export interface StationRecord {
  stationId: string;
  company: string;
  region: string;
  address: string;
  rawAddress: string;
  lat: number | null;
  lon: number | null;
  fuelPrices: StationPrice[];
}

export interface StationDataset {
  date: string;
  stations: StationRecord[];
}
