'use client';

import { useJsApiLoader, GoogleMap, Marker } from '@react-google-maps/api';

const mapContainerStyle = { width: '100%', height: '300px' };
const libraries: ('places')[] = ['places'];

interface DriverMapInlineProps {
  lat: number;
  lng: number;
}

export default function DriverMapInline({ lat, lng }: DriverMapInlineProps) {
  const { isLoaded } = useJsApiLoader({
    id: 'script-loader',
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY as string,
    libraries,
    language: 'el',
    region: 'GR',
  });

  if (!isLoaded) {
    return (
      <div className="w-full h-[300px] animate-pulse rounded-xl" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
    );
  }

  return (
    <div className="rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border-subtle)' }}>
      <GoogleMap
        mapContainerStyle={mapContainerStyle}
        center={{ lat, lng }}
        zoom={16}
        options={{ disableDefaultUI: true, zoomControl: true }}
      >
        <Marker position={{ lat, lng }} />
      </GoogleMap>
    </div>
  );
}
