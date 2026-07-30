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
    type Suggestion = {
      street: string;
      context: string;
      lat: number | null;
      lon: number | null;
      /** Σημείο ενδιαφέροντος (κατάστημα/υπηρεσία), όχι οδός. */
      isPlace?: boolean;
      /** Η πραγματική οδός ενός isPlace — για εμφάνιση στον διανομέα. */
      streetName?: string;
    };

    const suggestions = (json.features || [])
      .map((f: Feature): Suggestion | null => {
        const p = f.properties || {};
        const streetName = p.street as string | undefined;
        const placeName = p.name as string | undefined;
        // ΚΑΤΑΣΤΗΜΑΤΑ (αίτημα χρήστη): το Geoapify επιστρέφει ήδη POI — «Coffee
        // Train», «Σκλαβενίτης», «Γενικό Νοσοκομείο» — με result_type amenity και
        // το όνομα στο `name`. Μέχρι τώρα το `p.street || p.name` προτιμούσε την
        // οδό, οπότε το «Coffee Train» εμφανιζόταν ως «7ης Νοεμβρίου» και το όνομα
        // χανόταν. Τώρα το POI κρατά το όνομά του και η οδός πάει στο context.
        // ΜΟΝΟ `amenity` = πραγματικό κατάστημα/υπηρεσία. Με σκέτο «όχι street»
        // περνούσαν και τα ΧΩΡΙΑ (Αρμενοχώρι, Μεσονήσι έρχονται ως locality με
        // name), που θα σημαδεύονταν ως ακριβή σημεία και δεν θα δέχονταν οδό/
        // αριθμό από πάνω — ενώ ένα χωριό είναι ό,τι πιο χονδρικό υπάρχει.
        const isPlace = !!placeName && p.result_type === 'amenity' && placeName !== streetName;
        const label = isPlace ? placeName : streetName || placeName || (p.address_line1 as string | undefined);
        if (!label) return null;

        // ΔΙΟΙΚΗΤΙΚΑ ΠΕΡΙΤΤΑ: σε εφαρμογή μιας πόλης κάθε αποτέλεσμα είναι στην
        // ίδια δημοτική ενότητα και τον ίδιο Τ.Κ., οπότε το «Δημοτική Ενότητα
        // Φλώρινας · 531 00» γράφεται σε ΚΑΘΕ γραμμή χωρίς να ξεχωρίζει τίποτα.
        // Χειρότερα: κάποια όρια του OSM δεν έχουν ελληνικό όνομα, οπότε άλλοτε
        // βγαίνει «Florina Municipal Unit» — αγγλικά μέσα σε ελληνικό dropdown.
        // Κρατάμε μόνο ό,τι ΔΙΑΚΡΙΝΕΙ: τη γειτονιά/χωριό, και για τα POI την οδό.
        // Απορρίπτουμε (α) τη διοικητική ορολογία και (β) ΟΤΙΔΗΠΟΤΕ λατινικό: όταν
        // το OSM δεν έχει ελληνικό όνομα για ένα όριο, το lang=el πέφτει πίσω στο
        // αγγλικό («Florina», «Florina Municipal Unit») — αγγλικά μέσα σε ελληνικό
        // dropdown, και ταυτόχρονα ο λόγος που η ίδια οδός εμφανιζόταν δύο φορές.
        // Τα ελληνικά ονόματα γειτονιών/χωριών (Βαρόσι, Αρμενοχώρι) περνούν.
        const ADMIN_NOISE = /δημοτικ[ήη]\s+εν[όο]τητα|περιφερειακ[ήη]?\s+εν[όο]τητα|municipal|regional unit/i;
        const usable = (v: unknown): v is string =>
          typeof v === 'string' && !!v.trim() && !ADMIN_NOISE.test(v) && !/[a-z]/i.test(v);
        const area = [p.district, p.city, p.county].find(usable);
        // context = πού βρίσκεται· για POI μπαίνει ΠΡΩΤΑ η οδός, που είναι ό,τι
        // χρειάζεται ο διανομέας (και ξεχωρίζει τα υποκαταστήματα).
        const context = [isPlace ? streetName : undefined, area]
          .filter(Boolean)
          .join(' · ');

        // ΣΥΝΤΕΤΑΓΜΕΝΕΣ: το Geoapify τις επιστρέφει ήδη σε κάθε αποτέλεσμα.
        // properties.lat/lon είναι το κανονικό πεδίο· fallback στο GeoJSON
        // geometry, που είναι [lon, lat] (ανάποδα).
        const lat = typeof p.lat === 'number' ? p.lat : f.geometry?.coordinates?.[1] ?? null;
        const lon = typeof p.lon === 'number' ? p.lon : f.geometry?.coordinates?.[0] ?? null;
        return { street: label, context, lat, lon, isPlace, streetName };
      })
      .filter((s: Suggestion | null): s is Suggestion => s !== null);

    // ── DEDUPE ───────────────────────────────────────────────────────────────
    // Το κλειδί ΔΕΝ περιλαμβάνει πια το context. Αιτία: κάποια διοικητικά όρια
    // του OSM δεν έχουν ελληνικό όνομα, οπότε με lang=el το Geoapify γυρνάει για
    // τα ίδια «Δημοτική Ενότητα Φλώρινας» ΚΑΙ «Florina Municipal Unit» — δύο
    // γραφές του ίδιου δήμου, που έκαναν την ίδια οδό να εμφανίζεται δύο φορές
    // (επιβεβαιωμένο στη «Παντελή Παπαθανασίου»).
    // Κλειδί τώρα: όνομα + θέση στα 2 δεκαδικά (~1 χλμ). Ίδιο όνομα στο ίδιο
    // σημείο = ίδιο πράγμα· ομώνυμη οδός σε άλλο χωριό απέχει πολύ περισσότερο
    // και επιβιώνει κανονικά.
    const norm = (s: string) =>
      s.toLowerCase().replace(/ς/g, 'σ').normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
    const hasGreek = (s: string) => /[Ͱ-Ͽ]/.test(s);

    const byKey = new Map<string, Suggestion>();
    for (const s of suggestions as Suggestion[]) {
      const where = s.lat !== null && s.lon !== null
        ? `${s.lat.toFixed(2)},${s.lon.toFixed(2)}`
        : 'no-coords';
      // ΟΧΙ `key` — θα σκίαζε το κλειδί του cache λίγες γραμμές παρακάτω.
      const dedupeKey = `${norm(s.street)}|${where}`;
      const existing = byKey.get(dedupeKey);
      // Σε σύγκρουση κρατάμε την ΕΛΛΗΝΙΚΗ γραφή του context — ο χρήστης δεν
      // πρέπει να βλέπει «Florina Municipal Unit» σε ελληνική εφαρμογή.
      if (!existing || (!hasGreek(existing.context) && hasGreek(s.context))) {
        byKey.set(dedupeKey, s);
      }
    }

    const data = { suggestions: Array.from(byKey.values()) };
    cache.set(key, { at: Date.now(), data });
    return NextResponse.json(data);
  } catch (e) {
    console.error('[autocomplete] αποτυχία fetch', e);
    return NextResponse.json({ suggestions: [] }, { status: 502 });
  }
}
