import 'leaflet/dist/leaflet.css'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'

import L from 'leaflet'
import markerIcon2xUrl from 'leaflet/dist/images/marker-icon-2x.png?url'
import markerIconUrl from 'leaflet/dist/images/marker-icon.png?url'
import markerShadowUrl from 'leaflet/dist/images/marker-shadow.png?url'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MapContainer, TileLayer, useMap } from 'react-leaflet'

import { CornersIcon, Crosshair2Icon, TableIcon, UpdateIcon } from '@radix-ui/react-icons'

import { StationPopup } from './StationPopup'
import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuChevron,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'

import type { FuelType, StationDataset, StationRecord } from "../lib/types";
// Prevent Leaflet Icon.Default from prepending its own imagePath.
delete (L.Icon.Default.prototype as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2xUrl,
  iconUrl: markerIconUrl,
  shadowUrl: markerShadowUrl,
});

interface FuelMapProps {
  dataset: StationDataset;
}

type SortKey = "company" | "address" | FuelType;
type SortDir = "asc" | "desc";

function getFuelPrice(
  station: StationRecord,
  fuelType: FuelType,
): number | null {
  const fuel = station.fuelPrices.find((item) => item.fuelType === fuelType);
  return fuel?.pricePerLiter ?? null;
}

function formatPrice(value: number | null): string {
  return value === null ? "-" : value.toFixed(3);
}

function compareNullableNumber(
  a: number | null,
  b: number | null,
  direction: SortDir,
): number {
  if (a === null && b === null) {
    return 0;
  }
  if (a === null) {
    return 1;
  }
  if (b === null) {
    return -1;
  }
  return direction === "asc" ? a - b : b - a;
}

function ClusteredMarkers({
  stations,
  date,
  onMarkersReady,
}: {
  stations: StationRecord[];
  date: string;
  onMarkersReady: (
    markerIndex: Map<string, L.Marker>,
    clusterLayer: L.MarkerClusterGroup | null,
  ) => void;
}) {
  const map = useMap();
  const hasInitialFitDoneRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    let clusterLayer: L.MarkerClusterGroup | null = null;
    const markerIndex = new Map<string, L.Marker>();

    const run = async () => {
      await import("leaflet.markercluster");
      if (!mounted) {
        return;
      }

      clusterLayer = L.markerClusterGroup({
        // Smaller radius keeps nearby markers separate for longer.
        maxClusterRadius: 30,
        // Stop clustering earlier as user zooms in.
        disableClusteringAtZoom: 13,
      });

      const valid = stations.filter(
        (station) => station.lat !== null && station.lon !== null,
      );

      for (const station of valid) {
        const marker = L.marker([station.lat!, station.lon!]);
        marker.bindPopup(
          renderToStaticMarkup(<StationPopup station={station} date={date} />),
        );
        markerIndex.set(station.stationId, marker);
        clusterLayer.addLayer(marker);
      }

      map.addLayer(clusterLayer);
      onMarkersReady(markerIndex, clusterLayer);
      if (valid.length) {
        // Fit only once on initial load; keep user zoom/center on later filter updates.
        if (!hasInitialFitDoneRef.current) {
          const bounds = L.latLngBounds(
            valid.map(
              (station) => [station.lat!, station.lon!] as [number, number],
            ),
          );
          map.fitBounds(bounds.pad(0.1));
          hasInitialFitDoneRef.current = true;
        }
      }
    };

    run().catch((error) => {
      console.error("Failed to initialize marker clustering", error);
    });

    return () => {
      mounted = false;
      onMarkersReady(new Map(), null);
      if (clusterLayer) {
        map.removeLayer(clusterLayer);
      }
    };
  }, [date, map, onMarkersReady, stations]);

  return null;
}

function MapViewportTracker({
  onMapReady,
  onBoundsChange,
}: {
  onMapReady: (map: L.Map | null) => void;
  onBoundsChange: (bounds: L.LatLngBounds) => void;
}) {
  const map = useMap();

  useEffect(() => {
    onMapReady(map);
    const update = () => onBoundsChange(map.getBounds());
    update();
    map.on("moveend zoomend", update);
    return () => {
      map.off("moveend zoomend", update);
      onMapReady(null);
    };
  }, [map, onBoundsChange, onMapReady]);

  return null;
}

function MapResizeHandler({ trigger }: { trigger: string }) {
  const map = useMap();

  useEffect(() => {
    // Let layout settle, then force Leaflet to recalculate tile viewport.
    const id = window.setTimeout(() => {
      map.invalidateSize({ animate: false });
    }, 0);
    return () => window.clearTimeout(id);
  }, [map, trigger]);

  return null;
}

function MapGeolocateOnLoad({
  onResolved,
}: {
  onResolved: (location: [number, number]) => void;
}) {
  const map = useMap();

  useEffect(() => {
    if (!("geolocation" in navigator)) {
      return;
    }

    let locationMarker: L.CircleMarker | null = null;

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        onResolved([latitude, longitude]);
        map.setView([latitude, longitude], 13, { animate: false });

        locationMarker = L.circleMarker([latitude, longitude], {
          radius: 8,
          color: "#dc2626",
          weight: 2,
          fillColor: "#ef4444",
          fillOpacity: 0.9,
        })
          .addTo(map)
          .bindPopup("Jūsų vieta");
      },
      () => {
        // User denied location or browser failed to resolve it; keep default map behavior.
      },
      {
        enableHighAccuracy: false,
        timeout: 8000,
        maximumAge: 120000,
      },
    );

    return () => {
      if (locationMarker) {
        map.removeLayer(locationMarker);
      }
    };
  }, [map, onResolved]);

  return null;
}

export default function FuelMap({ dataset }: FuelMapProps) {
  const center = useMemo<[number, number]>(() => [55.1694, 23.8813], []);
  const geocodedStations = useMemo(
    () =>
      dataset.stations.filter(
        (station) => station.lat !== null && station.lon !== null,
      ),
    [dataset.stations],
  );
  const [showTable, setShowTable] = useState(() => {
    if (typeof window === "undefined") {
      return true;
    }
    return !window.matchMedia("(max-width: 1023px)").matches;
  });
  const [syncTableWithMap, setSyncTableWithMap] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("gasoline");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [userLocation, setUserLocation] = useState<[number, number] | null>(
    null,
  );
  const [mapBounds, setMapBounds] = useState<L.LatLngBounds | null>(null);
  const [mapInstance, setMapInstance] = useState<L.Map | null>(null);
  const markerIndexRef = useRef<Map<string, L.Marker>>(new Map());
  const clusterLayerRef = useRef<L.MarkerClusterGroup | null>(null);

  const companies = useMemo(
    () =>
      [...new Set(geocodedStations.map((station) => station.company))].sort(),
    [geocodedStations],
  );
  const regions = useMemo(
    () =>
      [...new Set(geocodedStations.map((station) => station.region))].sort(),
    [geocodedStations],
  );
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([]);
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);

  useEffect(() => {
    setSelectedCompanies([]);
  }, [companies]);
  useEffect(() => {
    setSelectedRegion(null);
  }, [regions]);

  const selectedCompanySet = useMemo(
    () => new Set(selectedCompanies),
    [selectedCompanies],
  );
  const isAllCompaniesSelected = selectedCompanies.length === 0;
  const filteredStations = useMemo(
    () =>
      geocodedStations.filter(
        (station) =>
          (isAllCompaniesSelected || selectedCompanySet.has(station.company)) &&
          (selectedRegion === null || station.region === selectedRegion),
      ),
    [
      geocodedStations,
      isAllCompaniesSelected,
      selectedCompanySet,
      selectedRegion,
    ],
  );

  const viewportStations = useMemo(
    () =>
      filteredStations.filter(
        (station) =>
          station.lat !== null &&
          station.lon !== null &&
          mapBounds?.contains([station.lat, station.lon]),
      ),
    [filteredStations, mapBounds],
  );

  const tableSourceStations = useMemo(
    () => (syncTableWithMap ? viewportStations : filteredStations),
    [filteredStations, syncTableWithMap, viewportStations],
  );

  const sortedTableStations = useMemo(() => {
    return [...tableSourceStations].sort((a, b) => {
      if (sortKey === "company" || sortKey === "address") {
        const av = a[sortKey];
        const bv = b[sortKey];
        const compared = av.localeCompare(bv);
        return sortDir === "asc" ? compared : -compared;
      }
      return compareNullableNumber(
        getFuelPrice(a, sortKey),
        getFuelPrice(b, sortKey),
        sortDir,
      );
    });
  }, [sortDir, sortKey, tableSourceStations]);

  const toggleCompany = (company: string) => {
    setSelectedCompanies((current) => {
      const next = current.includes(company)
        ? current.filter((item) => item !== company)
        : [...current, company];
      if (next.length === companies.length) {
        return [];
      }
      return next;
    });
  };

  const toggleSort = (nextKey: SortKey) => {
    if (sortKey === nextKey) {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextKey);
    setSortDir("asc");
  };

  const sortIndicator = (key: SortKey) =>
    sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  const onMarkersReady = useCallback(
    (
      markerIndex: Map<string, L.Marker>,
      clusterLayer: L.MarkerClusterGroup | null,
    ) => {
      markerIndexRef.current = markerIndex;
      clusterLayerRef.current = clusterLayer;
    },
    [],
  );

  const focusStation = (station: StationRecord) => {
    if (!mapInstance) {
      return;
    }
    const marker = markerIndexRef.current.get(station.stationId);
    if (!marker) {
      return;
    }
    const cluster = clusterLayerRef.current;
    if (cluster) {
      cluster.zoomToShowLayer(marker, () => {
        mapInstance.panTo(marker.getLatLng());
        marker.openPopup();
      });
      return;
    }
    mapInstance.setView(
      marker.getLatLng(),
      Math.max(mapInstance.getZoom(), 15),
    );
    marker.openPopup();
  };

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Button
          className={`h-8 w-8 p-0 ${showTable ? "bg-slate-200 text-slate-700 hover:bg-slate-300" : "bg-white text-slate-500 hover:bg-slate-100"}`}
          title={showTable ? "Slėpti lentelę" : "Rodyti lentelę"}
          aria-label={showTable ? "Slėpti lentelę" : "Rodyti lentelę"}
          aria-pressed={showTable}
          onClick={() => setShowTable((v) => !v)}
        >
          <TableIcon className="h-4 w-4" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="font-semibold">
              Tinklai (
              {isAllCompaniesSelected
                ? companies.length
                : selectedCompanies.length}
              /{companies.length})
              <DropdownMenuChevron />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="max-h-80 overflow-auto">
            <div className="flex items-center justify-between px-2 py-1.5">
              <DropdownMenuLabel className="p-0">
                Filtruoti pagal tinklą
              </DropdownMenuLabel>
              <Button
                className="h-7 px-2 text-xs"
                onClick={() => setSelectedCompanies([])}
              >
                Išvalyti
              </Button>
            </div>
            <DropdownMenuSeparator />
            {companies.map((company) => (
              <DropdownMenuCheckboxItem
                key={company}
                checked={selectedCompanySet.has(company)}
                onCheckedChange={() => toggleCompany(company)}
              >
                {company}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="font-semibold">
              Regionai ({selectedRegion === null ? regions.length : 1}/
              {regions.length})
              <DropdownMenuChevron />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="max-h-80 overflow-auto">
            <div className="flex items-center justify-between px-2 py-1.5">
              <DropdownMenuLabel className="p-0">
                Filtruoti pagal regioną
              </DropdownMenuLabel>
              <Button
                className="h-7 px-2 text-xs"
                onClick={() => setSelectedRegion(null)}
              >
                Išvalyti
              </Button>
            </div>
            <DropdownMenuSeparator />
            {regions.map((region) => (
              <DropdownMenuCheckboxItem
                key={region}
                checked={selectedRegion === region}
                onCheckedChange={() => setSelectedRegion(region)}
              >
                {region}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          className="h-8 px-2 text-xs"
          title="Centruoti žemėlapį"
          aria-label="Centruoti žemėlapį"
          onClick={() => {
            if (!mapInstance) {
              return;
            }
            const points = filteredStations
              .filter((station) => station.lat !== null && station.lon !== null)
              .map(
                (station) => [station.lat!, station.lon!] as [number, number],
              );
            if (!points.length) {
              return;
            }
            mapInstance.fitBounds(L.latLngBounds(points).pad(0.1));
          }}
        >
          <CornersIcon className="h-4 w-4" />
        </Button>
        {userLocation && (
          <Button
            className="h-8 px-2 text-xs"
            title="Grįžti į mano vietą"
            aria-label="Grįžti į mano vietą"
            onClick={() => {
              if (!mapInstance) {
                return;
              }
              mapInstance.setView(userLocation, 13, { animate: false });
            }}
          >
            <Crosshair2Icon className="h-4 w-4" />
          </Button>
        )}
        <span className="text-sm text-slate-700">
          Rodoma degalinių: <strong>{filteredStations.length}</strong> /{" "}
          {geocodedStations.length}
        </span>
      </div>

      <div className="flex flex-col gap-3 lg:h-[78vh] lg:flex-row">
        {showTable && (
          <div className="w-full rounded-md border border-slate-200 bg-white lg:h-full lg:w-[45%] lg:min-w-[380px]">
            <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2 text-sm text-slate-700">
              <span>
                Lentelėje rodoma: <strong>{sortedTableStations.length}</strong>{" "}
                {syncTableWithMap
                  ? "(sinchronizuota su žemėlapiu)"
                  : "(visos degalinės)"}
              </span>
              <Button
                className={`h-7 w-7 p-0 ${syncTableWithMap ? "bg-slate-200 text-slate-700 hover:bg-slate-300" : "bg-white text-slate-500 hover:bg-slate-100"}`}
                title={`Sinchronizacija su žemėlapiu: ${syncTableWithMap ? "įjungta" : "išjungta"}`}
                aria-label={`Sinchronizacija su žemėlapiu: ${syncTableWithMap ? "įjungta" : "išjungta"}`}
                aria-pressed={syncTableWithMap}
                onClick={() => setSyncTableWithMap((v) => !v)}
              >
                <UpdateIcon
                  className={`h-4 w-4 ${syncTableWithMap ? "" : "opacity-60"}`}
                />
              </Button>
            </div>
            <div className="h-[40vh] overflow-auto lg:h-[calc(78vh-41px)]">
              <table className="min-w-full border-collapse text-sm">
                <thead className="sticky top-0 z-10 bg-slate-50">
                  <tr className="border-b border-slate-200 text-left">
                    <th className="px-3 py-2">
                      <button
                        onClick={() => toggleSort("company")}
                        type="button"
                      >
                        Tinklas{sortIndicator("company")}
                      </button>
                    </th>
                    <th className="px-3 py-2">
                      <button
                        onClick={() => toggleSort("address")}
                        type="button"
                      >
                        Adresas{sortIndicator("address")}
                      </button>
                    </th>
                    <th className="px-3 py-2 text-right">
                      <button
                        onClick={() => toggleSort("gasoline")}
                        type="button"
                      >
                        Benzinas{sortIndicator("gasoline")}
                      </button>
                    </th>
                    <th className="px-3 py-2 text-right">
                      <button
                        onClick={() => toggleSort("diesel")}
                        type="button"
                      >
                        Dyzelinas{sortIndicator("diesel")}
                      </button>
                    </th>
                    <th className="px-3 py-2 text-right">
                      <button onClick={() => toggleSort("lpg")} type="button">
                        SND{sortIndicator("lpg")}
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedTableStations.map((station) => (
                    <tr
                      key={station.stationId}
                      className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
                      onClick={() => focusStation(station)}
                    >
                      <td className="px-3 py-2">{station.company}</td>
                      <td className="px-3 py-2">{station.address}</td>
                      <td className="px-3 py-2 text-right">
                        {formatPrice(getFuelPrice(station, "gasoline"))}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {formatPrice(getFuelPrice(station, "diesel"))}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {formatPrice(getFuelPrice(station, "lpg"))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <div
          className={
            showTable
              ? "h-[52vh] w-full lg:h-full lg:flex-1"
              : "h-[78vh] w-full"
          }
        >
          <MapContainer
            center={center}
            zoom={7}
            style={{ height: "100%", width: "100%" }}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <MapGeolocateOnLoad onResolved={setUserLocation} />
            <MapResizeHandler trigger={showTable ? "table-on" : "table-off"} />
            <MapViewportTracker
              onMapReady={setMapInstance}
              onBoundsChange={setMapBounds}
            />
            <ClusteredMarkers
              stations={filteredStations}
              date={dataset.date}
              onMarkersReady={onMarkersReady}
            />
          </MapContainer>
        </div>
      </div>
    </>
  );
}
