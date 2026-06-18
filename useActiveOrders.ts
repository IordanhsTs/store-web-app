'use client';

import { useEffect, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';

export type Order = {
  id: string;
  store_id: string;
  driver_id: string | null;
  address: string;
  payment_method: 'cash' | 'card';
  comments: string;
  status: 'pending' | 'accepted' | 'completed' | 'cancelled';
  created_at: string;
  accepted_at: string | null;
  completed_at: string | null;
  drivers?: {
    full_name: string;
    phone: string;
    latitude?: number;
    longitude?: number;
  } | null;
};

export function useActiveOrders(storeId: string) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  // Initialize Supabase client
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  useEffect(() => {
    if (!storeId) return;

    // 1. Fetch initial active orders
    const fetchOrders = async () => {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          *,
          drivers (full_name, phone, latitude, longitude)
        `)
        .eq('store_id', storeId)
        .in('status', ['pending', 'accepted'])
        .order('created_at', { ascending: true });

      if (!error && data) {
        setOrders(data as Order[]);
      }
      setLoading(false);
    };

    fetchOrders();

    // 2. Subscribe to real-time changes
    const channel = supabase
      .channel('active_orders_updates')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders',
          filter: `store_id=eq.${storeId}`,
        },
        (payload) => {
          // Αναπαραγωγή ήχου αν προστεθεί νέα παραγγελία
          if (payload.eventType === 'INSERT') {
            try {
              const audio = new Audio('/notification.mp3');
              audio.play().catch((e) => console.log('Σφάλμα αναπαραγωγής ήχου:', e));
            } catch (_err) {}
          }
          fetchOrders();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [storeId, supabase]);

  return { orders, loading };
}