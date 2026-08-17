import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { AUTH_COOKIE_NAME } from './backends';
import { getServerBackend } from './supabase-server';

// ── Μόνιμο cache σημείων της Google (βλ. migration 0026_place_cache) ─────────
//
// ΓΙΑΤΙ: το cache σε μνήμη (Map) του route ζει όσο και το serverless instance
// του Vercel — δηλαδή ελάχιστα. Χωρίς μόνιμο cache ξαναπληρώναμε συνεχώς τα ίδια
// σημεία. Ο πίνακας είναι ΚΟΙΝΟΣ για όλες τις εταιρίες: το place_id → σημείο
// είναι δημόσιο δεδομένο της Google, ίδιο για όλους, χωρίς προσωπικά στοιχεία.
//
// ⚠ ΟΡΟΙ GOOGLE: οι συντεταγμένες επιτρέπεται να κρατηθούν έως 30 ΗΜΕΡΕΣ (τα
// place_id επ' αόριστον). Το TTL εδώ ΔΕΝ είναι ρύθμιση επίδοσης — μην το αυξήσεις.
const TTL_DAYS = 30;

// Κάθε τόσο σβήνουμε τα ληγμένα, ώστε να μη χρειάζεται pg_cron. Δεν τρέχει σε
// κάθε γραφή γιατί δεν υπάρχει λόγος — τα ληγμένα ούτως ή άλλως αγνοούνται.
const PURGE_PROBABILITY = 0.02;

export type CachedPlace = {
  lat: number;
  lon: number;
  exact: boolean;
  streetName: string | null;
};

async function client() {
  const cookieStore = await cookies();
  const backend = await getServerBackend();
  return createServerClient(backend.url, backend.anonKey, {
    cookieOptions: { name: AUTH_COOKIE_NAME },
    cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} },
  });
}

/**
 * Διαβάζει σημείο από το μόνιμο cache. Fail-open: οποιοδήποτε πρόβλημα (χωρίς
 * συνεδρία, πεσμένη βάση, standby) γυρνάει null και ο caller ρωτά τη Google.
 */
export async function readCachedPlace(placeId: string): Promise<CachedPlace | null> {
  try {
    const supabase = await client();
    const cutoff = new Date(Date.now() - TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase
      .schema('public')
      .from('place_cache')
      .select('latitude, longitude, exact, street_name')
      .eq('place_id', placeId)
      .gt('cached_at', cutoff)
      .maybeSingle();

    if (!data) return null;
    return {
      lat: data.latitude as number,
      lon: data.longitude as number,
      exact: !!data.exact,
      streetName: (data.street_name as string | null) ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Γράφει σημείο στο μόνιμο cache. Fail-open και ΣΙΩΠΗΛΟ: σε failover η βάση
 * είναι read-only, και μια αποτυχία εγγραφής cache δεν πρέπει ποτέ να χαλάσει
 * την καταχώρηση παραγγελίας.
 */
export async function writeCachedPlace(placeId: string, place: CachedPlace): Promise<void> {
  try {
    const supabase = await client();
    await supabase
      .schema('public')
      .from('place_cache')
      .upsert(
        {
          place_id: placeId,
          latitude: place.lat,
          longitude: place.lon,
          exact: place.exact,
          street_name: place.streetName,
          cached_at: new Date().toISOString(),
        },
        { onConflict: 'place_id' }
      );

    if (Math.random() < PURGE_PROBABILITY) {
      await supabase.schema('public').rpc('purge_expired_places');
    }
  } catch {
    // σιωπηλά — το cache είναι βελτιστοποίηση, ποτέ προϋπόθεση
  }
}
