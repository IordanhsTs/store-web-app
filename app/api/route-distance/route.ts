import { NextRequest, NextResponse } from 'next/server';
import { haversineKm, MAX_DISTANCE_KM } from '../../../lib/distance';

// ── Geoapify Routing proxy — ΠΡΑΓΜΑΤΙΚΗ οδική απόσταση κατάστημα → διεύθυνση ──
// Το κλειδί ζει ΜΟΝΟ server-side, όπως στα /api/autocomplete και /api/geocode.
//
// ΓΙΑΤΙ: η ευθεία (haversine) υποτιμά συστηματικά την απόσταση — μέσω δρόμων,
// μονόδρομων και ποταμών/σιδηροδρόμων η διαδρομή είναι πάντα μεγαλύτερη.
//
// ΚΟΣΤΟΣ: 1 credit ανά κλήση (free tier 3.000/ημέρα), σε αντίθεση με το haversine
// που είναι δωρεάν. Γι' αυτό υπάρχουν ΤΡΕΙΣ φραγμοί:
//   • ο client καλεί μόνο όταν «κλειδώσει» η διεύθυνση (debounce), όχι σε κάθε πλήκτρο
//   • cache 24ωρών σε συντεταγμένες στρογγυλεμένες στα 4 δεκαδικά (~11 μέτρα),
//     οπότε η ίδια διεύθυνση δεύτερη φορά κοστίζει 0
//   • αν η ΕΥΘΕΙΑ ξεπερνά ήδη το όριο δεν ξοδεύουμε credit: η οδική διαδρομή είναι
//     πάντα ≥ της ευθείας, άρα η παραγγελία μπλοκάρεται έτσι κι αλλιώς
//
// FAIL-OPEN: σε κάθε αποτυχία γυρνάμε km: null και ο client κρατά την ευθεία.
// Μια πεσμένη υπηρεσία routing ΔΕΝ σταματά παραγγελίες — ίδια λογική με το
// useStoreOrigin και με το «καλύτερα αχρέωτη παραγγελία από μπλοκαρισμένο μαγαζί».

type Cached = { at: number; data: unknown };
const cache = new Map<string, Cached>();
const TTL_MS = 24 * 60 * 60 * 1000; // 24 ώρες

// Μοτοποδήλατο: σέβεται τους μονόδρομους αλλά όχι τους περιορισμούς αυτοκινήτου —
// ό,τι κάνει και ο διανομέας. Παρακάμπτεται με GEOAPIFY_ROUTE_MODE ('drive',
// 'motorcycle', 'bicycle', …) χωρίς αλλαγή κώδικα.
const MODE = process.env.GEOAPIFY_ROUTE_MODE || 'scooter';

function parsePoint(raw: string | null): { lat: number; lon: number } | null {
  const [lat, lon] = (raw || '').split(',').map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

// 4 δεκαδικά ≈ πλέγμα 11 μέτρων: αρκετά χονδρό ώστε να «κουμπώνουν» οι
// επαναλαμβανόμενες διευθύνσεις στο cache, αρκετά λεπτό ώστε να μην αλλοιώνει χρέωση.
const round4 = (n: number) => n.toFixed(4);

export async function GET(req: NextRequest) {
  const from = parsePoint(req.nextUrl.searchParams.get('from'));
  const to = parsePoint(req.nextUrl.searchParams.get('to'));
  if (!from || !to) {
    return NextResponse.json({ km: null, minutes: null }, { status: 400 });
  }

  // Δωρεάν φραγμός πριν ξοδέψουμε credit (βλ. σχόλιο κεφαλίδας).
  if (haversineKm(from.lat, from.lon, to.lat, to.lon) > MAX_DISTANCE_KM) {
    return NextResponse.json({ km: null, minutes: null, skipped: 'too_far' });
  }

  const key = `${round4(from.lat)},${round4(from.lon)}|${round4(to.lat)},${round4(to.lon)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) {
    return NextResponse.json(hit.data);
  }

  const apiKey = process.env.GEOAPIFY_API_KEY;
  if (!apiKey) {
    console.error('[route-distance] Λείπει το GEOAPIFY_API_KEY');
    return NextResponse.json({ km: null, minutes: null }, { status: 500 });
  }

  const url = new URL('https://api.geoapify.com/v1/routing');
  url.searchParams.set('waypoints', `${from.lat},${from.lon}|${to.lat},${to.lon}`);
  url.searchParams.set('mode', MODE);
  url.searchParams.set('units', 'metric'); // → properties.distance σε ΜΕΤΡΑ
  // type=short: βελτιστοποίηση με βάση την απόσταση, όχι το default 'balanced'
  // (χρόνος+κόστος+απόσταση) — έτσι η χρέωση βασίζεται πάντα στη συντομότερη
  // διαδρομή αντί σε έναν πιθανά μεγαλύτερο "καλύτερο" δρόμο.
  url.searchParams.set('type', 'short');
  url.searchParams.set('apiKey', apiKey);

  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      console.error('[route-distance] Geoapify status', res.status);
      return NextResponse.json({ km: null, minutes: null }, { status: 502 });
    }
    const json = await res.json();
    const props = json?.features?.[0]?.properties;
    const meters = props?.distance;
    const seconds = props?.time;

    // Χωρίς διαδρομή (π.χ. πινέζα σε χωράφι, εκτός οδικού δικτύου) — ο client
    // κρατά την ευθεία αντί να μείνει η φόρμα χωρίς απόσταση.
    if (typeof meters !== 'number') {
      return NextResponse.json({ km: null, minutes: null });
    }

    const data = {
      km: Math.round(meters) / 1000, // ακρίβεια μέτρου — ταιριάζει με numeric(6,3)
      minutes: typeof seconds === 'number' ? Math.round(seconds / 60) : null,
    };
    // Cache μόνο τα επιτυχή, ώστε μια προσωρινή αποτυχία να μην «κλειδώσει» 24ω.
    cache.set(key, { at: Date.now(), data });
    return NextResponse.json(data);
  } catch (e) {
    console.error('[route-distance] αποτυχία fetch', e);
    return NextResponse.json({ km: null, minutes: null }, { status: 502 });
  }
}
