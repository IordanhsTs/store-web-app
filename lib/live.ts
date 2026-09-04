'use client';

// ─── ΖΩΝΤΑΝΗ ΣΥΝΔΕΣΗ ΠΟΥ ΑΥΤΟ-ΕΠΙΔΙΟΡΘΩΝΕΤΑΙ ────────────────────────────────
//
// Το ΠΡΟΒΛΗΜΑ (04/09/2026): σε καρτέλα που μένει ανοιχτή ώρες — δηλαδή σε κάθε
// κατάστημα — το websocket του realtime πεθαίνει σιωπηλά:
//   • ο browser «παγώνει» τα timers των ανενεργών καρτελών, άρα χάνονται τα
//     heartbeats και ο server κλείνει τη σύνδεση,
//   • το JWT λήγει στη μία ώρα και το κανάλι δεν ξαναμπαίνει με ληγμένο token,
//   • ή απλά κόβεται στιγμιαία το δίκτυο / κοιμάται ο υπολογιστής.
// Η σελίδα δείχνει μια χαρά και τα HTTP queries δουλεύουν κανονικά (γι' αυτό η
// αποστολή παραγγελίας πετύχαινε), αλλά κανένα event δεν φτάνει πια — οπότε η
// κάρτα έμενε για πάντα στο «Αναμονή για οδηγό» ακόμα κι όταν ο διανομέας την
// είχε ήδη αποδεχτεί. Το μόνο που το έλυνε ήταν χειροκίνητο F5.
//
// Τρία επίπεδα άμυνας, ανεξάρτητα μεταξύ τους:
//   1. onWake      — μόλις η καρτέλα ξαναγίνει ορατή/ενεργή ή γυρίσει το δίκτυο:
//                    φρεσκάρουμε το session και ελέγχουμε όλα τα κανάλια.
//   2. liveChannel — κάθε κανάλι παρακολουθεί τον εαυτό του και ξαναχτίζεται
//                    μόνο του· σε κάθε επανασύνδεση καλεί onResync (πλήρες
//                    ξαναδιάβασμα, γιατί ό,τι έγινε όσο ήταν πεσμένο ΔΕΝ έρχεται
//                    ποτέ ως event).
//   3. Poll στα δεδομένα (βλ. useActiveOrders) — η τελευταία γραμμή άμυνας: ακόμα
//                    κι αν το realtime έχει πεθάνει τελείως, η λίστα ενημερώνεται.

import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';

// Το focus χτυπά συχνά (κάθε alt-tab)· δεν θέλουμε καταιγίδα από ελέγχους.
const WAKE_THROTTLE_MS = 3000;
// Πόσο περιμένουμε πριν ξαναχτίσουμε ένα κανάλι που έπεσε (ο server μπορεί να
// είναι στιγμιαία απρόσιτος — δεν κερδίζουμε τίποτα με επιθετικό retry).
const REBUILD_DELAY_MS = 4000;
// Περιοδικός έλεγχος υγείας, ανεξάρτητα από events. Σε κρυμμένη καρτέλα ο browser
// τον περιορίζει σε ~1/λεπτό — δεν πειράζει, εκεί δουλεύει το onWake.
const WATCHDOG_MS = 30000;

type Listener = () => void;

const wakeListeners = new Set<Listener>();
let lastWake = 0;
let wired = false;

async function fireWake(force = false) {
  const now = Date.now();
  if (!force && now - lastWake < WAKE_THROTTLE_MS) return;
  lastWake = now;

  // Το JWT μπορεί να έχει λήξει όσο η καρτέλα κοιμόταν. Χωρίς φρέσκο token το
  // realtime απορρίπτεται στο join, οπότε το ανανεώνουμε ΠΡΙΝ ελέγξουμε κανάλια
  // (το getSession κάνει μόνο του refresh όταν το token έχει λήξει).
  try {
    await supabase.auth.getSession();
  } catch {}

  wakeListeners.forEach((fn) => {
    try {
      fn();
    } catch {}
  });
}

function wire() {
  if (wired || typeof window === 'undefined') return;
  wired = true;
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void fireWake();
  });
  window.addEventListener('focus', () => void fireWake());
  window.addEventListener('online', () => void fireWake());
  // Επιστροφή από το bfcache (πίσω/μπροστά στο κινητό): η σελίδα «ξυπνά»
  // ολόκληρη από κατάψυξη, με νεκρά όλα τα sockets.
  window.addEventListener('pageshow', () => void fireWake());
}

/** Δηλώνει κάτι που πρέπει να ξαναελεγχθεί μόλις ξυπνήσει η καρτέλα. */
export function onWake(fn: Listener): () => void {
  wire();
  wakeListeners.add(fn);
  return () => {
    wakeListeners.delete(fn);
  };
}

/** Χειροκίνητο ξύπνημα — το χρησιμοποιεί το κουμπί ανανέωσης στο Navbar. */
export function forceWake() {
  void fireWake(true);
}

export type LiveChannelOptions = {
  /** Όνομα καναλιού (topic). */
  name: string;
  /** Δηλώνει τα `.on(...)`. Καλείται ξανά σε κάθε επαναχτίσιμο του καναλιού. */
  bind: (channel: RealtimeChannel) => RealtimeChannel;
  /** Καλείται σε κάθε επιτυχή (επανα)σύνδεση — εδώ κάνουμε πλήρες refetch. */
  onResync?: () => void;
  /**
   * Αν true (προεπιλογή) προστίθεται μοναδικό suffix στο όνομα, ώστε δύο instances
   * να μη συγκρούονται. ΠΡΟΣΟΧΗ: για broadcast κανάλια πρέπει να είναι false —
   * εκεί το όνομα είναι η διεύθυνση και πρέπει να ταιριάζει με τον αποστολέα.
   */
  unique?: boolean;
};

/**
 * Realtime κανάλι που επιβιώνει από πεσμένο δίκτυο, ληγμένο token και κοιμισμένη
 * καρτέλα. Επιστρέφει τη συνάρτηση καθαρισμού.
 */
export function liveChannel({
  name,
  bind,
  onResync,
  unique = true,
}: LiveChannelOptions): () => void {
  let disposed = false;
  let generation = 0;
  let current: RealtimeChannel | null = null;
  let healthy = false;
  let rebuildTimer: ReturnType<typeof setTimeout> | null = null;

  const clearRebuild = () => {
    if (rebuildTimer) {
      clearTimeout(rebuildTimer);
      rebuildTimer = null;
    }
  };

  const build = async () => {
    if (disposed) return;
    clearRebuild();

    // Ο μετρητής γενιάς ακυρώνει τα callbacks του παλιού καναλιού: το κλείσιμό του
    // πυροδοτεί CLOSED και χωρίς αυτόν θα ζητούσε αμέσως νέο επαναχτίσιμο.
    const gen = ++generation;
    const previous = current;
    current = null;
    healthy = false;

    if (previous) {
      try {
        await supabase.removeChannel(previous);
      } catch {}
      if (disposed || gen !== generation) return;
    }

    const topic = unique
      ? `${name}_${gen}_${Math.random().toString(36).slice(2, 8)}`
      : name;

    current = bind(supabase.channel(topic)).subscribe((status) => {
      if (disposed || gen !== generation) return;
      if (status === 'SUBSCRIBED') {
        healthy = true;
        onResync?.();
      } else {
        // CHANNEL_ERROR / TIMED_OUT / CLOSED
        healthy = false;
        scheduleRebuild();
      }
    });
  };

  const scheduleRebuild = () => {
    if (disposed || rebuildTimer) return;
    rebuildTimer = setTimeout(() => {
      rebuildTimer = null;
      void build();
    }, REBUILD_DELAY_MS);
  };

  /** Υγιές = και το κανάλι μπήκε, και το από κάτω websocket ζει. */
  const check = () => {
    if (disposed) return;
    let socketAlive = true;
    try {
      socketAlive = supabase.realtime.isConnected();
    } catch {}
    if (!healthy || !socketAlive) void build();
  };

  void build();
  const offWake = onWake(check);
  const watchdog = setInterval(check, WATCHDOG_MS);

  return () => {
    disposed = true;
    offWake();
    clearInterval(watchdog);
    clearRebuild();
    if (current) {
      try {
        supabase.removeChannel(current);
      } catch {}
    }
    current = null;
  };
}
