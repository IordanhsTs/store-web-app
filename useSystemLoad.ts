'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase, getTenantSchema } from './lib/supabase';

export type SystemLoad = 'quiet' | 'moderate' | 'busy';

// Κάθε αλλαγή σε παραγγελία (νέα, ανάθεση διανομέα, αλλαγή status, ολοκλήρωση)
// στέλνει realtime event. Σε ώρα αιχμής έρχονται σε ριπές και το καθένα ξεκινούσε
// ξεχωριστό COUNT στη βάση. Τα μαζεύουμε και μετράμε μία φορά.
const REFRESH_DEBOUNCE_MS = 500;

export function useSystemLoad() {
  const [activeCount, setActiveCount] = useState<number>(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Ο μετρητής υπολογίζεται ΣΤΟΝ SERVER: με head:true φεύγει HEAD request και ο
    // Postgres γυρνάει μόνο το πλήθος (Content-Range) — δεν κατεβαίνει καμία γραμμή.
    const fetchCount = async () => {
      const { count, error } = await supabase
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .in('status', ['pending', 'accepted']);

      if (cancelled || error || count === null) return;
      setActiveCount(count);
    };

    fetchCount();

    const scheduleRefresh = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(fetchCount, REFRESH_DEBOUNCE_MS);
    };

    const channel = supabase
      .channel('system_load_counter')
      .on('postgres_changes', { event: '*', schema: getTenantSchema(), table: 'orders' }, scheduleRefresh)
      .subscribe();

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      supabase.removeChannel(channel);
    };
  }, []);

  const load: SystemLoad =
    activeCount <= 5 ? 'quiet' : activeCount <= 10 ? 'moderate' : 'busy';

  return { activeCount, load };
}
