'use client';

import { useEffect, useState } from 'react';
import { haversineKm, MAX_DISTANCE_KM } from './lib/distance';
import { measureRoadDistance, routeKey, type Point, type RoadDistance } from './lib/road-distance';

// ── ΖΩΝΤΑΝΗ απόσταση κατάστημα → προορισμός, καθώς αλλάζει το σημείο ─────────
// Χρησιμοποιείται ΜΟΝΟ εκεί που ο χρήστης μετακινεί ο ίδιος ένα σημείο και
// περιμένει να δει την απόσταση να ενημερώνεται: η πινέζα του AddressPicker.
//
// Η φόρμα παραγγελίας ΔΕΝ το χρησιμοποιεί πια. Εκεί η απόσταση υπολογίζεται
// μία φορά, με το πάτημα της «Αποστολής» — βλ. OrderCreationForm.tsx, ενότητα
// «Ο υπολογισμός γίνεται ΜΟΝΟ στην αποστολή».
//
// ΔΕΝ κρατάμε cache στον browser: το cache που μετράει (αυτό που γλιτώνει credits)
// είναι του server. Ένα δεύτερο, τοπικό, θα απαιτούσε ανάγνωση ref μέσα στο render
// και θα κέρδιζε μόνο ένα round-trip.

// Το αποτέλεσμα κουβαλά ΤΟ key της διαδρομής του. Έτσι δεν χρειάζεται «καθάρισμα»
// σε κάθε αλλαγή προορισμού — στο render απλώς αγνοούμε ό,τι ανήκει σε άλλο key,
// που είναι και ο μόνος τρόπος να μη δείξουμε ποτέ την απόσταση άλλης διεύθυνσης.
type Outcome =
  | { key: string; status: 'ok'; km: number; minutes: number | null }
  | { key: string; status: 'failed' };

export type Distance = RoadDistance & {
  /** Τρέχει η κλήση οδικής απόστασης· δεν έχουμε ακόμα τιμή να δείξουμε. */
  loading: boolean;
};

const DEBOUNCE_MS = 350;

export function useRoadDistance(origin: Point | null, dest: Point | null): Distance {
  const straight =
    origin && dest ? haversineKm(origin.lat, origin.lon, dest.lat, dest.lon) : null;

  const pairKey = origin && dest ? routeKey(origin, dest) : null;

  // Πάνω από το όριο ήδη σε ευθεία → καμία κλήση (βλ. measureRoadDistance).
  const skip = straight === null || straight > MAX_DISTANCE_KM;

  const [outcome, setOutcome] = useState<Outcome | null>(null);

  useEffect(() => {
    if (!pairKey || skip) return;

    let cancelled = false;
    const controller = new AbortController();

    const timer = setTimeout(async () => {
      const result = await measureRoadDistance(origin, dest, { signal: controller.signal });
      if (cancelled) return;
      setOutcome(
        result.source === 'road' && result.km !== null
          ? { key: pairKey, status: 'ok', km: result.km, minutes: result.minutes }
          : { key: pairKey, status: 'failed' }
      );
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
    // Το pairKey κωδικοποιεί ήδη τα origin/dest (στρογγυλεμένα στα ~11 μέτρα),
    // οπότε δεν χρειάζονται ως deps — και ως αντικείμενα θα ξανάτρεχαν σε κάθε render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairKey, skip]);

  // Μόνο το αποτέλεσμα ΤΗΣ τρέχουσας διαδρομής μετράει.
  const current = outcome && outcome.key === pairKey ? outcome : null;
  const road = current?.status === 'ok' ? current : null;

  // Όσο δεν έχει έρθει αποτέλεσμα για ΑΥΤΗ τη διαδρομή, υπολογίζουμε.
  const loading = pairKey !== null && !skip && current === null;

  // ΔΕΝ δείχνουμε την ευθεία όσο τρέχει το routing (απόφαση χρήστη 30/07/2026).
  // Πριν, το badge έγραφε πρώτα την ευθεία (π.χ. 0,9 χλμ) και ~350ms αργότερα
  // πηδούσε στην οδική (1,1 χλμ). Ήταν σωστό τεχνικά αλλά «ύποπτο» για τον
  // μαγαζάτορα: ένας αριθμός χρέωσης που αλλάζει μόνος του υπονομεύει την
  // εμπιστοσύνη στο σύστημα. Καλύτερα μία τιμή, μία φορά, η σωστή.
  return {
    km: loading ? null : road ? road.km : straight,
    source: loading || straight === null ? null : road ? 'road' : 'straight',
    minutes: road ? road.minutes : null,
    loading,
  };
}
