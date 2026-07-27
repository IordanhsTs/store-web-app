'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase, getTenantSchema } from './lib/supabase';

export type Order = {
  id: string;
  store_id: string;
  driver_id: string | null;
  address: string;
  payment_method: 'cash' | 'card';
  comments: string;
  status: 'scheduled' | 'pending' | 'accepted' | 'completed' | 'cancelled';
  created_at: string;
  // Γεμίζει από release_due_orders() τη στιγμή scheduled→pending — βλ. ActiveOrdersList.
  activated_at: string | null;
  accepted_at: string | null;
  picked_up_at: string | null;
  completed_at: string | null;
  scheduled_at: string | null;
  distance_km: number | null;
  surcharge: number | null;
  drivers?: {
    full_name: string;
    phone: string;
    latitude?: number;
    longitude?: number;
  } | null;
};

// Πόσο συχνά ζητάμε από τη βάση να «απελευθερώσει» τις προγραμματισμένες
// παραγγελίες που έφτασε η ώρα τους (scheduled → pending).
const RELEASE_POLL_MS = 15000;

export function useActiveOrders(storeId: string) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  // Ποιες παραγγελίες ήταν ήδη 'accepted' — για να παίξει ήχος ΜΟΝΟ στη στιγμή
  // της αποδοχής και όχι σε κάθε άσχετο update της ίδιας παραγγελίας.
  const acceptedSeen = useRef<Set<string>>(new Set());
  const firstLoad = useRef(true);

  useEffect(() => {
    if (!storeId) return;

    const playSound = () => {
      try {
        if (localStorage.getItem('soundEnabled') === 'false') return;
        const audio = new Audio('/notification.mp3');
        audio.play().catch((e) => console.log('Σφάλμα αναπαραγωγής ήχου:', e));
      } catch {}
    };

    // 1. Fetch initial active orders
    const fetchOrders = async () => {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          *,
          drivers (full_name, phone, latitude, longitude)
        `)
        .eq('store_id', storeId)
        .in('status', ['scheduled', 'pending', 'accepted'])
        .order('created_at', { ascending: true });

      if (!error && data) {
        const list = data as Order[];

        // ΗΧΟΣ ΣΤΗΝ ΑΠΟΔΟΧΗ (αίτημα πελάτη: ήχος όταν ο διανομέας πάρει την
        // παραγγελία, ΟΧΙ όταν τη στέλνει το κατάστημα — το ήξερε ήδη ότι την
        // έστειλε). Στο πρώτο φόρτωμα μόνο καταγράφουμε, δεν ηχούμε.
        const nowAccepted = list.filter((o) => o.status === 'accepted').map((o) => o.id);
        if (!firstLoad.current) {
          const fresh = nowAccepted.filter((id) => !acceptedSeen.current.has(id));
          if (fresh.length > 0) playSound();
        }
        acceptedSeen.current = new Set(nowAccepted);
        firstLoad.current = false;

        setOrders(list);
      }
      setLoading(false);
    };

    fetchOrders();

    // Απελευθέρωση των προγραμματισμένων που έφτασε η ώρα τους. Το κάνει όποιος
    // client είναι ανοιχτός (ατομικό UPDATE στη βάση — ο πρώτος κερδίζει), και το
    // realtime event ενημερώνει μετά όλους τους υπόλοιπους.
    const releaseDue = async () => {
      try { await supabase.rpc('release_due_orders'); } catch {}
    };
    releaseDue();
    const releaseTimer = setInterval(releaseDue, RELEASE_POLL_MS);

    // 2. Subscribe to real-time changes
    const channelId = `active_orders_updates_${storeId}_${Math.random().toString(36).substring(7)}`;
    const channel = supabase
      .channel(channelId)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: getTenantSchema(),
          table: 'orders',
          filter: `store_id=eq.${storeId}`,
        },
        (payload) => {
          if (payload.eventType === 'UPDATE') {
            const updatedOrder = payload.new as Partial<Order>;
            if (updatedOrder.status === 'completed' || updatedOrder.status === 'cancelled') {
              setOrders((prev) => prev.filter((o) => o.id !== updatedOrder.id));
              return;
            }
          } else if (payload.eventType === 'DELETE') {
            setOrders((prev) => prev.filter((o) => o.id !== payload.old?.id));
            return;
          }
          // Κάθε άλλη περίπτωση (INSERT / UPDATE που μένει ενεργή) → επαναφόρτωση,
          // η οποία αναλαμβάνει και τον ήχο αποδοχής.
          fetchOrders();
        }
      )
      .subscribe();

    return () => {
      clearInterval(releaseTimer);
      supabase.removeChannel(channel);
    };
  }, [storeId]);

  // 3. Subscribe to driver location updates — ΜΟΝΟ για τους διανομείς των
  // ενεργών παραγγελιών του καταστήματος, όχι για όλο τον στόλο. Το κανάλι
  // ξαναχτίζεται όταν αλλάξει το σύνολο των driver ids (ανάθεση/ολοκλήρωση).
  const driverIdsKey = Array.from(
    new Set(orders.map((o) => o.driver_id).filter((id): id is string => !!id))
  )
    .sort()
    .join(',');

  useEffect(() => {
    if (!driverIdsKey) return;

    const driverChannelId = `active_drivers_updates_${storeId}_${Math.random().toString(36).substring(7)}`;
    const driverChannel = supabase
      .channel(driverChannelId)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: getTenantSchema(),
          table: 'drivers',
          filter: `id=in.(${driverIdsKey})`,
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
      supabase.removeChannel(driverChannel);
    };
  }, [storeId, driverIdsKey]);

  return { orders, loading };
}
