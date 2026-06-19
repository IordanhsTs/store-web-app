'use client';

import { useState, useEffect } from 'react';
import { useActiveOrders } from './useActiveOrders';
import { Clock, Map, XCircle, User, MessageSquare, Package, CheckCircle2 } from 'lucide-react';
import { differenceInMinutes } from 'date-fns';
import { createBrowserClient } from '@supabase/ssr';
import DriverMapModal from './DriverMapModal';

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function Toast({ message, type, onClose }: { message: string; type: 'success' | 'error'; onClose: () => void }) {
  return (
    <div
      className="fixed bottom-6 right-6 z-[200] flex items-center gap-3 px-5 py-4 rounded-xl shadow-xl animate-fade-in-up text-sm font-medium"
      style={{
        backgroundColor: type === 'success' ? 'var(--success-bg)' : 'var(--danger-bg)',
        border: `1px solid ${type === 'success' ? 'var(--success-border)' : 'var(--danger-border)'}`,
        color: type === 'success' ? 'var(--success)' : 'var(--danger)',
        backdropFilter: 'blur(8px)',
      }}
    >
      <CheckCircle2 className="w-4 h-4 shrink-0" />
      <span>{message}</span>
      <button onClick={onClose} className="ml-2 opacity-60 hover:opacity-100 transition-opacity text-xs">✕</button>
    </div>
  );
}

export default function ActiveOrdersList({ storeId }: { storeId: string }) {
  const { orders, loading } = useActiveOrders(storeId);
  const [now, setNow] = useState(new Date());
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [mapModal, setMapModal] = useState({
    isOpen: false,
    driverName: '',
    lat: 0,
    lng: 0
  });

  // Ανανέωση του ρολογιού κάθε 60 δευτερόλεπτα
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(interval);
  }, []);

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const handleCancel = async (orderId: string) => {
    if (!confirm('Είστε σίγουροι ότι θέλετε να ακυρώσετε την παραγγελία;')) return;
    const { error } = await supabase.from('orders').update({ status: 'cancelled' }).eq('id', orderId);
    if (!error) {
      showToast('Η παραγγελία ακυρώθηκε.', 'success');
    } else {
      showToast('Αποτυχία ακύρωσης. Δοκιμάστε ξανά.', 'error');
    }
  };

  /* ── Loading skeleton ── */
  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map(i => (
          <div
            key={i}
            className="p-5 rounded-2xl"
            style={{
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border-default)',
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            <div className="flex justify-between items-start mb-4">
              <div className="space-y-2 flex-1">
                <div className="skeleton h-5 w-3/4" />
                <div className="skeleton h-4 w-1/2" />
              </div>
              <div className="skeleton h-8 w-20 ml-4" />
            </div>
            <div className="skeleton h-px w-full my-3" />
            <div className="flex justify-between">
              <div className="skeleton h-4 w-36" />
              <div className="skeleton h-8 w-24" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  /* ── Empty state ── */
  if (orders.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center py-20 rounded-2xl text-center"
        style={{
          backgroundColor: 'var(--bg-card)',
          border: '1px dashed var(--border-default)',
        }}
      >
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
          style={{ backgroundColor: 'var(--accent-muted)' }}
        >
          <Package className="w-8 h-8" style={{ color: 'var(--accent)' }} />
        </div>
        <p className="text-base font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
          Δεν υπάρχουν ενεργές παραγγελίες
        </p>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Δημιουργήστε μια νέα παραγγελία από την αριστερή στήλη
        </p>
      </div>
    );
  }

  /* ── Order cards ── */
  return (
    <>
      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}

      <div className="space-y-4 stagger">
        {orders.map((order) => {
          const minutesElapsed = differenceInMinutes(now, new Date(order.created_at));
          const isLate = order.status === 'pending' && minutesElapsed > 9;
          const isPending = order.status === 'pending';

          return (
            <div
              key={order.id}
              className="animate-fade-in-up relative overflow-hidden transition-all duration-200"
              style={{
                backgroundColor: 'var(--bg-card)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-xl)',
                boxShadow: 'var(--shadow-sm)',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLDivElement).style.boxShadow = 'var(--shadow-md)';
                (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-1px)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLDivElement).style.boxShadow = 'var(--shadow-sm)';
                (e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)';
              }}
            >
              {/* Left status stripe */}
              <div
                className="absolute left-0 top-0 bottom-0 w-1"
                style={{
                  background: isLate
                    ? 'var(--danger)'
                    : isPending
                    ? 'linear-gradient(180deg, var(--accent), var(--accent-hover))'
                    : 'var(--info)',
                  borderRadius: '0 0 0 0',
                }}
              />

              <div className="pl-5 pr-5 pt-4 pb-4">
                {/* Top row: address + time badge */}
                <div className="flex justify-between items-start gap-3 mb-2">
                  <div className="flex-1 min-w-0">
                    <h3
                      className="text-base font-bold truncate mb-1"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {order.address}
                    </h3>

                    {/* Payment badge */}
                    <span
                      className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg"
                      style={
                        order.payment_method === 'cash'
                          ? { backgroundColor: 'var(--success-bg)', color: 'var(--success)', border: '1px solid var(--success-border)' }
                          : { backgroundColor: 'var(--info-bg)', color: 'var(--info)', border: '1px solid var(--info-border)' }
                      }
                    >
                      {order.payment_method === 'cash' ? '💵 Μετρητά' : '💳 Κάρτα'}
                    </span>
                  </div>

                  {/* Time badge */}
                  <div
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-semibold shrink-0"
                    style={
                      isLate
                        ? { backgroundColor: 'var(--danger-bg)', color: 'var(--danger)', border: '1px solid var(--danger-border)' }
                        : { backgroundColor: 'var(--success-bg)', color: 'var(--success)', border: '1px solid var(--success-border)' }
                    }
                  >
                    <Clock className="w-3.5 h-3.5" />
                    {minutesElapsed} λεπτά
                  </div>
                </div>

                {/* Comments */}
                {order.comments && (
                  <p
                    className="text-sm flex items-start gap-1.5 mt-2"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    <MessageSquare className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    {order.comments}
                  </p>
                )}

                {/* Divider */}
                <div className="my-3" style={{ borderTop: '1px solid var(--border-subtle)' }} />

                {/* Bottom row */}
                <div className="flex items-center justify-between">
                  {isPending ? (
                    <>
                      <span
                        className="text-sm font-medium animate-pulse"
                        style={{ color: 'var(--accent)' }}
                      >
                        ⏳ Αναμονή για οδηγό...
                      </span>
                      <button
                        onClick={() => handleCancel(order.id)}
                        className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg transition-all duration-150"
                        style={{ color: 'var(--danger)', backgroundColor: 'transparent' }}
                        onMouseEnter={e => {
                          (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'var(--danger-bg)';
                        }}
                        onMouseLeave={e => {
                          (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent';
                        }}
                      >
                        <XCircle className="w-4 h-4" />
                        Ακύρωση
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        <div
                          className="w-7 h-7 rounded-full flex items-center justify-center"
                          style={{ backgroundColor: 'var(--info-bg)' }}
                        >
                          <User className="w-3.5 h-3.5" style={{ color: 'var(--info)' }} />
                        </div>
                        <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                          {order.drivers?.full_name || 'Άγνωστος Οδηγός'}
                        </span>
                        <span
                          className="text-xs px-2 py-0.5 rounded-md font-medium"
                          style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}
                        >
                          Ενεργές: 1
                        </span>
                      </div>
                      <button
                        onClick={() => {
                          if (order.drivers?.latitude && order.drivers?.longitude) {
                            setMapModal({
                              isOpen: true,
                              driverName: order.drivers.full_name,
                              lat: order.drivers.latitude,
                              lng: order.drivers.longitude
                            });
                          } else {
                            showToast('Δεν υπάρχει διαθέσιμη τοποθεσία για αυτόν τον οδηγό.', 'error');
                          }
                        }}
                        className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-lg transition-all duration-150"
                        style={{ backgroundColor: 'var(--info-bg)', color: 'var(--info)', border: '1px solid var(--info-border)' }}
                        onMouseEnter={e => {
                          (e.currentTarget as HTMLButtonElement).style.opacity = '0.8';
                        }}
                        onMouseLeave={e => {
                          (e.currentTarget as HTMLButtonElement).style.opacity = '1';
                        }}
                      >
                        <Map className="w-4 h-4" />
                        Χάρτης
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <DriverMapModal
        isOpen={mapModal.isOpen}
        onClose={() => setMapModal({ ...mapModal, isOpen: false })}
        driverName={mapModal.driverName}
        lat={mapModal.lat}
        lng={mapModal.lng}
      />
    </>
  );
}