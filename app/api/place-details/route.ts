import { NextRequest, NextResponse } from 'next/server';
import { getGoogleApiKey, googlePlaceDetails } from '../../../lib/google-places';
import { readCachedPlace, writeCachedPlace, type CachedPlace } from '../../../lib/place-cache';

// ── Google Place Details proxy — ΚΛΕΙΝΕΙ το session (βλ. /api/autocomplete) ──
// Καλείται ΜΙΑ φορά ανά ολοκληρωμένη αναζήτηση διεύθυνσης (βλ.
// OrderCreationForm.tsx). Αυτό είναι το ΜΟΝΟ σημείο που χρεώνεται στη Google —
// τα autocomplete requests πριν από αυτό είναι δωρεάν όσο μοιράζονται το ίδιο
// sessionToken.
//
// ΔΥΟ ΕΠΙΠΕΔΑ CACHE, ώστε να πληρώνουμε κάθε σημείο όσο πιο σπάνια γίνεται:
//   L1 = μνήμη αυτού του instance — δωρεάν και ακαριαίο, αλλά ζει ελάχιστα
//        (κάθε cold start του Vercel το σβήνει)
//   L2 = πίνακας public.place_cache — κοινός για όλες τις εταιρίες και για όλα
//        τα instances (βλ. lib/place-cache.ts)
// Σε μια πόλη οι δρόμοι είναι λίγες εκατοντάδες και οι πελάτες επαναλαμβάνονται,
// οπότε το L2 είναι που κρατά τη χρέωση κάτω από το δωρεάν όριο.

type Cached = { at: number; data: unknown };
const memCache = new Map<string, Cached>();
const MEM_TTL_MS = 24 * 60 * 60 * 1000;

const EMPTY = { lat: null, lon: null, exact: false, streetName: null };

export async function GET(req: NextRequest) {
  const placeId = (req.nextUrl.searchParams.get('placeId') || '').trim();
  const sessionToken = (req.nextUrl.searchParams.get('session') || '').trim();
  if (!placeId) {
    return NextResponse.json(EMPTY);
  }

  // ── L1: μνήμη ──
  const hit = memCache.get(placeId);
  if (hit && Date.now() - hit.at < MEM_TTL_MS) {
    return NextResponse.json(hit.data);
  }

  // ── L2: βάση ──
  const stored = await readCachedPlace(placeId);
  if (stored) {
    const data = { lat: stored.lat, lon: stored.lon, exact: stored.exact, streetName: stored.streetName };
    memCache.set(placeId, { at: Date.now(), data });
    return NextResponse.json(data);
  }

  const apiKey = getGoogleApiKey();
  if (!apiKey) {
    console.error('[place-details] Λείπει το GOOGLE_PLACES_API_KEY');
    return NextResponse.json(EMPTY, { status: 500 });
  }
  if (!sessionToken) {
    console.error('[place-details] Λείπει το session token');
    return NextResponse.json(EMPTY, { status: 400 });
  }

  try {
    // ── Google (χρεώσιμο) ──
    const details = await googlePlaceDetails(placeId, sessionToken, apiKey);
    if (!details) return NextResponse.json(EMPTY);

    const place: CachedPlace = {
      lat: details.lat,
      lon: details.lon,
      exact: details.exact,
      streetName: details.streetName,
    };
    const data = { lat: place.lat, lon: place.lon, exact: place.exact, streetName: place.streetName };

    memCache.set(placeId, { at: Date.now(), data });
    // Δεν περιμένουμε τη βάση: η απάντηση στον χρήστη δεν πρέπει να καθυστερεί
    // για μια βελτιστοποίηση κόστους.
    void writeCachedPlace(placeId, place);

    return NextResponse.json(data);
  } catch (e) {
    console.error('[place-details] αποτυχία fetch', e);
    // FAIL-OPEN: ίδια λογική με τα υπόλοιπα routes — ποτέ δεν μπλοκάρουμε παραγγελία.
    return NextResponse.json(EMPTY, { status: 502 });
  }
}
