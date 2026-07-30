import { NextRequest, NextResponse } from 'next/server';
import { resolveBounds } from '../../../lib/geoapify';

// ── Σημείο ΣΤΟΝ ΑΡΙΘΜΟ της οδού — και πότε να μην το εμπιστεύεσαι ────────────
//
// ΤΟ ΠΡΟΒΛΗΜΑ (μετρήθηκε 30/07/2026 στη Φλώρινα): όταν το Geoapify ΔΕΝ ξέρει
// έναν αριθμό, δεν το λέει. Επιστρέφει `result_type: "building"`, σου γυρνάει
// πίσω τον αριθμό που ζήτησες, και βάζει τις συντεταγμένες ΤΟΥ ΔΡΟΜΟΥ. Η
// απάντηση είναι πανομοιότυπη με μια πραγματική επιτυχία — γι' αυτό το λάθος
// περνούσε απαρατήρητο και κατέληγε σε χρέωση.
//
// Παράδειγμα, Μεγάλου Αλεξάνδρου (μήκος 728μ):
//   αρ. 113 → 40.778535,21.400046  (ΞΕΡΕΙ· 1μ από το πραγματικό κτίριο)
//   αρ. 22  → 40.779270,21.407141  (ΔΕΝ ξέρει· ΑΚΡΙΒΩΣ το σημείο του δρόμου)
//
// Η ΑΝΙΧΝΕΥΣΗ: ρωτάμε και τον σκέτο δρόμο. Αν τα δύο σημεία ταυτίζονται, το
// Geoapify έκανε fallback και ο αριθμός είναι άγνωστος. Αν διαφέρουν, ξέρει
// πραγματικά πού είναι. Στη μέτρηση των 17 αριθμών η διάκριση ήταν απόλυτη:
// είτε 0μ διαφορά (άγνωστος) είτε 465-609μ (γνωστός) — κανένα ενδιάμεσο.
//
// ΚΟΣΤΟΣ: η κλήση του σκέτου δρόμου είναι ΗΔΗ στο cache του /api/autocomplete
// (ο χρήστης μόλις πληκτρολόγησε τον δρόμο), οπότε στην πράξη +1 κλήση ανά
// νέα διεύθυνση, με δικό της cache 24ωρών.

type Cached = { at: number; data: unknown };
const cache = new Map<string, Cached>();
const TTL_MS = 24 * 60 * 60 * 1000;

// Πάνω από τόσα μέτρα θεωρούμε ότι το Geoapify έδωσε ΑΛΛΟ σημείο, άρα ξέρει τον
// αριθμό. Αρκετά μικρό ώστε να πιάνει και κοντινά κτίρια, αρκετά μεγάλο ώστε να
// μην μπερδεύεται με διαφορές στρογγυλοποίησης.
const DISTINCT_M = 15;

function metersBetween(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number }
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

type Point = { lat: number; lon: number } | null;

async function geocode(text: string, bounds: { filter: string; bias: string }, apiKey: string): Promise<Point> {
  const url = new URL('https://api.geoapify.com/v1/geocode/autocomplete');
  url.searchParams.set('text', text);
  url.searchParams.set('apiKey', apiKey);
  url.searchParams.set('filter', bounds.filter);
  url.searchParams.set('bias', bounds.bias);
  url.searchParams.set('lang', 'el');
  url.searchParams.set('limit', '1');

  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) return null;
  const json = await res.json();
  const f = (json.features || [])[0];
  if (!f) return null;
  const p = f.properties || {};
  const lat = typeof p.lat === 'number' ? p.lat : f.geometry?.coordinates?.[1] ?? null;
  const lon = typeof p.lon === 'number' ? p.lon : f.geometry?.coordinates?.[0] ?? null;
  return lat === null || lon === null ? null : { lat, lon };
}

export async function GET(req: NextRequest) {
  const street = (req.nextUrl.searchParams.get('street') || '').trim();
  const number = (req.nextUrl.searchParams.get('number') || '').trim();
  if (street.length < 3 || !number) {
    return NextResponse.json({ lat: null, lon: null, precise: false });
  }

  const { key: tenantKey, bounds } = await resolveBounds();
  const key = `${tenantKey}:${street.toLowerCase()}|${number.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) {
    return NextResponse.json(hit.data);
  }

  const apiKey = process.env.GEOAPIFY_API_KEY;
  if (!apiKey) {
    console.error('[resolve-number] Λείπει το GEOAPIFY_API_KEY');
    return NextResponse.json({ lat: null, lon: null, precise: false }, { status: 500 });
  }

  try {
    // Παράλληλα: ο δρόμος ΜΕ τον αριθμό, και ο δρόμος ΣΚΕΤΟΣ (σημείο αναφοράς).
    const [withNumber, streetOnly] = await Promise.all([
      geocode(`${street} ${number}`, bounds, apiKey),
      geocode(street, bounds, apiKey),
    ]);

    // Χωρίς σημείο αναφοράς δεν μπορούμε να κρίνουμε — μένουμε συντηρητικοί και
    // δηλώνουμε «μη ακριβές», ώστε ο caller να κρατήσει το σημείο του δρόμου.
    if (!withNumber || !streetOnly) {
      const data = { lat: null, lon: null, precise: false };
      return NextResponse.json(data);
    }

    const apart = metersBetween(withNumber, streetOnly);
    const precise = apart > DISTINCT_M;

    const data = precise
      ? { lat: withNumber.lat, lon: withNumber.lon, precise: true }
      : { lat: null, lon: null, precise: false };

    cache.set(key, { at: Date.now(), data });
    return NextResponse.json(data);
  } catch (e) {
    console.error('[resolve-number] αποτυχία fetch', e);
    // FAIL-OPEN, ίδια λογική με τα υπόλοιπα routes: ποτέ δεν μπλοκάρουμε
    // παραγγελία επειδή έπεσε το geocoding.
    return NextResponse.json({ lat: null, lon: null, precise: false }, { status: 502 });
  }
}
