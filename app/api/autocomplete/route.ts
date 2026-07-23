import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { AUTH_COOKIE_NAME } from '../../../lib/backends';
import { getServerBackend } from '../../../lib/supabase-server';

// ── Geoapify autocomplete proxy ──────────────────────────────────────────────
// Το κλειδί ζει ΜΟΝΟ εδώ (server-side) — ο browser δεν το βλέπει ποτέ.
// Προστασίες κατά της υπερκατανάλωσης credits:
//   • server-side cache (ίδια οδός + ίδια εταιρία = 1 κλήση)
//   • ελάχιστοι χαρακτήρες
//   • το debouncing γίνεται στον client (OrderCreationForm)
//
// MULTI-TENANT: τα όρια/bias έρχονται ανά εταιρία από τον companies
// (autocomplete_filter / autocomplete_bias). Fallback στη Φλώρινα όταν δεν υπάρχει
// tenant/companies (backward-compatible με το σημερινό production).
//
// filter = ΣΚΛΗΡΟ φίλτρο: επιστρέφονται ΜΟΝΟ δρόμοι μέσα στο κουτί της πόλης. Χωρίς
// αυτό, ομώνυμοι δρόμοι μεγάλων πόλεων (Θεσ/νίκη, Κοζάνη) "πνίγουν" τη μικρή πόλη.
// bias = proximity στο κέντρο, για τη σειρά των αποτελεσμάτων μέσα στο κουτί.
const DEFAULT_FILTER = 'rect:21.30,40.70,21.50,40.85';
const DEFAULT_BIAS = 'proximity:21.409,40.781';

type Bounds = { filter: string; bias: string };

type Cached = { at: number; data: unknown };
const cache = new Map<string, Cached>();
const TTL_MS = 24 * 60 * 60 * 1000; // 24 ώρες

// Config εταιρίας ανά schema (10' cache) — αποφυγή DB round-trip σε κάθε πλήκτρο.
const boundsCache = new Map<string, { at: number; bounds: Bounds }>();
const BOUNDS_TTL_MS = 10 * 60 * 1000;

// Βρίσκει τα όρια της εταιρίας του χρήστη από το session (tenant claim → companies).
// Επιστρέφει και `key` (schema ή 'default') για να απομονώνεται το result cache ανά εταιρία.
async function resolveBounds(): Promise<{ key: string; bounds: Bounds }> {
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
