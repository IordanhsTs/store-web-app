'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase, getTenantSchema } from './lib/supabase';
import { liveChannel } from './lib/live';

export type SystemLoad = 'quiet' | 'moderate' | 'busy' | 'very_busy';

// Κατώφλια φόρτου δικτύου. Ο πελάτης ζήτησε να ΜΗΝ φαίνεται ο αριθμός παραγγελιών,
// αλλά να μείνει η ίδια λογική κλιμάκωσης: 5+ / 10+ / 15+.
const THRESHOLDS = { moderate: 5, busy: 10, veryBusy: 15 };

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

    const stopChannel = liveChannel({
      name: 'system_load_counter',
      // Σε κάθε επανασύνδεση ξαναμετράμε: όσο το κανάλι ήταν πεσμένο ο φόρτος
      // μπορεί να άλλαξε τελείως χωρίς να φτάσει ούτε ένα event.
      onResync: scheduleRefresh,
      bind: (channel) =>
        channel.on(
          'postgres_changes',
          { event: '*', schema: getTenantSchema(), table: 'orders' },
          scheduleRefresh
        ),
    });

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      stopChannel();
    };
  }, []);

  const load: SystemLoad =
    activeCount >= THRESHOLDS.veryBusy ? 'very_busy'
    : activeCount >= THRESHOLDS.busy ? 'busy'
    : activeCount >= THRESHOLDS.moderate ? 'moderate'
    : 'quiet';

  // Το activeCount εξακολουθεί να επιστρέφεται (χρήσιμο για debugging/tooltip),
  // αλλά το UI δείχνει πλέον ΜΟΝΟ την ετικέτα επιπέδου.
  return { activeCount, load };
}
