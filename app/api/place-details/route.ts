import { NextRequest, NextResponse } from 'next/server';
import { getGoogleApiKey, googlePlaceDetails } from '../../../lib/google-places';

// ── Google Place Details proxy — ΚΛΕΙΝΕΙ το session (βλ. /api/autocomplete) ──
// Καλείται ΜΙΑ φορά ανά ολοκληρωμένη αναζήτηση διεύθυνσης: όταν ο χρήστης
// διαλέγει μια πρόταση, ή όταν σταματά να πληκτρολογεί τον αριθμό μετά από
// επιλεγμένο δρόμο (βλ. OrderCreationForm.tsx). Αυτό είναι το ΜΟΝΟ σημείο που
// χρεώνεται στη Google — τα autocomplete requests πριν από αυτό είναι δωρεάν
// όσο μοιράζονται το ίδιο sessionToken.

type Cached = { at: number; data: unknown };
const cache = new Map<string, Cached>();
const TTL_MS = 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const placeId = (req.nextUrl.searchParams.get('placeId') || '').trim();
  const sessionToken = (req.nextUrl.searchParams.get('session') || '').trim();
  if (!placeId) {
    return NextResponse.json({ lat: null, lon: null, exact: false, streetName: null });
  }

  // Cache ΜΟΝΟ ανά placeId (όχι session) — το σημείο ενός συγκεκριμένου place
  // δεν αλλάζει ανά χρήστη. Έτσι μια δεύτερη παραγγελία στην ίδια διεύθυνση δεν
  // ξαναχρεώνει Place Details.
  const hit = cache.get(placeId);
  if (hit && Date.now() - hit.at < TTL_MS) {
    return NextResponse.json(hit.data);
  }

  const apiKey = getGoogleApiKey();
  if (!apiKey) {
    console.error('[place-details] Λείπει το GOOGLE_PLACES_API_KEY');
    return NextResponse.json({ lat: null, lon: null, exact: false, streetName: null }, { status: 500 });
  }
  if (!sessionToken) {
    console.error('[place-details] Λείπει το session token');
    return NextResponse.json({ lat: null, lon: null, exact: false, streetName: null }, { status: 400 });
  }

  try {
    const details = await googlePlaceDetails(placeId, sessionToken, apiKey);
    const data = details
      ? { lat: details.lat, lon: details.lon, exact: details.exact, streetName: details.streetName }
      : { lat: null, lon: null, exact: false, streetName: null };
    if (details) cache.set(placeId, { at: Date.now(), data });
    return NextResponse.json(data);
  } catch (e) {
    console.error('[place-details] αποτυχία fetch', e);
    // FAIL-OPEN: ίδια λογική με τα υπόλοιπα routes — ποτέ δεν μπλοκάρουμε παραγγελία.
    return NextResponse.json({ lat: null, lon: null, exact: false, streetName: null }, { status: 502 });
  }
}
