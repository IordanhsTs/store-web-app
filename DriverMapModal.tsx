'use client';

import { useJsApiLoader, GoogleMap, Marker } from '@react-google-maps/api';
import { X, Navigation } from 'lucide-react';

const mapContainerStyle = { width: '100%', height: '400px' };
const libraries: ('places')[] = ['places'];

interface DriverMapModalProps {
  isOpen: boolean;
  onClose: () => void;
  driverName: string;
  lat: number;
  lng: number;
}

export default function DriverMapModal({ isOpen, onClose, driverName, lat, lng }: DriverMapModalProps) {
  const { isLoaded } = useJsApiLoader({
    id: 'script-loader',
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY as string,
    libraries,
    language: 'el',
    region: 'GR',
  });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-md p-4 animate-fade-in">
      <div 
        className="w-full max-w-2xl rounded-2xl shadow-xl overflow-hidden flex flex-col animate-scale-in backdrop-blur-xl backdrop-saturate-150"
        style={{ backgroundColor: 'var(--nav-bg)', border: '1px solid var(--nav-border)' }}
      >
        <div className="flex justify-between items-center p-4 border-b" style={{ borderColor: 'var(--border-default)' }}>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Navigation className="w-5 h-5 text-blue-500" />
            Τοποθεσία: {driverName}
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors">
            <X className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          </button>
        </div>
        <div className="p-4">
          {!isLoaded ? (
            <div className="w-full h-[400px] bg-gray-200 dark:bg-gray-800 animate-pulse rounded-xl"></div>
          ) : (
            <div className="rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700">
              <GoogleMap
                mapContainerStyle={mapContainerStyle}
                center={{ lat, lng }}
                zoom={15}
                options={{ disableDefaultUI: true, zoomControl: true }}
              >
                <Marker position={{ lat, lng }} />
              </GoogleMap>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}