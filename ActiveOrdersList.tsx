'use client';

import { useState, useEffect } from 'react';
import { useActiveOrders } from './useActiveOrders';
import { Clock, Map, XCircle, User, MessageSquare } from 'lucide-react';
import { differenceInMinutes } from 'date-fns';
import { createBrowserClient } from '@supabase/ssr';
import DriverMapModal from './DriverMapModal';

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function ActiveOrdersList({ storeId }: { storeId: string }) {
  const { orders, loading } = useActiveOrders(storeId);
  const [now, setNow] = useState(new Date());
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

  const handleCancel = async (orderId: string) => {
    if (!confirm('Είστε σίγουροι ότι θέλετε να ακυρώσετε την παραγγελία;')) return;
    await supabase.from('orders').update({ status: 'cancelled' }).eq('id', orderId);
  };

  if (loading) {
    return <div className="animate-pulse space-y-4">
      {[1, 2, 3].map(i => <div key={i} className="h-32 bg-gray-200 dark:bg-[#1A1A1A] rounded-xl"></div>)}
    </div>;
  }

  if (orders.length === 0) {
    return (
      <div className="text-center py-12 bg-white dark:bg-[#1A1A1A] rounded-xl border border-gray-100 dark:border-gray-800">
        <div className="text-gray-400 dark:text-gray-500 mb-2">Δεν υπάρχουν ενεργές παραγγελίες.</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {orders.map((order) => {
        const minutesElapsed = differenceInMinutes(now, new Date(order.created_at));
        const isLate = order.status === 'pending' && minutesElapsed > 9;
        
        const timeBadgeColor = isLate 
          ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800' 
          : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800';

        return (
          <div key={order.id} className="bg-white dark:bg-[#1A1A1A] p-5 rounded-xl shadow-sm border border-gray-100 dark:border-gray-800 relative overflow-hidden transition-all hover:shadow-md">
            {/* Αριστερή λωρίδα χρώματος ανάλογα με το status */}
            <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${order.status === 'pending' ? 'bg-[#C5A066]' : 'bg-blue-500'}`}></div>
            
            <div className="flex justify-between items-start mb-3">
              <div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                  {order.address}
                  <span className={`text-xs px-2 py-0.5 rounded uppercase font-semibold ${order.payment_method === 'cash' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                    {order.payment_method === 'cash' ? 'Μετρητά' : 'Κάρτα'}
                  </span>
                </h3>
                
                {order.comments && (
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 flex items-start gap-1.5">
                    <MessageSquare className="w-4 h-4 mt-0.5 shrink-0" />
                    {order.comments}
                  </p>
                )}
              </div>

              <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-medium text-sm ${timeBadgeColor}`}>
                <Clock className="w-4 h-4" />
                {minutesElapsed} min
              </div>
            </div>

            <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
              {order.status === 'pending' ? (
                <>
                  <span className="text-sm font-medium text-[#C5A066] animate-pulse">Αναμονή για οδηγό...</span>
                  <button onClick={() => handleCancel(order.id)} className="flex items-center gap-1.5 text-sm font-medium text-red-500 hover:text-red-600 transition-colors">
                    <XCircle className="w-4 h-4" /> Ακύρωση
                  </button>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
                      <User className="w-4 h-4 text-blue-500" />
                      {order.drivers?.full_name || 'Άγνωστος Οδηγός'}
                    </div>
                    {/* TODO: Driver workload count fetch */}
                    <div className="text-xs text-gray-500 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded-md">
                      Ενεργές: 1
                    </div>
                  </div>
                  <button 
                    onClick={() => {
                      if (order.drivers?.latitude && order.drivers?.longitude) {
                        setMapModal({ isOpen: true, driverName: order.drivers.full_name, lat: order.drivers.latitude, lng: order.drivers.longitude });
                      } else {
                        alert('Δεν υπάρχει διαθέσιμη τοποθεσία για αυτόν τον οδηγό.');
                      }
                    }}
                    className="flex items-center gap-1.5 text-sm font-medium bg-blue-50 hover:bg-blue-100 text-blue-600 dark:bg-blue-900/20 dark:hover:bg-blue-900/40 dark:text-blue-400 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    <Map className="w-4 h-4" /> Χάρτης
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}

      <DriverMapModal 
        isOpen={mapModal.isOpen} 
        onClose={() => setMapModal({ ...mapModal, isOpen: false })} 
        driverName={mapModal.driverName} 
        lat={mapModal.lat} 
        lng={mapModal.lng} 
      />
    </div>
  );
}