import 'leaflet/dist/leaflet.css'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'

import L from 'leaflet'
import markerIcon2xUrl from 'leaflet/dist/images/marker-icon-2x.png?url'
import markerIconUrl from 'leaflet/dist/images/marker-icon.png?url'
import markerShadowUrl from 'leaflet/dist/images/marker-shadow.png?url'
import { useEffect, useMemo, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MapContainer, TileLayer, useMap } from 'react-leaflet'

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

import type { StationDataset, StationRecord } from "../lib/types";
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

function ClusteredMarkers({
  stations,
  date,
}: {
  stations: StationRecord[];
  date: string;
}) {
  const map = useMap();

  useEffect(() => {
    let mounted = true;
    let clusterLayer: L.MarkerClusterGroup | null = null;

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
        clusterLayer.addLayer(marker);
      }

      map.addLayer(clusterLayer);
      if (valid.length) {
        const bounds = L.latLngBounds(
          valid.map(
            (station) => [station.lat!, station.lon!] as [number, number],
          ),
        );
        map.fitBounds(bounds.pad(0.1));
      }
    };

    run().catch((error) => {
      console.error("Failed to initialize marker clustering", error);
    });

    return () => {
      mounted = false;
      if (clusterLayer) {
        map.removeLayer(clusterLayer);
      }
    };
  }, [date, map, stations]);

  return null;
}

export default function FuelMap({ dataset }: FuelMapProps) {
  const center = useMemo<[number, number]>(() => [55.1694, 23.8813], []);
  const companies = useMemo(
    () =>
      [...new Set(dataset.stations.map((station) => station.company))].sort(),
    [dataset.stations],
  );
  const [selectedCompanies, setSelectedCompanies] =
    useState<string[]>(companies);

  useEffect(() => {
    setSelectedCompanies(companies);
  }, [companies]);

  const selectedCompanySet = useMemo(
    () => new Set(selectedCompanies),
    [selectedCompanies],
  );
  const filteredStations = useMemo(
    () =>
      dataset.stations.filter((station) =>
        selectedCompanySet.has(station.company),
      ),
    [dataset.stations, selectedCompanySet],
  );

  const toggleCompany = (company: string) => {
    setSelectedCompanies((current) =>
      current.includes(company)
        ? current.filter((item) => item !== company)
        : [...current, company],
    );
  };

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="font-semibold">
              Įmonės ({selectedCompanies.length}/{companies.length})
              <DropdownMenuChevron />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="max-h-80 overflow-auto">
            <DropdownMenuLabel>Filtruoti pagal įmonę</DropdownMenuLabel>
            <div className="flex gap-2 px-2 py-1">
              <Button
                className="h-8 px-2 text-xs"
                onClick={() => setSelectedCompanies(companies)}
              >
                Rodyti visas
              </Button>
              <Button
                className="h-8 px-2 text-xs"
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
        <span className="text-sm text-slate-700">
          Rodoma degalinių: <strong>{filteredStations.length}</strong> /{" "}
          {dataset.stations.length}
        </span>
      </div>

      <MapContainer
        center={center}
        zoom={7}
        style={{ height: "78vh", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ClusteredMarkers stations={filteredStations} date={dataset.date} />
      </MapContainer>
    </>
  );
}
