// ─── FAILOVER: κοινή λίστα backends για browser & server ─────────────────────
// Αν δεν οριστεί NEXT_PUBLIC_SUPABASE_STANDBY_URL, όλα δουλεύουν όπως πριν
// (ένα backend, χωρίς failover).

export type Backend = {
  name: 'primary' | 'standby';
  url: string;
  anonKey: string;
};

const primary: Backend = {
  name: 'primary',
  url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
  anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
};

const standbyUrl = process.env.NEXT_PUBLIC_SUPABASE_STANDBY_URL;

export const BACKENDS: Backend[] = standbyUrl
  ? [
      primary,
      {
        name: 'standby',
        url: standbyUrl,
        anonKey:
          process.env.NEXT_PUBLIC_SUPABASE_STANDBY_ANON_KEY || primary.anonKey,
      },
    ]
  : [primary];

export const CONFIG_URLS = (process.env.NEXT_PUBLIC_FAILOVER_CONFIG_URLS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Σταθερό όνομα cookie και στα δύο backends, ώστε το session του καταστήματος
// να επιβιώνει τη μετάβαση primary <-> standby (κοινό JWT secret).
export const AUTH_COOKIE_NAME = 'vertex-auth';

// ΤΑ 3 ΔΕΥΤΕΡΟΛΕΠΤΑ ΗΤΑΝ ΛΙΓΑ ΓΙΑ ΦΥΛΛΟΜΕΤΡΗΤΗ (05/09/2026): σε κινητό ή ταμπλέτ
// που ξυπνά από ύπνο, το πρώτο αίτημα αργεί κανονικά 3-6 δευτ. Έτσι ένα υγιέστατο
// primary «έπεφτε» και η συσκευή γύριζε μόνη της στο εφεδρικό. Ο server (Vercel)
// κρατά τα σφιχτά 3 δευτ. — εκεί το δίκτυο δεν κοιμάται και η καθυστέρηση μετράει.
export const SERVER_TIMEOUT_MS = 3000;
export const HEALTH_TIMEOUT_MS = 6000;
export const CONFIG_TIMEOUT_MS = 8000;

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = HEALTH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal, cache: 'no-store' }).finally(
    () => clearTimeout(timer)
  );
}

// ── Τι σημαίνει «υγιές» ──────────────────────────────────────────────────────
// ΠΡΙΝ ρωτούσαμε το `/auth/v1/health`. Αυτό απαντάει ΜΟΝΟ για το GoTrue: δεν
// αγγίζει ούτε το PostgREST ούτε την Postgres. Δηλαδή στην πιο συνηθισμένη
// πραγματική βλάβη — πεσμένη ή κορεσμένη βάση — το check γύριζε καθαρό, το
// failover δεν ενεργοποιούνταν ΠΟΤΕ, και η εφαρμογή ήταν εντελώς νεκρή για τον
// χρήστη ενώ ο πίνακας ελέγχου έδειχνε πράσινο.
//
// ΤΩΡΑ χτυπάμε το PostgREST, που για να απαντήσει ΟΤΙΔΗΠΟΤΕ πρέπει να έχει
// ζωντανή σύνδεση στη βάση (κάνει introspection του schema).
//
// Γιατί `status < 500` και όχι `res.ok`:
//   • 200 → το vertex_health() (migration 0031) εκτελέστηκε, όλα καλά
//   • 404 → η function δεν υπάρχει ακόμα σε ΑΥΤΟ το backend (πριν εφαρμοστεί το
//     0031, ή στο standby). Το PostgREST όμως ΞΕΡΕΙ ότι δεν υπάρχει — άρα
//     διάβασε το schema, άρα η βάση απαντάει. Υγιές.
//   • 401/403 → ίδιο σκεπτικό: απάντησε το PostgREST, όχι το κενό.
//   • 5xx → το PostgREST δεν φτάνει στη βάση. ΑΥΤΟ θέλαμε να πιάσουμε.
//   • timeout/throw → πεσμένο ή άφταστο.
//
// Έτσι δουλεύει σωστά και ΠΡΙΝ και ΜΕΤΑ την εφαρμογή του migration, χωρίς
// συντονισμένο deploy.
export async function isHealthy(
  backend: Backend,
  timeoutMs = HEALTH_TIMEOUT_MS
): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(`${backend.url}/rest/v1/rpc/vertex_health`, {
      method: 'POST',
      headers: {
        apikey: backend.anonKey,
        Authorization: `Bearer ${backend.anonKey}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    }, timeoutMs);
    return res.status < 500;
  } catch {
    return false;
  }
}

export async function readRemoteConfig(
  timeoutMs = CONFIG_TIMEOUT_MS
): Promise<'primary' | 'standby' | null> {
  for (const base of CONFIG_URLS) {
    try {
      const sep = base.includes('?') ? '&' : '?';
      const res = await fetchWithTimeout(`${base}${sep}t=${Date.now()}`, {}, timeoutMs);
      if (res.ok) {
        const cfg = await res.json();
        if (cfg && (cfg.active === 'primary' || cfg.active === 'standby')) {
          return cfg.active;
        }
      }
    } catch {}
  }
  return null;
}
