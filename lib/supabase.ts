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

const activeIndex = savedIndex();
const active = BACKENDS[activeIndex];

export const supabase = createBrowserClient(active.url, active.anonKey, {
  cookieOptions: { name: AUTH_COOKIE_NAME },
});

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
