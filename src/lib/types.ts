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
  address: string;
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

export interface StationRecord {
  stationId: string;
  company: string;
  region: string;
  address: string;
  queryAddress: string;
  lat: number | null;
  lon: number | null;
  fuelPrices: StationPrice[];
}

export interface StationDataset {
  date: string;
  generatedAt: string;
  stations: StationRecord[];
}
