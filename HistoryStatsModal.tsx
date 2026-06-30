'use client';

import { useState, useEffect } from 'react';
import { X, TrendingUp, Clock, Car, BarChart2, Award, List, MapPin, CreditCard, Banknote, ChevronRight } from 'lucide-react';
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
  address: string;
  payment_method: 'cash' | 'card';
  drivers: { full_name: string } | null;
};

const DATE_FILTERS = [
  { label: 'Σήμερα', val: 0 },
  { label: '3 Ημέρες', val: 3 },
  { label: '7 Ημέρες', val: 7 },
  { label: 'Επιλογή', val: -1 },
];

export default function HistoryStatsModal({ isOpen, onClose, storeId }: HistoryStatsModalProps) {
  const [orders, setOrders] = useState<CompletedOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [dateRange, setDateRange] = useState(0);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [showOrderList, setShowOrderList] = useState(false);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  useEffect(() => {
    if (!isOpen) return;

    const fetchHistory = async () => {
      setLoading(true);

      let startDate, endDate;
      if (dateRange === -1) {
        if (!customStart || !customEnd) {
          setOrders([]);
          setLoading(false);
          return;
        }
        startDate = new Date(customStart).toISOString();
        endDate = new Date(customEnd).toISOString();
      } else {
        startDate = startOfDay(subDays(new Date(), dateRange)).toISOString();
        endDate = endOfDay(new Date()).toISOString();
      }

      const { data, error } = await supabase
        .from('orders')
        .select(`id, driver_id, created_at, accepted_at, completed_at, address, payment_method, drivers(full_name)`)
        .eq('store_id', storeId)
        .eq('status', 'completed')
        .gte('completed_at', startDate)
        .lte('completed_at', endDate)
        .order('created_at', { ascending: false });

      if (data && !error) {
        setOrders(data as unknown as CompletedOrder[]);
      }
      setLoading(false);
    };

    fetchHistory();
  }, [isOpen, dateRange, customStart, customEnd, storeId, supabase]);

  // Reset side panel when modal closes
  useEffect(() => {
    if (!isOpen) setShowOrderList(false);
  }, [isOpen]);

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

  const formatOrderDate = (iso: string) =>
    new Date(iso).toLocaleString('el-GR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  const getDeliveryMinutes = (order: CompletedOrder) => {
    if (!order.accepted_at || !order.completed_at) return null;
    return differenceInMinutes(new Date(order.completed_at), new Date(order.accepted_at));
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-fade-in"
      style={{ backgroundColor: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="flex animate-scale-in backdrop-blur-xl backdrop-saturate-150"
        style={{
          width: showOrderList ? 'min(95vw, 1300px)' : 'min(95vw, 768px)',
          transition: 'width 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
          maxHeight: '90vh',
          backgroundColor: 'var(--nav-bg)',
          border: '1px solid var(--nav-border)',
          borderRadius: 'var(--radius-2xl)',
          boxShadow: 'var(--shadow-xl)',
          overflow: 'hidden',
          flexShrink: 0,
        }}
      >
        {/* ── LEFT PANEL: Στατιστικά & Ιστορικό ── */}
        <div
          className="flex flex-col"
          style={{
            width: showOrderList ? '50%' : '100%',
            flexShrink: 0,
            borderRight: showOrderList ? '1px solid var(--border-default)' : 'none',
            transition: 'width 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div
            className="flex justify-between items-center px-6 py-5 shrink-0"
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
            <div className="flex flex-col gap-4 mb-6">
              <div className="flex flex-wrap gap-2">
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

              {/* Custom Date Time Inputs */}
              {dateRange === -1 && (
                <div className="flex flex-wrap items-center gap-3 animate-fade-in p-4 rounded-xl" style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-default)' }}>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Από (Ημερομηνία &amp; Ώρα)</label>
                    <input
                      type="datetime-local"
                      value={customStart}
                      onChange={(e) => setCustomStart(e.target.value)}
                      className="px-3 py-2 rounded-lg text-sm outline-none transition-all duration-200"
                      style={{ backgroundColor: 'var(--bg-input)', color: 'var(--text-primary)', border: '1.5px solid var(--text-primary)' }}
                      onFocus={e => {
                        e.target.style.borderColor = 'var(--accent)';
                        e.target.style.boxShadow = '0 0 0 3px var(--accent-muted)';
                      }}
                      onBlur={e => {
                        e.target.style.borderColor = 'var(--text-primary)';
                        e.target.style.boxShadow = 'none';
                      }}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Έως (Ημερομηνία &amp; Ώρα)</label>
                    <input
                      type="datetime-local"
                      value={customEnd}
                      onChange={(e) => setCustomEnd(e.target.value)}
                      className="px-3 py-2 rounded-lg text-sm outline-none transition-all duration-200"
                      style={{ backgroundColor: 'var(--bg-input)', color: 'var(--text-primary)', border: '1.5px solid var(--text-primary)' }}
                      onFocus={e => {
                        e.target.style.borderColor = 'var(--accent)';
                        e.target.style.boxShadow = '0 0 0 3px var(--accent-muted)';
                      }}
                      onBlur={e => {
                        e.target.style.borderColor = 'var(--text-primary)';
                        e.target.style.boxShadow = 'none';
                      }}
                    />
                  </div>
                </div>
              )}
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
                <div className="mb-6">
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

                {/* Αναλυτικό Ιστορικό button */}
                <button
                  onClick={() => setShowOrderList(v => !v)}
                  className="w-full flex items-center justify-between px-5 py-3.5 rounded-2xl text-sm font-semibold transition-all duration-200"
                  style={
                    showOrderList
                      ? {
                          background: 'linear-gradient(135deg, var(--accent), var(--accent-hover))',
                          color: '#fff',
                          boxShadow: '0 2px 8px var(--accent-muted)',
                        }
                      : {
                          backgroundColor: 'var(--bg-tertiary)',
                          color: 'var(--text-primary)',
                          border: '1px solid var(--border-default)',
                        }
                  }
                  onMouseEnter={e => {
                    if (!showOrderList) {
                      (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--accent)';
                      (e.currentTarget as HTMLButtonElement).style.color = 'var(--accent)';
                    }
                  }}
                  onMouseLeave={e => {
                    if (!showOrderList) {
                      (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-default)';
                      (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)';
                    }
                  }}
                >
                  <span className="flex items-center gap-2">
                    <List className="w-4 h-4" />
                    Αναλυτικό Ιστορικό Παραγγελιών
                  </span>
                  <ChevronRight
                    className="w-4 h-4 transition-transform duration-300"
                    style={{ transform: showOrderList ? 'rotate(180deg)' : 'rotate(0deg)' }}
                  />
                </button>
              </>
            )}
          </div>
        </div>

        {/* ── RIGHT PANEL: Αναλυτικό Ιστορικό Παραγγελιών ── */}
        {showOrderList && (
          <div
            className="flex flex-col flex-1 animate-fade-in"
            style={{ minWidth: 0, overflow: 'hidden' }}
          >
            {/* Header */}
            <div
              className="flex justify-between items-center px-6 py-5 shrink-0"
              style={{ borderBottom: '1px solid var(--border-default)' }}
            >
              <h2 className="text-xl font-bold flex items-center gap-2.5" style={{ color: 'var(--text-primary)' }}>
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center"
                  style={{ backgroundColor: 'var(--info-bg)' }}
                >
                  <List className="w-4 h-4" style={{ color: 'var(--info)' }} />
                </div>
                Ιστορικό Παραγγελιών
                {totalOrders > 0 && (
                  <span
                    className="ml-1 px-2.5 py-0.5 rounded-full text-xs font-bold"
                    style={{ backgroundColor: 'var(--accent-muted)', color: 'var(--accent)' }}
                  >
                    {totalOrders}
                  </span>
                )}
              </h2>
              <button
                onClick={() => setShowOrderList(false)}
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

            {/* Order list */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {orders.length === 0 ? (
                <div
                  className="py-16 text-center rounded-2xl"
                  style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px dashed var(--border-default)' }}
                >
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    Δεν υπάρχουν παραγγελίες για αυτήν την περίοδο.
                  </p>
                </div>
              ) : (
                orders.map((order, idx) => {
                  const deliveryMins = getDeliveryMinutes(order);
                  const isCash = order.payment_method === 'cash';
                  return (
                    <div
                      key={order.id}
                      className="rounded-2xl p-4 flex flex-col gap-3 transition-all duration-150"
                      style={{
                        backgroundColor: 'var(--bg-card)',
                        border: '1px solid var(--border-default)',
                      }}
                      onMouseEnter={e => {
                        (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--accent-light)';
                        (e.currentTarget as HTMLDivElement).style.backgroundColor = 'var(--bg-tertiary)';
                      }}
                      onMouseLeave={e => {
                        (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border-default)';
                        (e.currentTarget as HTMLDivElement).style.backgroundColor = 'var(--bg-card)';
                      }}
                    >
                      {/* Top row: order number + date */}
                      <div className="flex items-start justify-between gap-2">
                        <span
                          className="text-xs font-bold px-2 py-0.5 rounded-lg shrink-0"
                          style={{ backgroundColor: 'var(--accent-muted)', color: 'var(--accent)' }}
                        >
                          #{idx + 1}
                        </span>
                        <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                          {formatOrderDate(order.created_at)}
                        </span>
                      </div>

                      {/* Address */}
                      <div className="flex items-start gap-2">
                        <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: 'var(--text-muted)' }} />
                        <span className="text-sm font-medium leading-snug" style={{ color: 'var(--text-primary)' }}>
                          {order.address || '—'}
                        </span>
                      </div>

                      {/* Bottom row: driver, duration, payment */}
                      <div className="flex flex-wrap items-center gap-2 pt-1" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                        {/* Driver */}
                        <div
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg"
                          style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-default)' }}
                        >
                          <Car className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
                          <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                            {order.drivers?.full_name || 'Άγνωστος'}
                          </span>
                        </div>

                        {/* Duration */}
                        {deliveryMins !== null && (
                          <div
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg"
                            style={{
                              backgroundColor: deliveryMins < 15 ? 'var(--success-bg)' : deliveryMins < 25 ? 'rgba(251,146,60,0.1)' : 'rgba(167,139,250,0.1)',
                              border: `1px solid ${deliveryMins < 15 ? 'var(--success-border)' : deliveryMins < 25 ? 'rgba(251,146,60,0.25)' : 'rgba(167,139,250,0.25)'}`,
                            }}
                          >
                            <Clock className="w-3.5 h-3.5" style={{ color: deliveryMins < 15 ? 'var(--success)' : deliveryMins < 25 ? '#fb923c' : '#a78bfa' }} />
                            <span
                              className="text-xs font-bold"
                              style={{ color: deliveryMins < 15 ? 'var(--success)' : deliveryMins < 25 ? '#fb923c' : '#a78bfa' }}
                            >
                              {deliveryMins} λεπτά
                            </span>
                          </div>
                        )}

                        {/* Payment */}
                        <div
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg ml-auto"
                          style={{
                            backgroundColor: isCash ? 'rgba(34,197,94,0.1)' : 'rgba(59,130,246,0.1)',
                            border: `1px solid ${isCash ? 'rgba(34,197,94,0.25)' : 'rgba(59,130,246,0.25)'}`,
                          }}
                        >
                          {isCash
                            ? <Banknote className="w-3.5 h-3.5" style={{ color: '#22c55e' }} />
                            : <CreditCard className="w-3.5 h-3.5" style={{ color: '#3b82f6' }} />
                          }
                          <span
                            className="text-xs font-bold"
                            style={{ color: isCash ? '#22c55e' : '#3b82f6' }}
                          >
                            {isCash ? 'Μετρητά' : 'Κάρτα'}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
