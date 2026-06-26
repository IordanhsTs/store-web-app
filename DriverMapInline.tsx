'use client';

import { useJsApiLoader, GoogleMap, OverlayViewF } from '@react-google-maps/api';
import { Bike } from 'lucide-react';

const mapContainerStyle = { width: '100%', height: '300px' };
const libraries: ('places')[] = ['places'];

interface DriverMapInlineProps {
  lat: number;
  lng: number;
  driverName?: string;
  isBusy?: boolean;
}

export default function DriverMapInline({ lat, lng, driverName = 'Διανομέας', isBusy = true }: DriverMapInlineProps) {
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
        <OverlayViewF
          position={{ lat, lng }}
          mapPaneName="overlayMouseTarget"
          getPixelPositionOffset={(width, height) => ({ x: -(width / 2), y: -(height) })}
        >
          <div className="relative flex flex-col items-center">
            {/* Tooltip */}
            <div className="absolute bottom-full mb-1" style={{
              background: '#111',
              border: `1px solid ${isBusy ? '#38EF7D' : '#C5A066'}`,
              borderRadius: '8px',
              boxShadow: '0 4px 20px rgba(0,0,0,0.8)',
              padding: '6px 10px',
              backdropFilter: 'blur(10px)',
              whiteSpace: 'nowrap',
              transform: 'translateY(-10px)'
            }}>
              <div className="flex items-center gap-1.5 pb-1 mb-1 border-b border-gray-700/50">
                <div className={`w-2 h-2 rounded-full ${isBusy ? 'bg-[#38EF7D] animate-pulse' : 'bg-[#C5A066]'}`}></div>
                <b className="text-[12px] text-white tracking-wide">{driverName}</b>
              </div>
              <div className="mt-0.5">
                <span className={`font-bold text-[10px] uppercase ${isBusy ? 'text-[#38EF7D]' : 'text-[#C5A066]'}`}>
                  {isBusy ? 'Σε διανομή' : 'Ελεύθερος'}
                </span>
              </div>
            </div>

            {/* Circle Marker */}
            <div style={{
              width: '38px', height: '38px', borderRadius: '50%', background: '#111',
              border: `2px solid ${isBusy ? '#38EF7D' : '#C5A066'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: `0 0 15px ${isBusy ? 'rgba(56,239,125,0.6)' : 'rgba(197,160,102,0.6)'}`,
              transition: 'all 0.3s ease'
            }}>
              <Bike size={18} color={isBusy ? '#38EF7D' : '#C5A066'} />
            </div>
          </div>
        </OverlayViewF>
      </GoogleMap>
    </div>
  );
}
