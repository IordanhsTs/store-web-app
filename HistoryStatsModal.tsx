'use client';

import { useState, useEffect } from 'react';
import { X, TrendingUp, Clock, Car, BarChart2, Award } from 'lucide-react';
import { createBrowserClient } from '@supabase/ssr';
import { subDays, differenceInMinutes, startOfDay, endOfDay } from 'date-fns';

interface HistoryStatsModalProps {
  isOpen: boolean;
  onClose: () => void;
  storeId: string;
}

type CompletedOrder = {
  id: string;
  driver_id: string;
  created_at: string;
  accepted_at: string;
  completed_at: string;
  drivers: { full_name: string } | null;
};

const DATE_FILTERS = [
  { label: 'Σήμερα', val: 0 },
  { label: '3 Ημέρες', val: 3 },
  { label: '7 Ημέρες', val: 7 },
];

export default function HistoryStatsModal({ isOpen, onClose, storeId }: HistoryStatsModalProps) {
  const [orders, setOrders] = useState<CompletedOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [dateRange, setDateRange] = useState(0);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  useEffect(() => {
    if (!isOpen) return;

    const fetchHistory = async () => {
      setLoading(true);

      const startDate = startOfDay(subDays(new Date(), dateRange)).toISOString();
      const endDate = endOfDay(new Date()).toISOString();

      const { data, error } = await supabase
        .from('orders')
        .select(`id, driver_id, created_at, accepted_at, completed_at, drivers(full_name)`)
        .eq('store_id', storeId)
        .eq('status', 'completed')
        .gte('completed_at', startDate)
        .lte('completed_at', endDate);

      if (data && !error) {
        setOrders(data as unknown as CompletedOrder[]);
      }
      setLoading(false);
    };

    fetchHistory();
  }, [isOpen, dateRange, storeId, supabase]);

  if (!isOpen) return null;

  // Στατιστικοί Υπολογισμοί
  const totalOrders = orders.length;

  const totalDeliveryTime = orders.reduce((acc, order) => {
    if (order.completed_at && order.accepted_at) {
      return acc + differenceInMinutes(new Date(order.completed_at), new Date(order.accepted_at));
    }
    return acc;
  }, 0);

  const avgDeliveryTime = totalOrders > 0 ? Math.round(totalDeliveryTime / totalOrders) : 0;

  const ordersPerDriver: Record<string, number> = {};
  orders.forEach(order => {
    const driverName = order.drivers?.full_name || 'Άγνωστος / Διαγράφηκε';
    ordersPerDriver[driverName] = (ordersPerDriver[driverName] || 0) + 1;
  });

  const topDriver = Object.entries(ordersPerDriver).sort((a, b) => b[1] - a[1])[0];

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-fade-in"
      style={{ backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-3xl flex flex-col animate-scale-in"
        style={{
          backgroundColor: 'var(--bg-modal)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-2xl)',
          boxShadow: 'var(--shadow-xl)',
          maxHeight: '90vh',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          className="flex justify-between items-center px-6 py-5"
          style={{ borderBottom: '1px solid var(--border-default)' }}
        >
          <h2 className="text-xl font-bold flex items-center gap-2.5" style={{ color: 'var(--text-primary)' }}>
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: 'var(--accent-muted)' }}
            >
              <TrendingUp className="w-4 h-4" style={{ color: 'var(--accent)' }} />
            </div>
            Ιστορικό &amp; Στατιστικά
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg transition-all duration-150"
            style={{ color: 'var(--text-muted)' }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'var(--bg-tertiary)';
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent';
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)';
            }}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-6">

          {/* Date filter pills */}
          <div className="flex gap-2 mb-6">
            {DATE_FILTERS.map(filter => (
              <button
                key={filter.val}
                onClick={() => setDateRange(filter.val)}
                className="px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-150"
                style={
                  dateRange === filter.val
                    ? {
                        background: 'linear-gradient(135deg, var(--accent), var(--accent-hover))',
                        color: '#fff',
                        boxShadow: '0 2px 8px var(--accent-muted)',
                      }
                    : {
                        backgroundColor: 'var(--bg-tertiary)',
                        color: 'var(--text-secondary)',
                        border: '1px solid var(--border-default)',
                      }
                }
              >
                {filter.label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[1, 2, 3].map(i => <div key={i} className="skeleton h-28 w-full" />)}
              </div>
              <div className="skeleton h-48 w-full" />
            </div>
          ) : (
            <>
              {/* Stats cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                {/* Total Orders */}
                <div
                  className="p-5 rounded-2xl flex items-center gap-4"
                  style={{
                    backgroundColor: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-default)',
                  }}
                >
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
                    style={{ backgroundColor: 'var(--info-bg)', border: '1px solid var(--info-border)' }}
                  >
                    <Car className="w-5 h-5" style={{ color: 'var(--info)' }} />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
                      Παραγγελίες
                    </p>
                    <p className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>
                      {totalOrders}
                    </p>
                  </div>
                </div>

                {/* Avg delivery */}
                <div
                  className="p-5 rounded-2xl flex items-center gap-4"
                  style={{
                    backgroundColor: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-default)',
                  }}
                >
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
                    style={{ backgroundColor: 'var(--success-bg)', border: '1px solid var(--success-border)' }}
                  >
                    <Clock className="w-5 h-5" style={{ color: 'var(--success)' }} />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
                      Μέσος Χρόνος
                    </p>
                    <p className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>
                      {avgDeliveryTime}
                      <span className="text-base font-normal ml-1" style={{ color: 'var(--text-muted)' }}>λεπτά</span>
                    </p>
                  </div>
                </div>

                {/* Top driver */}
                <div
                  className="p-5 rounded-2xl flex items-center gap-4"
                  style={{
                    backgroundColor: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-default)',
                  }}
                >
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
                    style={{ backgroundColor: 'var(--accent-muted)', border: '1px solid var(--accent-light)' }}
                  >
                    <Award className="w-5 h-5" style={{ color: 'var(--accent)' }} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
                      Καλύτερος Οδηγός
                    </p>
                    <p className="text-base font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                      {topDriver ? topDriver[0] : '—'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Driver table */}
              <div>
                <h3
                  className="text-base font-bold mb-4 flex items-center gap-2"
                  style={{ color: 'var(--text-primary)' }}
                >
                  <BarChart2 className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                  Παραγγελίες ανά Οδηγό
                </h3>

                {Object.keys(ordersPerDriver).length > 0 ? (
                  <div
                    className="rounded-2xl overflow-hidden"
                    style={{ border: '1px solid var(--border-default)' }}
                  >
                    <table className="w-full text-left">
                      <thead>
                        <tr style={{ backgroundColor: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-default)' }}>
                          <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                            Οδηγός
                          </th>
                          <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                            Παραγγελίες
                          </th>
                          <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                            Ποσοστό
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(ordersPerDriver)
                          .sort((a, b) => b[1] - a[1])
                          .map(([driver, count], idx) => {
                            const pct = totalOrders > 0 ? Math.round((count / totalOrders) * 100) : 0;
                            return (
                              <tr
                                key={driver}
                                style={{
                                  borderTop: idx > 0 ? '1px solid var(--border-subtle)' : 'none',
                                  backgroundColor: 'var(--bg-card)',
                                }}
                              >
                                <td className="px-5 py-3.5 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                  {idx === 0 && <span className="mr-1.5">🥇</span>}
                                  {idx === 1 && <span className="mr-1.5">🥈</span>}
                                  {idx === 2 && <span className="mr-1.5">🥉</span>}
                                  {driver}
                                </td>
                                <td className="px-5 py-3.5 text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                                  {count}
                                </td>
                                <td className="px-5 py-3.5">
                                  <div className="flex items-center gap-2">
                                    <div
                                      className="flex-1 h-1.5 rounded-full overflow-hidden"
                                      style={{ backgroundColor: 'var(--border-default)' }}
                                    >
                                      <div
                                        className="h-full rounded-full transition-all duration-500"
                                        style={{
                                          width: `${pct}%`,
                                          background: 'linear-gradient(90deg, var(--accent-hover), var(--accent))',
                                        }}
                                      />
                                    </div>
                                    <span className="text-xs font-semibold w-8 text-right" style={{ color: 'var(--text-muted)' }}>
                                      {pct}%
                                    </span>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div
                    className="py-12 text-center rounded-2xl"
                    style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px dashed var(--border-default)' }}
                  >
                    <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                      Δεν υπάρχουν δεδομένα για αυτήν την περίοδο.
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}