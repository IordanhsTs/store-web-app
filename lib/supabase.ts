'use client';

// Κοινός browser client με αυτόματο failover. Σε μετάβαση κάνουμε reload:
// το session ζει στο cookie (κοινό όνομα στα δύο backends) και όλα τα
// realtime channels ξαναχτίζονται στο νέο backend.

import { createBrowserClient } from '@supabase/ssr';
import {
  AUTH_COOKIE_NAME,
  BACKENDS,
  isHealthy,
  readRemoteConfig,
} from './backends';

const ACTIVE_CACHE_KEY = 'vertex-active-backend';
const TENANT_KEY = 'vertex-tenant';   // MULTI-TENANT: το schema της εταιρίας του χρήστη
const CHECK_INTERVAL_MS = 30000;
const FAILURES_BEFORE_SWITCH = 2;

function savedIndex(): number {
  if (typeof window === 'undefined') return 0;
  try {
    const i = parseInt(localStorage.getItem(ACTIVE_CACHE_KEY) || '0', 10);
    return BACKENDS[i] ? i : 0;
  } catch {
    return 0;
  }
}

// MULTI-TENANT: αν λείπει (σημερινό production χωρίς hook) → undefined → schema 'public'.
function savedTenant(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return localStorage.getItem(TENANT_KEY) || undefined;
  } catch {
    return undefined;
  }
}

const activeIndex = savedIndex();
const active = BACKENDS[activeIndex];
const tenantSchema = savedTenant();

export const supabase = createBrowserClient(active.url, active.anonKey, {
  cookieOptions: { name: AUTH_COOKIE_NAME },
  ...(tenantSchema ? { db: { schema: tenantSchema } } : {}),
});

// Για εμφάνιση κατάστασης συστήματος στο UI (chip Primary/Standby στο Navbar).
export function getActiveBackend() {
  return active;
}

// MULTI-TENANT: το schema στο οποίο ζουν τα δεδομένα του χρήστη. Τα realtime κανάλια
// ΠΡΕΠΕΙ να το χρησιμοποιούν (όχι καρφωτό 'public'), αλλιώς σε co_* tenant τα live
// updates σπάνε σιωπηλά. Fallback 'public' → backward-compatible με το σημερινό setup.
export function getTenantSchema(): string {
  return tenantSchema || 'public';
}

// READ-ONLY-ON-FAILOVER: όταν τρέχουμε στο εφεδρικό (standby), οι εγγραφές πρέπει να
// είναι κλειστές — το standby δέχεται ΜΟΝΟ αναγνώσεις κατά τη βλάβη, ώστε να μην
// αποκλίνουν τα δεδομένα (βλ. failover data-safety). Η μετάβαση κάνει reload, οπότε
// η τιμή είναι σταθερή ανά φόρτωση σελίδας.
export function isReadOnly(): boolean {
  return getActiveBackend()?.name === 'standby';
}

// Διαβάζει το `tenant` claim από το JWT, το αποθηκεύει, και κάνει reload αν άλλαξε
// (ώστε ο client να ξαναστηθεί με το σωστό schema). Ίδιο μοτίβο με το failover reload.
export function applyTenantFromSession(session: { access_token?: string } | null) {
  if (typeof window === 'undefined' || !session?.access_token) return;
  try {
    const b64 = session.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(b64));
    const t = claims.tenant as string | undefined;
    if (t && t !== savedTenant()) {
      localStorage.setItem(TENANT_KEY, t);
      window.location.reload();
    }
  } catch (e) {
    console.error('[tenant] αδυναμία ανάγνωσης claim:', e);
  }
}

if (typeof window !== 'undefined') {
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      try { localStorage.removeItem(TENANT_KEY); } catch {}
      return;
    }
    applyTenantFromSession(session);
  });
}

function switchTo(index: number, reason: string) {
  if (index === activeIndex || !BACKENDS[index]) return;
  console.log(`🔄 [Failover] Μετάβαση στο backend "${BACKENDS[index].name}" (${reason})`);
  try {
    localStorage.setItem(ACTIVE_CACHE_KEY, String(index));
  } catch {}
  window.location.reload();
}

let consecutiveFailures = 0;

async function tick() {
  // 1) Κεντρική εντολή (Cloudflare Worker) — όλοι οι clients συμφωνούν.
  const desired = await readRemoteConfig();
  if (desired) {
    const idx = desired === 'standby' ? 1 : 0;
    if (idx !== activeIndex) switchTo(idx, 'κεντρική εντολή');
    consecutiveFailures = 0;
    return;
  }
  // 2) Fallback: τοπικός έλεγχος υγείας.
  if (await isHealthy(BACKENDS[activeIndex])) {
    consecutiveFailures = 0;
    return;
  }
  consecutiveFailures += 1;
  if (consecutiveFailures >= FAILURES_BEFORE_SWITCH) {
    const other = activeIndex === 0 ? 1 : 0;
    if (BACKENDS[other] && (await isHealthy(BACKENDS[other]))) {
      switchTo(other, 'το ενεργό backend δεν αποκρίνεται');
    }
  }
}

if (typeof window !== 'undefined' && BACKENDS.length > 1) {
  setInterval(tick, CHECK_INTERVAL_MS);
  window.addEventListener('online', tick);
  // Οι browsers περιορίζουν τα setInterval σε ανενεργές καρτέλες· ξανα-ελέγχουμε
  // μόλις η καρτέλα ξαναγίνει ορατή, ώστε μετά από failback να επιστρέψει σωστά.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) tick();
  });
}
