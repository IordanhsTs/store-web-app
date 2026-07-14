import { NextRequest, NextResponse } from 'next/server';

// ── Geoapify autocomplete proxy ──────────────────────────────────────────────
// Το κλειδί ζει ΜΟΝΟ εδώ (server-side) — ο browser δεν το βλέπει ποτέ.
// Προστασίες κατά της υπερκατανάλωσης credits:
//   • server-side cache (ίδια οδός = 1 κλήση για όλα τα καταστήματα)
//   • ελάχιστοι χαρακτήρες
//   • το debouncing γίνεται στον client (OrderCreationForm)
//
// ΠΡΟΣΟΧΗ (multi-tenant TODO): σταθερά στη Φλώρινα. Στο schema-per-tenant θα
// έρχονται ανά εταιρία από τη βάση (companies.bounds + companies.center).
//
// AREA_FILTER = ΣΚΛΗΡΟ φίλτρο: επιστρέφονται ΜΟΝΟ δρόμοι μέσα στο κουτί της πόλης.
// Χωρίς αυτό, ομώνυμοι δρόμοι μεγάλων πόλεων (Θεσ/νίκη, Κοζάνη) "πνίγουν" τη Φλώρινα.
// AREA_BIAS = proximity στο κέντρο, για τη σειρά των αποτελεσμάτων μέσα στο κουτί.
const AREA_FILTER = 'rect:21.30,40.70,21.50,40.85';
const AREA_BIAS = 'proximity:21.409,40.781';

type Cached = { at: number; data: unknown };
const cache = new Map<string, Cached>();
const TTL_MS = 24 * 60 * 60 * 1000; // 24 ώρες

export async function GET(req: NextRequest) {
  const text = (req.nextUrl.searchParams.get('text') || '').trim();
  if (text.length < 3) {
    return NextResponse.json({ suggestions: [] });
  }

  const key = text.toLowerCase();
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
  url.searchParams.set('filter', AREA_FILTER);
  url.searchParams.set('bias', AREA_BIAS);
  url.searchParams.set('type', 'street');
  url.searchParams.set('lang', 'el');
  url.searchParams.set('limit', '6');

  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      console.error('[autocomplete] Geoapify status', res.status);
      return NextResponse.json({ suggestions: [] }, { status: 502 });
    }
    const json = await res.json();

    const seen = new Set<string>();
    const suggestions = (json.features || [])
      .map((f: { properties?: Record<string, string> }) => {
        const p = f.properties || {};
        const street = p.street || p.name || p.address_line1;
        if (!street) return null;
        // context = πόλη (+ Τ.Κ.) ώστε ο χρήστης να επιβεβαιώνει ΠΟΥ είναι η οδός
        const context = [p.city || p.county || p.district, p.postcode]
          .filter(Boolean)
          .join(' ');
        return { street, context };
      })
      .filter((s: { street: string; context: string } | null): s is { street: string; context: string } => {
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
