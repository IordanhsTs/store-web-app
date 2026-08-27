'use client';

import { MapContainer, TileLayer, Marker, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Δορυφορική εικόνα εδάφους (Esri World Imagery) — δωρεάν, χωρίς API key.
// Το Carto (basemaps.cartocdn.com) σταμάτησε να σερβίρει tiles χωρίς λογαριασμό
// και επέστρεφε εικόνες με το κείμενο "API key required" πάνω στον χάρτη.
const TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

interface Props {
  lat: number;
  lng: number;
  driverName?: string;
  isBusy?: boolean;
}

export default function DriverMapLeaflet({ lat, lng, driverName = 'Διανομέας', isBusy = true }: Props) {
  const color = isBusy ? '#38EF7D' : '#C5A066';
  const glow = isBusy ? 'rgba(56,239,125,0.6)' : 'rgba(197,160,102,0.6)';

  const icon = L.divIcon({
    className: 'vertex-driver-icon',
    html: `<div style="width:38px;height:38px;border-radius:50%;background:#111;border:2px solid ${color};display:flex;align-items:center;justify-content:center;box-shadow:0 0 15px ${glow}">
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/></svg>
    </div>`,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
  });

  return (
    <>
      <style>{`
        .vertex-driver-icon { background: transparent; border: none; }
        .vertex-map-tt {
          background: #111 !important;
          color: #fff !important;
          border: 1px solid ${color} !important;
          border-radius: 8px !important;
          box-shadow: 0 4px 20px rgba(0,0,0,0.8) !important;
          font-size: 12px !important;
          font-weight: 700 !important;
          padding: 5px 9px !important;
        }
        .vertex-map-tt::before { border-top-color: ${color} !important; }
        .leaflet-control-attribution { opacity: 0.5; font-size: 10px !important; }
      `}</style>
      <MapContainer
        center={[lat, lng]}
        zoom={16}
        zoomControl={true}
        scrollWheelZoom={false}
        className="h-[300px] w-full"
        style={{ background: '#f8f5f0' }}
      >
        <TileLayer
          attribution='&copy; Esri, Maxar, Earthstar Geographics, GIS User Community'
          url={TILE_URL}
          maxZoom={19}
        />
        <TileLayer
          url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
          maxZoom={19}
        />
        <Marker position={[lat, lng]} icon={icon}>
          <Tooltip direction="top" offset={[0, -22]} permanent className="vertex-map-tt">
            {driverName} · {isBusy ? 'Σε διανομή' : 'Ελεύθερος'}
          </Tooltip>
        </Marker>
      </MapContainer>
    </>
  );
}
