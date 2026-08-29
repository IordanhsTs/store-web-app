'use client';

import { haversineKm, MAX_DISTANCE_KM } from './distance';

// ── ΜΙΑ μέτρηση οδικής απόστασης, δύο καλούντες ──────────────────────────────
// Η πολιτική (πότε γλιτώνουμε credit, πόσο περιμένουμε, τι κάνουμε σε αποτυχία)
// ζει ΕΔΩ και μόνο εδώ, γιατί δύο ροές τη χρειάζονται με διαφορετικό τρόπο:
//
//   • AddressPicker → useRoadDistance: ζωντανά, καθώς ο χρήστης σέρνει την πινέζα
//   • OrderCreationForm → κατευθείαν, ΜΙΑ φορά, τη στιγμή της αποστολής
//
// Αν η πολιτική διχαζόταν, οι δύο ροές θα μπορούσαν να χρεώσουν διαφορετικά
// χιλιόμετρα για το ίδιο σημείο.

export type Point = { lat: number; lon: number };

export type RoadDistance = {
  /** Χιλιόμετρα για εμφάνιση ΚΑΙ χρέωση — οδικά αν τα έχουμε, αλλιώς ευθεία. */
  km: number | null;
  /** Από πού προέκυψε το km — ο καλών το δείχνει ώστε να μη μαντεύει κανείς. */
  source: 'road' | 'straight' | null;
  /** Εκτιμώμενος χρόνος διαδρομής σε λεπτά — μόνο όταν source === 'road'. */
  minutes: number | null;
};

/** Σκληρό πλαφόν: αν το Geoapify κρεμάσει, πέφτουμε στην ευθεία αντί να περιμένουμε. */
export const ROUTE_TIMEOUT_MS = 5000;

// ΙΔΙΑ στρογγυλοποίηση με τον server (app/api/route-distance): 4 δεκαδικά ≈ 11
// μέτρα, ώστε τα δύο caches να συμφωνούν και να μη χαλάει credit μια μετατόπιση
// λίγων μέτρων.
export const routeKey = (a: Point, b: Point) =>
  `${a.lat.toFixed(4)},${a.lon.toFixed(4)}|${b.lat.toFixed(4)},${b.lon.toFixed(4)}`;

/**
 * Οδική απόσταση κατάστημα → προορισμός, με fallback στην ευθεία.
 *
 * ΠΟΤΕ δεν πετάει και ΠΟΤΕ δεν γυρνάει κενό όταν υπάρχουν δύο σημεία: κάθε
 * αποτυχία (πεσμένο Geoapify, timeout, σημείο εκτός οδικού δικτύου) καταλήγει
 * στην ευθεία με `source: 'straight'`. Καμία παραγγελία δεν μένει χωρίς
 * απόσταση επειδή έπεσε μια εξωτερική υπηρεσία.
 */
export async function measureRoadDistance(
  origin: Point | null,
  dest: Point | null,
  opts: { signal?: AbortSignal } = {}
): Promise<RoadDistance> {
  if (!origin || !dest) return { km: null, source: null, minutes: null };

  const straight = haversineKm(origin.lat, origin.lon, dest.lat, dest.lon);
  const fallback: RoadDistance = { km: straight, source: 'straight', minutes: null };

  // Πάνω από το όριο ήδη σε ευθεία → η οδική δεν το σώζει (είναι πάντα ≥ αυτής).
  // Καμία κλήση, κανένα credit· ο καλών μπλοκάρει με την τιμή της ευθείας.
  if (straight > MAX_DISTANCE_KM) return fallback;

  const controller = new AbortController();
  const kill = setTimeout(() => controller.abort(), ROUTE_TIMEOUT_MS);
  const onOuterAbort = () => controller.abort();
  opts.signal?.addEventListener('abort', onOuterAbort);

  try {
    const [from, to] = routeKey(origin, dest).split('|');
    const res = await fetch(
      `/api/route-distance?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      { signal: controller.signal }
    );
    const data = await res.json();
    if (typeof data?.km === 'number') {
      return {
        km: data.km,
        source: 'road',
        minutes: typeof data.minutes === 'number' ? data.minutes : null,
      };
    }
    return fallback;
  } catch (e) {
    if ((e as Error).name !== 'AbortError') console.error(e);
    return fallback;
  } finally {
    clearTimeout(kill);
    opts.signal?.removeEventListener('abort', onOuterAbort);
  }
}
