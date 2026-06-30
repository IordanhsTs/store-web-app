'use client';

import { useEffect, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export type SystemLoad = 'quiet' | 'moderate' | 'busy';

export function useSystemLoad() {
  const [activeCount, setActiveCount] = useState<number>(0);

  const fetchCount = async () => {
    const { count } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .in('status', ['pending', 'accepted']);

    if (count !== null) setActiveCount(count);
  };

  useEffect(() => {
    fetchCount();

    const channel = supabase
      .channel('system_load_counter')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        fetchCount();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const load: SystemLoad =
    activeCount <= 5 ? 'quiet' : activeCount <= 10 ? 'moderate' : 'busy';

  return { activeCount, load };
}
