import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { AUTH_COOKIE_NAME } from './backends';
import { getServerBackend } from './supabase-server';

// ── Κοινά για τα Geoapify route handlers (autocomplete + geocode) ────────────
// Το κλειδί ζει ΜΟΝΟ server-side. Τα όρια/bias έρχονται ανά εταιρία από τον
// companies (autocomplete_filter / autocomplete_bias) με fallback στη Φλώρινα,
// ώστε να μένει backward-compatible όταν δεν υπάρχει tenant claim.
//
// filter = ΣΚΛΗΡΟ φίλτρο: μόνο διευθύνσεις μέσα στο κουτί της πόλης. Χωρίς αυτό,
// ομώνυμοι δρόμοι μεγάλων πόλεων «πνίγουν» τη μικρή πόλη.
// bias = proximity στο κέντρο, για τη σειρά των αποτελεσμάτων.

export const DEFAULT_FILTER = 'rect:21.30,40.70,21.50,40.85';
export const DEFAULT_BIAS = 'proximity:21.409,40.781';

export type Bounds = { filter: string; bias: string };

// Config εταιρίας ανά schema (10' cache) — αποφυγή DB round-trip σε κάθε πλήκτρο.
const boundsCache = new Map<string, { at: number; bounds: Bounds }>();
const BOUNDS_TTL_MS = 10 * 60 * 1000;

/**
 * Βρίσκει τα όρια της εταιρίας του χρήστη από το session (tenant claim → companies).
 * Το `key` (schema ή 'default') απομονώνει τα result caches ανά εταιρία, ώστε να μη
 * διαρρέουν αποτελέσματα μιας πόλης σε άλλη.
 */
export async function resolveBounds(): Promise<{ key: string; bounds: Bounds }> {
  const fallback = { key: 'default', bounds: { filter: DEFAULT_FILTER, bias: DEFAULT_BIAS } };
  try {
    const cookieStore = await cookies();
    const backend = await getServerBackend();
    const supabase = createServerClient(backend.url, backend.anonKey, {
      cookieOptions: { name: AUTH_COOKIE_NAME },
      cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} },
    });

    const { data: { session } } = await supabase.auth.getSession();
    let schema: string | undefined;
    if (session?.access_token) {
      try {
        schema = JSON.parse(
          Buffer.from(session.access_token.split('.')[1], 'base64').toString()
        ).tenant;
      } catch {}
    }
    if (!schema) return fallback;

    const cached = boundsCache.get(schema);
    if (cached && Date.now() - cached.at < BOUNDS_TTL_MS) return { key: schema, bounds: cached.bounds };

    const { data } = await supabase
      .schema('public')
      .from('companies')
      .select('autocomplete_filter, autocomplete_bias')
      .eq('schema_name', schema)
      .maybeSingle();

    const bounds: Bounds = {
      filter: data?.autocomplete_filter || DEFAULT_FILTER,
      bias: data?.autocomplete_bias || DEFAULT_BIAS,
    };
    boundsCache.set(schema, { at: Date.now(), bounds });
    return { key: schema, bounds };
  } catch {
    return fallback;
  }
}
