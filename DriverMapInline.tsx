'use client';

import dynamic from 'next/dynamic';

// Το Leaflet αγγίζει το `window`, οπότε φορτώνεται ΜΟΝΟ στον browser (ssr: false).
const DriverMapLeaflet = dynamic(() => import('./DriverMapLeaflet'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[300px] animate-pulse rounded-xl" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
  ),
});

interface DriverMapInlineProps {
  lat: number;
  lng: number;
  driverName?: string;
  isBusy?: boolean;
}

export default function DriverMapInline(props: DriverMapInlineProps) {
  return (
    <div className="rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border-subtle)' }}>
      <DriverMapLeaflet {...props} />
    </div>
  );
}
