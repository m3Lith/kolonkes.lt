import {
  FUEL_SORT_ORDER,
  type DailyFuelPriceRecord,
  type FuelType,
  type StationCatalogRecord,
  type StationDataset,
  type StationGeocodeRecord,
  type StationPrice,
  type StationRecord,
} from "./types";

function toFuelPrices(row: DailyFuelPriceRecord): StationPrice[] {
  const prices: StationPrice[] = [
    { fuelType: "gasoline", pricePerLiter: row.gasoline },
    { fuelType: "diesel", pricePerLiter: row.diesel },
    { fuelType: "lpg", pricePerLiter: row.lpg },
  ];
  prices.sort(
    (a, b) =>
      FUEL_SORT_ORDER[a.fuelType as FuelType] -
      FUEL_SORT_ORDER[b.fuelType as FuelType],
  );
  return prices;
}

export function composeStationDataset(
  date: string,
  catalog: StationCatalogRecord[],
  geocodes: StationGeocodeRecord[],
  dailyPrices: DailyFuelPriceRecord[],
): StationDataset {
  const catalogById = new Map(
    catalog.map((station) => [station.station_id, station] as const),
  );
  const geocodeById = new Map(
    geocodes.map((geocode) => [geocode.station_id, geocode] as const),
  );

  const stations: StationRecord[] = dailyPrices
    .map((daily) => {
      const station = catalogById.get(daily.station_id);
      if (!station) {
        return null;
      }
      const geocode = geocodeById.get(daily.station_id);
      return {
        stationId: daily.station_id,
        company: station.company,
        region: station.region,
        address: station.parsed_address,
        rawAddress: station.raw_address,
        lat: geocode?.lat ?? null,
        lon: geocode?.lon ?? null,
        fuelPrices: toFuelPrices(daily),
      };
    })
    .filter((station): station is StationRecord => station !== null)
    .sort(
      (a, b) =>
        a.company.localeCompare(b.company) ||
        a.region.localeCompare(b.region) ||
        a.address.localeCompare(b.address),
    );

  return { date, stations };
}
