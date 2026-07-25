import { NextRequest, NextResponse } from 'next/server';
import { resolveBounds } from '../../../lib/geoapify';

// ── Geoapify geocode proxy (ΜΙΑ διεύθυνση → συντεταγμένες) ───────────────────
// Χρήση: η ΑΦΕΤΗΡΙΑ του καταστήματος. Ο πίνακας stores κρατά μόνο κείμενο
// διεύθυνσης· για να μετρήσουμε απόσταση παραγγελίας χρειαζόμαστε σημείο.
// Καλείται ΜΙΑ φορά ανά κατάστημα (μετά αποθηκεύεται στη βάση), οπότε δεν
// επιβαρύνει το free tier — σε αντίθεση με το autocomplete που τρέχει σε κάθε
// πλήκτρο. Ο ADMIN μπορεί να διορθώσει το σημείο αργότερα από τον χάρτη.

type Cached = { at: number; data: unknown };
const cache = new Map<string, Cached>();
const TTL_MS = 24 * 60 * 60 * 1000; // 24 ώρες

export async function GET(req: NextRequest) {
  const text = (req.nextUrl.searchParams.get('text') || '').trim();
  if (text.length < 3) {
    return NextResponse.json({ lat: null, lon: null });
  }

  const { key: tenantKey, bounds } = await resolveBounds();
  const key = `${tenantKey}:${text.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) {
    return NextResponse.json(hit.data);
  }

  const apiKey = process.env.GEOAPIFY_API_KEY;
  if (!apiKey) {
    console.error('[geocode] Λείπει το GEOAPIFY_API_KEY');
    return NextResponse.json({ lat: null, lon: null }, { status: 500 });
  }

  const url = new URL('https://api.geoapify.com/v1/geocode/search');
  url.searchParams.set('text', text);
  url.searchParams.set('apiKey', apiKey);
  url.searchParams.set('filter', bounds.filter);
  url.searchParams.set('bias', bounds.bias);
  url.searchParams.set('lang', 'el');
  url.searchParams.set('limit', '1');

  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      console.error('[geocode] Geoapify status', res.status);
      return NextResponse.json({ lat: null, lon: null }, { status: 502 });
    }
    const json = await res.json();
    const f = (json.features || [])[0];
    const p = f?.properties || {};
    const lat = typeof p.lat === 'number' ? p.lat : f?.geometry?.coordinates?.[1] ?? null;
    const lon = typeof p.lon === 'number' ? p.lon : f?.geometry?.coordinates?.[0] ?? null;

    const data = { lat, lon };
    // Cache μόνο τα επιτυχή — ώστε μια προσωρινή αποτυχία να μην «κλειδώσει» 24ω.
    if (lat !== null && lon !== null) cache.set(key, { at: Date.now(), data });
    return NextResponse.json(data);
  } catch (e) {
    console.error('[geocode] αποτυχία fetch', e);
    return NextResponse.json({ lat: null, lon: null }, { status: 502 });
  }
}
