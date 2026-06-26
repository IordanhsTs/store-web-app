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

// Initialize Supabase client globally so it's not recreated on every render
const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export function useActiveOrders(storeId: string) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

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
    const channelId = `active_orders_updates_${storeId}_${Math.random().toString(36).substring(7)}`;
    const channel = supabase
      .channel(channelId)
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
              const soundEnabled = localStorage.getItem('soundEnabled') !== 'false';
              if (soundEnabled) {
                const audio = new Audio('/notification.mp3');
                audio.play().catch((e) => console.log('Σφάλμα αναπαραγωγής ήχου:', e));
              }
            } catch {}
            fetchOrders();
          } else if (payload.eventType === 'UPDATE') {
            const updatedOrder = payload.new as Partial<Order>;
            if (updatedOrder.status === 'completed' || updatedOrder.status === 'cancelled') {
              setOrders((prev) => prev.filter((o) => o.id !== updatedOrder.id));
            } else {
              fetchOrders();
            }
          } else if (payload.eventType === 'DELETE') {
            setOrders((prev) => prev.filter((o) => o.id !== payload.old?.id));
          } else {
            fetchOrders();
          }
        }
      )
      .subscribe();

    // 3. Subscribe to driver location updates
    const driverChannelId = `active_drivers_updates_${storeId}_${Math.random().toString(36).substring(7)}`;
    const driverChannel = supabase
      .channel(driverChannelId)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'drivers',
        },
        (payload) => {
          const updatedDriver = payload.new;
          setOrders((prev) =>
            prev.map((order) => {
              if (order.driver_id === updatedDriver.id && order.drivers) {
                return {
                  ...order,
                  drivers: {
                    ...order.drivers,
                    latitude: updatedDriver.latitude,
                    longitude: updatedDriver.longitude,
                  },
                };
              }
              return order;
            })
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(driverChannel);
    };
  }, [storeId]);

  return { orders, loading };
}