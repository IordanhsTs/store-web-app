'use client';

import { useEffect, useState } from 'react';
import { haversineKm, MAX_DISTANCE_KM } from './lib/distance';

// ── Απόσταση κατάστημα → προορισμός, ΟΔΙΚΑ με fallback στην ευθεία ───────────
// Ένα hook για τα δύο σημεία που μετρούν απόσταση (φόρμα παραγγελίας και πινέζα
// χάρτη), ώστε το debounce και η πολιτική fallback να ζουν σε ΕΝΑ μέρος.
//
// Η σειρά που βλέπει ο χρήστης:
//   1. μόλις κλειδώσει η διεύθυνση εμφανίζεται ΑΜΕΣΩΣ η ευθεία (0 credits, 0ms)
//   2. ~350ms αργότερα φεύγει η κλήση στο /api/route-distance
//   3. όταν γυρίσει, ο αριθμός αναβαθμίζεται στην πραγματική οδική απόσταση
// Έτσι η φόρμα δεν μένει ποτέ κενή και δεν μπλοκάρει σε αργό δίκτυο.
//
// ΔΕΝ κρατάμε cache στον browser: το cache που μετράει (αυτό που γλιτώνει credits)
// είναι του server. Ένα δεύτερο, τοπικό, θα απαιτούσε ανάγνωση ref μέσα στο render
// και θα κέρδιζε μόνο ένα round-trip.

type Point = { lat: number; lon: number } | null;

// Το αποτέλεσμα κουβαλά ΤΟ key της διαδρομής του. Έτσι δεν χρειάζεται «καθάρισμα»
// σε κάθε αλλαγή προορισμού — στο render απλώς αγνοούμε ό,τι ανήκει σε άλλο key,
// που είναι και ο μόνος τρόπος να μη δείξουμε ποτέ την απόσταση άλλης διεύθυνσης.
type Outcome =
  | { key: string; status: 'ok'; km: number; minutes: number | null }
  | { key: string; status: 'failed' };

export type Distance = {
  /** Χιλιόμετρα για εμφάνιση ΚΑΙ χρέωση — οδικά αν τα έχουμε, αλλιώς ευθεία. */
  km: number | null;
  /** Από πού προέκυψε το km — το UI το δείχνει ώστε να μη μαντεύει κανείς. */
  source: 'road' | 'straight' | null;
  /** Εκτιμώμενος χρόνος διαδρομής σε λεπτά — μόνο όταν source === 'road'. */
  minutes: number | null;
  /** Τρέχει η κλήση οδικής απόστασης· το km δείχνει ήδη την ευθεία. */
  loading: boolean;
};

const DEBOUNCE_MS = 350;
const TIMEOUT_MS = 5000;

// ΙΔΙΑ στρογγυλοποίηση με τον server (app/api/route-distance): 4 δεκαδικά ≈ 11
// μέτρα, ώστε τα δύο caches να συμφωνούν και να μη χαλάει credit μια μετατόπιση
// λίγων μέτρων.
const key4 = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
  `${a.lat.toFixed(4)},${a.lon.toFixed(4)}|${b.lat.toFixed(4)},${b.lon.toFixed(4)}`;

export function useRoadDistance(origin: Point, dest: Point): Distance {
  const straight =
    origin && dest ? haversineKm(origin.lat, origin.lon, dest.lat, dest.lon) : null;

  const pairKey = origin && dest ? key4(origin, dest) : null;

  // Πάνω από το όριο ήδη σε ευθεία → η οδική δεν το σώζει (είναι πάντα ≥ αυτής).
  // Καμία κλήση, κανένα credit· το UI μπλοκάρει με την τιμή της ευθείας.
  const skip = straight === null || straight > MAX_DISTANCE_KM;

  const [outcome, setOutcome] = useState<Outcome | null>(null);

  useEffect(() => {
    if (!pairKey || skip) return;

    let cancelled = false;
    const controller = new AbortController();
    // Σκληρό πλαφόν: αν το Geoapify κρεμάσει, πρέπει να πέσουμε στην ευθεία.
    // Χωρίς αυτό, ο έλεγχος «μη στέλνεις όσο υπολογίζεται» στη φόρμα παραγγελίας
    // θα κλείδωνε το κουμπί αποστολής επ' αόριστον.
    const kill = setTimeout(() => controller.abort(), DEBOUNCE_MS + TIMEOUT_MS);

    const timer = setTimeout(async () => {
      const [from, to] = pairKey.split('|');
      try {
        const res = await fetch(
          `/api/route-distance?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
          { signal: controller.signal }
        );
        const data = await res.json();
        if (cancelled) return;
        setOutcome(
          typeof data?.km === 'number'
            ? {
                key: pairKey,
                status: 'ok',
                km: data.km,
                minutes: typeof data.minutes === 'number' ? data.minutes : null,
              }
            : { key: pairKey, status: 'failed' }
        );
      } catch (e) {
        if ((e as Error).name !== 'AbortError') console.error(e);
        // Ακόμα κι ένα timeout πρέπει να καταγραφεί ως «τελείωσε», αλλιώς το
        // loading μένει αναμμένο για πάντα.
        if (!cancelled) setOutcome({ key: pairKey, status: 'failed' });
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearTimeout(kill);
      controller.abort();
    };
  }, [pairKey, skip]);

  // Μόνο το αποτέλεσμα ΤΗΣ τρέχουσας διαδρομής μετράει.
  const current = outcome && outcome.key === pairKey ? outcome : null;
  const road = current?.status === 'ok' ? current : null;

  return {
    km: road ? road.km : straight,
    source: straight === null ? null : road ? 'road' : 'straight',
    minutes: road ? road.minutes : null,
    // Όσο δεν έχει έρθει αποτέλεσμα για ΑΥΤΗ τη διαδρομή, υπολογίζουμε.
    loading: pairKey !== null && !skip && current === null,
  };
}
