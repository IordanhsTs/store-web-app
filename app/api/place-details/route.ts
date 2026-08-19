import { NextRequest, NextResponse } from 'next/server';
import { getGoogleApiKey, googlePlaceDetails } from '../../../lib/google-places';
import { readCachedPlace, writeCachedPlace, type CachedPlace } from '../../../lib/place-cache';

// ── Google Place Details proxy — ΚΛΕΙΝΕΙ το session (βλ. /api/autocomplete) ──
// Καλείται ΜΙΑ φορά ανά ολοκληρωμένη αναζήτηση διεύθυνσης (βλ.
// OrderCreationForm.tsx). Αυτό είναι το ΜΟΝΟ σημείο που χρεώνεται στη Google —
// τα autocomplete requests πριν από αυτό είναι δωρεάν όσο μοιράζονται το ίδιο
// sessionToken, ΑΛΛΑ ΜΟΝΟ αν το session ολοκληρωθεί με πραγματικό αίτημα προς
// τη Google. Μια «incomplete» session (autocomplete requests χωρίς να ακολουθήσει
// πραγματικό Place Details στη Google) χρεώνει τα autocomplete requests ένα-ένα
// (SKU «Autocomplete Requests», δικό του ξεχωριστό όριο 10.000/μήνα) — δηλαδή ΤΟ
// ΙΔΙΟ κόστος που τα session tokens υπάρχουν για να αποφύγουν.
//
// Γι' αυτό η Google καλείται ΠΑΝΤΑ πρώτη, ζωντανά — ΠΟΤΕ δεν παρακάμπτεται για
// εξοικονόμηση. Το cache (L1 μνήμη + L2 public.place_cache, βλ. lib/place-cache.ts)
// είναι ΜΟΝΟ δίχτυ ασφαλείας για όταν η Google αποτύχει (πεσμένο API, λείπει
// κλειδί, timeout) — resilience, όχι μείωση χρέωσης. Βρέθηκε 2026-08-19 ότι η
// παλιά σειρά (cache πρώτα, Google μόνο σε miss) μετέτρεπε ολοκληρωμένα sessions σε
// «incomplete» σε κάθε cache hit, μετακυλώντας το κόστος από το Place Details στο
// Autocomplete — ακριβώς το αντίθετο απ' ό,τι ήθελε.

type Cached = { at: number; data: unknown };
const memCache = new Map<string, Cached>();
const MEM_TTL_MS = 24 * 60 * 60 * 1000;

const EMPTY = { lat: null, lon: null, exact: false, streetName: null };

/** Δίχτυ ασφαλείας: ό,τι έχουμε αποθηκευμένο, μόνο όταν η ζωντανή κλήση απέτυχε. */
async function fallbackFromCache(placeId: string): Promise<unknown | null> {
  const hit = memCache.get(placeId);
  if (hit && Date.now() - hit.at < MEM_TTL_MS) return hit.data;

  const stored = await readCachedPlace(placeId);
  if (stored) {
    const data = { lat: stored.lat, lon: stored.lon, exact: stored.exact, streetName: stored.streetName };
    memCache.set(placeId, { at: Date.now(), data });
    return data;
  }
  return null;
}

export async function GET(req: NextRequest) {
  const placeId = (req.nextUrl.searchParams.get('placeId') || '').trim();
  const sessionToken = (req.nextUrl.searchParams.get('session') || '').trim();
  if (!placeId) {
    return NextResponse.json(EMPTY);
  }

  const apiKey = getGoogleApiKey();
  if (!apiKey) {
    console.error('[place-details] Λείπει το GOOGLE_PLACES_API_KEY');
    const fallback = await fallbackFromCache(placeId);
    return NextResponse.json(fallback ?? EMPTY, fallback ? undefined : { status: 500 });
  }
  if (!sessionToken) {
    console.error('[place-details] Λείπει το session token');
    const fallback = await fallbackFromCache(placeId);
    return NextResponse.json(fallback ?? EMPTY, fallback ? undefined : { status: 400 });
  }

  try {
    // ── Google (χρεώσιμο, ΠΑΝΤΑ ζωντανά — κλείνει σωστά το session) ──
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
    // για ενημέρωση του δίχτυ ασφαλείας.
    void writeCachedPlace(placeId, place);

    return NextResponse.json(data);
  } catch (e) {
    console.error('[place-details] αποτυχία fetch, δοκιμή δίχτυ ασφαλείας', e);
    // FAIL-OPEN: ίδια λογική με τα υπόλοιπα routes — ποτέ δεν μπλοκάρουμε παραγγελία.
    const fallback = await fallbackFromCache(placeId);
    return NextResponse.json(fallback ?? EMPTY, fallback ? undefined : { status: 502 });
  }
}
