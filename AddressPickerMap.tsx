'use client';

import { MapContainer, TileLayer, Marker, Tooltip, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Δορυφορική εικόνα εδάφους (Esri World Imagery) — δωρεάν, χωρίς API key.
// Το Carto (basemaps.cartocdn.com) σταμάτησε να σερβίρει tiles χωρίς λογαριασμό
// και επέστρεφε εικόνες με το κείμενο "API key required" πάνω στον χάρτη.
const TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const LABELS_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';

type LatLng = { lat: number; lon: number };

interface Props {
  /** Κέντρο χάρτη όταν δεν έχει τοποθετηθεί ακόμα πινέζα. */
  center: LatLng;
  /** Το κατάστημα — σημείο αναφοράς, ώστε να βλέπει ο χρήστης από πού μετράει. */
  origin: LatLng | null;
  /** Η τρέχουσα πινέζα προορισμού. */
  pin: LatLng | null;
  onPick: (p: LatLng) => void;
}

// Κλικ οπουδήποτε στον χάρτη = μετακίνηση της πινέζας εκεί.
function ClickHandler({ onPick }: { onPick: (p: LatLng) => void }) {
  useMapEvents({
    click(e) {
      onPick({ lat: e.latlng.lat, lon: e.latlng.lng });
    },
  });
  return null;
}

export default function AddressPickerMap({ center, origin, pin, onPick }: Props) {
  const pinIcon = L.divIcon({
    className: 'vertex-pick-icon',
    html: `<div style="width:34px;height:34px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#C5A066;border:2px solid #fff;box-shadow:0 3px 10px rgba(0,0,0,0.5)"></div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 34],
  });

  const storeIcon = L.divIcon({
    className: 'vertex-pick-icon',
    html: `<div style="width:26px;height:26px;border-radius:50%;background:#111;border:2px solid #38EF7D;display:flex;align-items:center;justify-content:center;box-shadow:0 0 10px rgba(56,239,125,0.5)">
      <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#38EF7D" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l1-5h16l1 5"/><path d="M4 9v11h16V9"/><path d="M9 20v-6h6v6"/></svg>
    </div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });

  return (
    <>
      <style>{`
        .vertex-pick-icon { background: transparent; border: none; }
        .vertex-pick-tt {
          background: #111 !important; color: #fff !important;
          border: 1px solid #38EF7D !important; border-radius: 6px !important;
          font-size: 11px !important; font-weight: 700 !important; padding: 3px 7px !important;
        }
        .vertex-pick-tt::before { border-top-color: #38EF7D !important; }
        .leaflet-control-attribution { opacity: 0.5; font-size: 10px !important; }
      `}</style>

      <MapContainer
        center={[pin?.lat ?? center.lat, pin?.lon ?? center.lon]}
        zoom={15}
        scrollWheelZoom
        className="h-full w-full"
        style={{ background: '#f8f5f0' }}
      >
        <TileLayer
          attribution='&copy; Esri, Maxar, Earthstar Geographics, GIS User Community'
          url={TILE_URL}
          maxZoom={19}
        />
        <TileLayer url={LABELS_URL} maxZoom={19} />
        <ClickHandler onPick={onPick} />

        {/* Το κατάστημα: σημείο αναφοράς για την απόσταση */}
        {origin && (
          <Marker position={[origin.lat, origin.lon]} icon={storeIcon}>
            <Tooltip direction="top" offset={[0, -14]} className="vertex-pick-tt">
              Το κατάστημά σας
            </Tooltip>
          </Marker>
        )}

        {/* Η πινέζα προορισμού — σέρνεται ή μετακινείται με κλικ στον χάρτη */}
        {pin && (
          <Marker
            position={[pin.lat, pin.lon]}
            icon={pinIcon}
            draggable
            eventHandlers={{
              dragend: (e) => {
                const p = (e.target as L.Marker).getLatLng();
                onPick({ lat: p.lat, lon: p.lng });
              },
            }}
          />
        )}
      </MapContainer>
    </>
  );
}
