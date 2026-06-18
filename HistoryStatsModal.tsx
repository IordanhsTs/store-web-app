'use client';

import { useState, useEffect } from 'react';
import { X, TrendingUp, Clock, Car } from 'lucide-react';
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

export default function HistoryStatsModal({ isOpen, onClose, storeId }: HistoryStatsModalProps) {
  const [orders, setOrders] = useState<CompletedOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [dateRange, setDateRange] = useState(0); // 0 = Σήμερα, 3 = Τελευταίες 3, 7 = Τελευταίες 7

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

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-[#1A1A1A] w-full max-w-3xl rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex justify-between items-center p-5 border-b border-gray-100 dark:border-gray-800">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <TrendingUp className="text-[#C5A066] w-6 h-6" />
            Ιστορικό & Στατιστικά
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors">
            <X className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto">
          <div className="flex flex-wrap gap-2 mb-6">
            {[ { label: 'Σήμερα', val: 0 }, { label: '3 Ημέρες', val: 3 }, { label: '7 Ημέρες', val: 7 } ].map(filter => (
              <button
                key={filter.val}
                onClick={() => setDateRange(filter.val)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${dateRange === filter.val ? 'bg-[#C5A066] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'}`}
              >
                {filter.label}
              </button>
            ))}
          </div>

          {loading ? (
             <div className="animate-pulse flex space-x-4 mb-8">
               <div className="flex-1 space-y-4 py-1">
                 <div className="h-20 bg-gray-200 dark:bg-gray-800 rounded-xl"></div>
                 <div className="h-32 bg-gray-200 dark:bg-gray-800 rounded-xl"></div>
               </div>
             </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                <div className="bg-gray-50 dark:bg-[#121212] p-5 rounded-xl border border-gray-100 dark:border-gray-800 flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900/30 flex items-center justify-center"><Car className="w-6 h-6" /></div>
                  <div><p className="text-sm text-gray-500 dark:text-gray-400 font-medium">Συνολικές Παραγγελίες</p><p className="text-2xl font-bold text-gray-900 dark:text-white">{totalOrders}</p></div>
                </div>
                <div className="bg-gray-50 dark:bg-[#121212] p-5 rounded-xl border border-gray-100 dark:border-gray-800 flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 flex items-center justify-center"><Clock className="w-6 h-6" /></div>
                  <div><p className="text-sm text-gray-500 dark:text-gray-400 font-medium">Μέσος Χρόνος Παράδοσης</p><p className="text-2xl font-bold text-gray-900 dark:text-white">{avgDeliveryTime} <span className="text-base font-normal text-gray-500">λεπτά</span></p></div>
                </div>
              </div>

              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Παραγγελίες ανά Οδηγό</h3>
              {Object.keys(ordersPerDriver).length > 0 ? (
                <div className="bg-white dark:bg-[#121212] border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden"><table className="w-full text-left"><thead className="bg-gray-50 dark:bg-[#1A1A1A] border-b border-gray-200 dark:border-gray-800"><tr><th className="px-5 py-3 text-sm font-semibold text-gray-600 dark:text-gray-300">Οδηγός</th><th className="px-5 py-3 text-sm font-semibold text-gray-600 dark:text-gray-300">Σύνολο</th></tr></thead><tbody className="divide-y divide-gray-100 dark:divide-gray-800">{Object.entries(ordersPerDriver).sort((a,b) => b[1] - a[1]).map(([driver, count]) => (<tr key={driver}><td className="px-5 py-3 text-sm text-gray-900 dark:text-white font-medium">{driver}</td><td className="px-5 py-3 text-sm text-gray-600 dark:text-gray-400">{count}</td></tr>))}</tbody></table></div>
              ) : (<p className="text-gray-500 dark:text-gray-400 text-sm">Δεν υπάρχουν δεδομένα για αυτήν την περίοδο.</p>)}
            </>
          )}
        </div>
      </div>
    </div>
  );
}