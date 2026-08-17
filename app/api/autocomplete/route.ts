import { NextRequest, NextResponse } from 'next/server';
import { resolveBounds } from '../../../lib/geoapify';
import { getGoogleApiKey, googleAutocomplete, isPoi } from '../../../lib/google-places';

// ── Google Places Autocomplete (New) proxy ───────────────────────────────────
// Το κλειδί ζει ΜΟΝΟ server-side — ο browser δεν το βλέπει ποτέ.
// Session tokens: ο client στέλνει ?session=<uuid> σταθερό για όλη την
// αναζήτηση — βλ. OrderCreationForm.tsx. Αυτό κάνει τα ενδιάμεσα autocomplete
// requests δωρεάν (χρεώνεται μόνο το τελικό /api/place-details).
//
// Προστασίες κατά της υπερκατανάλωσης:
//   • server-side cache (ίδιο κείμενο + ίδια εταιρία = 1 κλήση στη Google)
//   • ελάχιστοι χαρακτήρες
//   • το debouncing γίνεται στον client (OrderCreationForm)
//
// MULTI-TENANT: τα όρια/bias έρχονται ανά εταιρία (βλ. lib/geoapify).

type Cached = { at: number; data: unknown };
const cache = new Map<string, Cached>();
const TTL_MS = 24 * 60 * 60 * 1000; // 24 ώρες

export async function GET(req: NextRequest) {
  const text = (req.nextUrl.searchParams.get('text') || '').trim();
  const sessionToken = (req.nextUrl.searchParams.get('session') || '').trim();
  if (text.length < 3) {
    return NextResponse.json({ suggestions: [] });
  }

  // MULTI-TENANT: όρια ανά εταιρία· το cache key περιλαμβάνει την εταιρία ώστε να μη
  // διαρρέουν αποτελέσματα μιας πόλης σε άλλη.
  const { key: tenantKey, bounds } = await resolveBounds();
  const key = `${tenantKey}:${text.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) {
    return NextResponse.json(hit.data);
  }

  const apiKey = getGoogleApiKey();
  if (!apiKey) {
    console.error('[autocomplete] Λείπει το GOOGLE_PLACES_API_KEY');
    return NextResponse.json({ suggestions: [] }, { status: 500 });
  }
  if (!sessionToken) {
    console.error('[autocomplete] Λείπει το session token');
    return NextResponse.json({ suggestions: [] }, { status: 400 });
  }

  type Suggestion = {
    street: string;
    context: string;
    placeId: string;
    /** Σημείο ενδιαφέροντος (κατάστημα/υπηρεσία), όχι οδός. */
    isPlace?: boolean;
    /** Η πραγματική οδός ενός isPlace — για εμφάνιση στον διανομέα. */
    streetName?: string;
  };

  try {
    const predictions = await googleAutocomplete(text, bounds, sessionToken, apiKey);

    // context = ό,τι δεν είναι ήδη στο street. Για POI μπαίνει η οδός (secondaryText
    // ξεκινά συνήθως με αυτήν) — ό,τι χρειάζεται ο διανομέας. Καθαρίζουμε την
    // κατάληξη «, Ελλάδα» που δεν προσθέτει τίποτα σε μονοπολιτική εφαρμογή.
    const cleanContext = (s: string) => s.replace(/,?\s*Ελλάδα\s*$/i, '').trim();

    const suggestions: Suggestion[] = predictions.map((p) => {
      const isPlace = isPoi(p.types);
      return {
        street: p.mainText,
        context: cleanContext(p.secondaryText),
        placeId: p.placeId,
        isPlace,
        streetName: isPlace ? cleanContext(p.secondaryText).split(',')[0]?.trim() : undefined,
      };
    });

    const data = { suggestions };
    cache.set(key, { at: Date.now(), data });
    return NextResponse.json(data);
  } catch (e) {
    console.error('[autocomplete] αποτυχία fetch', e);
    return NextResponse.json({ suggestions: [] }, { status: 502 });
  }
}
