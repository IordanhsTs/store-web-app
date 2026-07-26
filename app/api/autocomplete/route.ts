import { NextRequest, NextResponse } from 'next/server';
import { resolveBounds } from '../../../lib/geoapify';

// ── Geoapify autocomplete proxy ──────────────────────────────────────────────
// Το κλειδί ζει ΜΟΝΟ server-side — ο browser δεν το βλέπει ποτέ.
// Προστασίες κατά της υπερκατανάλωσης credits:
//   • server-side cache (ίδια οδός + ίδια εταιρία = 1 κλήση)
//   • ελάχιστοι χαρακτήρες
//   • το debouncing γίνεται στον client (OrderCreationForm)
//
// MULTI-TENANT: τα όρια/bias έρχονται ανά εταιρία (βλ. lib/geoapify).

type Cached = { at: number; data: unknown };
const cache = new Map<string, Cached>();
const TTL_MS = 24 * 60 * 60 * 1000; // 24 ώρες

export async function GET(req: NextRequest) {
  const text = (req.nextUrl.searchParams.get('text') || '').trim();
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

  const apiKey = process.env.GEOAPIFY_API_KEY;
  if (!apiKey) {
    console.error('[autocomplete] Λείπει το GEOAPIFY_API_KEY');
    return NextResponse.json({ suggestions: [] }, { status: 500 });
  }

  const url = new URL('https://api.geoapify.com/v1/geocode/autocomplete');
  url.searchParams.set('text', text);
  url.searchParams.set('apiKey', apiKey);
  url.searchParams.set('filter', bounds.filter);
  url.searchParams.set('bias', bounds.bias);
  // ΧΩΡΙΣ 'type' filter: μικρά χωριά (π.χ. Αρμενοχώρι, Μεσονήσι) δεν έχουν
  // καταχωρημένες οδούς στο Geoapify, μόνο το ίδιο το χωριό ως locality.
  // Με type=street αυτά αποκλείονταν εντελώς. Το tight bounding box (filter)
  // παραμένει η προστασία από αποτελέσματα εκτός περιοχής.
  url.searchParams.set('lang', 'el');
  url.searchParams.set('limit', '6');

  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      console.error('[autocomplete] Geoapify status', res.status);
      return NextResponse.json({ suggestions: [] }, { status: 502 });
    }
    const json = await res.json();

    type Feature = {
      properties?: Record<string, string | number | undefined>;
      geometry?: { coordinates?: number[] };
    };
    type Suggestion = { street: string; context: string; lat: number | null; lon: number | null };

    const seen = new Set<string>();
    const suggestions = (json.features || [])
      .map((f: Feature): Suggestion | null => {
        const p = f.properties || {};
        const street = (p.street || p.name || p.address_line1) as string | undefined;
        if (!street) return null;
        // context = πόλη (+ Τ.Κ.) ώστε ο χρήστης να επιβεβαιώνει ΠΟΥ είναι η οδός
        const context = [p.city || p.county || p.district, p.postcode]
          .filter(Boolean)
          .join(' ');
        // ΣΥΝΤΕΤΑΓΜΕΝΕΣ: το Geoapify τις επιστρέφει ήδη σε κάθε αποτέλεσμα και μέχρι
        // τώρα τις ΠΕΤΑΓΑΜΕ. Είναι η αφετηρία για απόσταση/χρέωση/όριο 15χλμ χωρίς
        // ούτε ένα επιπλέον API call. properties.lat/lon είναι το κανονικό πεδίο·
        // fallback στο GeoJSON geometry, που είναι [lon, lat] (ανάποδα).
        const lat = typeof p.lat === 'number' ? p.lat : f.geometry?.coordinates?.[1] ?? null;
        const lon = typeof p.lon === 'number' ? p.lon : f.geometry?.coordinates?.[0] ?? null;
        return { street, context, lat, lon };
      })
      .filter((s: Suggestion | null): s is Suggestion => {
        if (!s) return false;
        const dedupeKey = `${s.street}|${s.context}`;
        if (seen.has(dedupeKey)) return false;
        seen.add(dedupeKey);
        return true;
      });

    const data = { suggestions };
    cache.set(key, { at: Date.now(), data });
    return NextResponse.json(data);
  } catch (e) {
    console.error('[autocomplete] αποτυχία fetch', e);
    return NextResponse.json({ suggestions: [] }, { status: 502 });
  }
}
