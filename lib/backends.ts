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

export async function isHealthy(
  backend: Backend,
  timeoutMs = HEALTH_TIMEOUT_MS
): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(`${backend.url}/auth/v1/health`, {
      headers: { apikey: backend.anonKey },
    }, timeoutMs);
    return res.ok;
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
