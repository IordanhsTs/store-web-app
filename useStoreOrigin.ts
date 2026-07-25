'use client';

import { useEffect, useState } from 'react';
import { supabase } from './lib/supabase';

export type StoreOrigin = { lat: number; lon: number } | null;

/**
 * Η ΑΦΕΤΗΡΙΑ του καταστήματος για τον υπολογισμό απόστασης.
 *
 * Ο πίνακας stores κρατούσε μόνο κείμενο διεύθυνσης. Την πρώτη φορά που τη
 * χρειαζόμαστε τη γεωκωδικοποιούμε (ένα call, μέσω του server-side proxy) και τη
 * ΓΡΑΦΟΥΜΕ στη βάση — άρα συμβαίνει μία φορά ανά κατάστημα, ποτέ ξανά.
 *
 * Δεν ξαναγράφουμε ΠΟΤΕ πάνω σε υπάρχουσες συντεταγμένες: ο ADMIN μπορεί να έχει
 * διορθώσει το σημείο στον χάρτη (απόφαση χρήστη) και η διόρθωσή του είναι η
 * αυθεντία, όχι το geocoding.
 *
 * Fail-open: αν δεν βγει σημείο (κακή/κενή διεύθυνση, πεσμένο Geoapify) γυρνάμε
 * null και ο καλών απλά δεν δείχνει απόσταση — ΔΕΝ μπλοκάρουμε παραγγελίες,
 * γιατί μια αποτυχία geocoding δεν πρέπει να σταματά τη δουλειά του μαγαζιού.
 */
export function useStoreOrigin(store: {
  id: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
}): StoreOrigin {
  const [origin, setOrigin] = useState<StoreOrigin>(
    store.latitude != null && store.longitude != null
      ? { lat: store.latitude, lon: store.longitude }
      : null
  );

  useEffect(() => {
    // Έχουμε ήδη σημείο (από τη βάση ή από τον admin) → τέλος.
    if (origin) return;
    if (!store.address) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/geocode?text=${encodeURIComponent(store.address as string)}`);
        const { lat, lon } = await res.json();
        if (cancelled || typeof lat !== 'number' || typeof lon !== 'number') return;

        setOrigin({ lat, lon });
        // Αποθήκευση ώστε να μη ξαναγίνει geocoding. `is(null)` guard: αν στο
        // μεταξύ το έθεσε ο admin, δεν το πατάμε.
        await supabase
          .from('stores')
          .update({ latitude: lat, longitude: lon })
          .eq('id', store.id)
          .is('latitude', null);
      } catch {
        // fail-open — καμία απόσταση, καμία παρεμπόδιση
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.id, store.address]);

  return origin;
}
