'use client';

import { useState, useEffect } from 'react';
import { useActiveOrders, type Order } from './useActiveOrders';
// Το εικονίδιο «Map» του lucide μετονομάζεται: αλλιώς σκιάζει τον global Map constructor.
import { Clock, Map as MapIcon, XCircle, User, MessageSquare, Package, Phone, Route, Timer } from 'lucide-react';
import { differenceInMinutes } from 'date-fns';
import { toast } from 'sonner';
import DriverMapInline from './DriverMapInline';
import { supabase } from './lib/supabase';
import { confirmDialog } from './ConfirmDialog';
import { formatKm, formatEuro } from './lib/distance';

/** «3:41» — υπόλοιπο μέχρι την αποστολή μιας προγραμματισμένης παραγγελίας. */
function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function ActiveOrdersList({ storeId }: { storeId: string }) {
  const { orders, loading } = useActiveOrders(storeId);
  const [now, setNow] = useState(new Date());
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);

  const hasScheduled = orders.some((o) => o.status === 'scheduled');

  // Το ρολόι χτυπά ανά δευτερόλεπτο ΜΟΝΟ όσο υπάρχει αντίστροφη μέτρηση να δείξουμε·
  // αλλιώς ανά λεπτό, όσο χρειάζεται για τους χρόνους αναμονής.
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), hasScheduled ? 1000 : 60000);
    return () => clearInterval(interval);
  }, [hasScheduled]);

  const handleCancel = async (orderId: string) => {
    const confirmed = await confirmDialog('Είστε σίγουροι ότι θέλετε να ακυρώσετε την παραγγελία;', { danger: true, confirmLabel: 'Ακύρωση παραγγελίας' });
    if (!confirmed) return;
    const { error } = await supabase.from('orders').update({ status: 'cancelled' }).eq('id', orderId);
    if (!error) {
      toast.success('Η παραγγελία ακυρώθηκε.');
    } else {
      toast.error('Αποτυχία ακύρωσης. Δοκιμάστε ξανά.');
    }
  };

  // ── Αρίθμηση (client feedback 08/08: μια σειρά κοινή για ενεργές+αποδεκτές, ΟΧΙ
  // ξεχωριστή ανά κατάσταση όπως πριν — έτσι όταν η #3 ολοκληρώνεται, η #4 γίνεται #3.)
  // Απλή θέση μέσα στη λίστα, ΟΧΙ μόνιμος κωδικός παραγγελίας.
  const positions = new Map<string, number>();
  orders
    .filter((o) => o.status === 'pending' || o.status === 'accepted')
    .forEach((o, i) => positions.set(o.id, i + 1));
  orders.filter((o) => o.status === 'scheduled').forEach((o, i) => positions.set(o.id, i + 1));

  /* ── Τίτλος ── */
  const header = (
    <div className="mb-6 flex items-center gap-3 min-w-0">
      <h1 className="section-title text-2xl font-bold tracking-tight shrink-0" style={{ color: 'var(--text-primary)' }}>
        Ενεργές Παραγγελίες
      </h1>
    </div>
  );

  /* ── Loading skeleton ── */
  if (loading) {
    return (
      <>
        {header}
        <div className="space-y-4">
        {[1, 2, 3].map(i => (
          <div
            key={i}
            className="p-5 rounded-2xl card-surface"
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
      </>
    );
  }

  /* ── Empty state ── */
  if (orders.length === 0) {
    return (
      <>
        {header}
        <div
          className="flex flex-col items-center justify-center py-20 rounded-2xl text-center transition-all duration-300 hover:-translate-y-1 hover:shadow-xl cursor-default card-surface"
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
      </>
    );
  }

  /* ── Order cards ── */
  return (
    <>
      {header}

      <div className="space-y-4 stagger">
        {orders.map((order: Order) => {
          // activated_at (γεμίζει τη στιγμή scheduled→pending) αντί για created_at: αλλιώς
          // μια παραγγελία με 5' αναμονή θα έδειχνε ήδη 5' ενεργή τη στιγμή που ενεργοποιείται.
          const minutesElapsed = Math.max(0, differenceInMinutes(now, new Date(order.activated_at || order.created_at)));
          const isPending = order.status === 'pending';
          const isScheduled = order.status === 'scheduled';
          const isLate = isPending && minutesElapsed > 9;
          const remainingMs = order.scheduled_at
            ? new Date(order.scheduled_at).getTime() - now.getTime()
            : 0;

          return (
            <div
              key={order.id}
              className="animate-fade-in-up relative overflow-hidden transition-all duration-300 hover:-translate-y-1.5 hover:shadow-lg group card-surface"
              style={{
                backgroundColor: 'var(--bg-card)',
                borderRadius: '20px',
                border: '1px solid var(--border-subtle)',
                boxShadow: 'var(--shadow-md)',
              }}
            >
              {/* Left status stripe */}
              <div
                className="absolute left-0 top-0 bottom-0 w-1.5 opacity-90 transition-opacity group-hover:opacity-100"
                style={{
                  background: isScheduled
                    ? 'var(--text-muted)'
                    : isLate
                    ? 'var(--danger)'
                    : isPending
                    ? 'linear-gradient(180deg, var(--accent), var(--accent-hover))'
                    : 'var(--info)',
                  borderRadius: '0 0 0 0',
                }}
              />

              <div className="p-6 pl-7">
                {/* Top row: address + time badge */}
                <div className="flex justify-between items-start gap-3 mb-2">
                  <div className="flex-1 min-w-0">
                    <h3
                      className="text-base font-bold truncate mb-1 flex items-center gap-2"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {/* Αύξων αριθμός θέσης μέσα στη λίστα της κατάστασής της */}
                      <span
                        className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-lg text-xs font-black tabular-nums"
                        style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}
                      >
                        {positions.get(order.id)}
                      </span>
                      <span className="truncate">{order.address}</span>
                    </h3>

                    <div className="flex items-center flex-wrap gap-1.5">
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

                      {/* Απόσταση (+ επιπλέον χρέωση όταν υπάρχει) */}
                      {order.distance_km !== null && (
                        <span
                          className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg"
                          style={
                            order.surcharge
                              ? { backgroundColor: 'var(--warning-bg)', color: 'var(--warning)', border: '1px solid var(--warning-border)' }
                              : { backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)', border: '1px solid var(--border-subtle)' }
                          }
                        >
                          <Route className="w-3 h-3" />
                          {formatKm(order.distance_km)}
                          {order.surcharge ? ` · +${formatEuro(order.surcharge)}` : ''}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Time badge — αντίστροφη μέτρηση για τις προγραμματισμένες */}
                  <div
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-semibold shrink-0 tabular-nums"
                    style={
                      isScheduled
                        ? { backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)' }
                        : isLate
                        ? { backgroundColor: 'var(--danger-bg)', color: 'var(--danger)', border: '1px solid var(--danger-border)' }
                        : { backgroundColor: 'var(--success-bg)', color: 'var(--success)', border: '1px solid var(--success-border)' }
                    }
                  >
                    {isScheduled ? (
                      <>
                        <Timer className="w-3.5 h-3.5" />
                        {formatCountdown(remainingMs)}
                      </>
                    ) : (
                      <>
                        <Clock className="w-3.5 h-3.5" />
                        {minutesElapsed} λεπτά
                      </>
                    )}
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
                <div className="flex items-center justify-between gap-2">
                  {isScheduled ? (
                    <>
                      <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                        🕒 Θα σταλεί στους διανομείς σε {formatCountdown(remainingMs)}
                      </span>
                      <button
                        onClick={() => handleCancel(order.id)}
                        className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg transition-all duration-150 shrink-0"
                        style={{
                          color: 'var(--danger)',
                          backgroundColor: 'transparent',
                          cursor: 'pointer',
                        }}
                      >
                        <XCircle className="w-4 h-4" />
                        Ακύρωση
                      </button>
                    </>
                  ) : isPending ? (
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
                        style={{
                          color: 'var(--danger)',
                          backgroundColor: 'transparent',
                          cursor: 'pointer',
                        }}
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
                      <div className="flex items-center gap-2 min-w-0">
                        <div
                          className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                          style={{ backgroundColor: 'var(--info-bg)' }}
                        >
                          <User className="w-3.5 h-3.5" style={{ color: 'var(--info)' }} />
                        </div>
                        <div className="min-w-0">
                          <span className="text-sm font-medium block truncate" style={{ color: 'var(--text-primary)' }}>
                            {order.drivers?.full_name || 'Άγνωστος Οδηγός'}
                          </span>
                          {/* Τηλέφωνο του διανομέα που πήρε την παραγγελία */}
                          {order.drivers?.phone && (
                            <a
                              href={`tel:${order.drivers.phone}`}
                              className="text-xs font-semibold inline-flex items-center gap-1 hover:underline"
                              style={{ color: 'var(--accent)' }}
                            >
                              <Phone className="w-3 h-3" />
                              {order.drivers.phone}
                            </a>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          if (order.drivers?.latitude && order.drivers?.longitude) {
                            setExpandedOrderId(prev => prev === order.id ? null : order.id);
                          } else {
                            toast.error('Δεν υπάρχει διαθέσιμη τοποθεσία για αυτόν τον οδηγό.');
                          }
                        }}
                        className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-lg transition-all duration-150 shrink-0"
                        style={{ backgroundColor: 'var(--info-bg)', color: 'var(--info)', border: '1px solid var(--info-border)' }}
                        onMouseEnter={e => {
                          (e.currentTarget as HTMLButtonElement).style.opacity = '0.8';
                        }}
                        onMouseLeave={e => {
                          (e.currentTarget as HTMLButtonElement).style.opacity = '1';
                        }}
                      >
                        <MapIcon className="w-4 h-4" />
                        {expandedOrderId === order.id ? 'Κλείσιμο Χάρτη' : 'Χάρτης'}
                      </button>
                    </>
                  )}
                </div>

                {expandedOrderId === order.id && order.drivers?.latitude && order.drivers?.longitude && (
                  <div className="mt-4 animate-fade-in">
                    <DriverMapInline
                      lat={order.drivers.latitude}
                      lng={order.drivers.longitude}
                      driverName={order.drivers.full_name}
                      isBusy={true}
                    />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
