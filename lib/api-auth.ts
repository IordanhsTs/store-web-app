// ════════════════════════════════════════════════════════════════════════════
// Φύλακας για τα /api/* routes.
//
// ΓΙΑΤΙ ΥΠΑΡΧΕΙ: τα τέσσερα routes (autocomplete, geocode, place-details,
// route-distance) είναι proxies προς ΠΛΗΡΩΜΕΝΑ APIs (Google Places, Geoapify)
// και κουβαλάνε τα κλειδιά μας από το env. Μέχρι τώρα δεν ζητούσαν τίποτα:
// όποιος έβρισκε το deployed URL είχε δωρεάν geocoding με δικό μας λογαριασμό,
// χωρίς όριο. Δεν είναι θεωρητικό — το ACCOUNTS.md καταγράφει ήδη ένα Google
// Cloud project που έκλεισε η Google για λόγους χρέωσης.
//
// ΤΙ ΚΑΝΕΙ: διαβάζει το session από το cookie (ίδιο μοτίβο με το proxy.ts) και
// απορρίπτει όποιον δεν είναι συνδεδεμένος. Δεν κοιτάει ρόλο — τα routes δεν
// αγγίζουν δεδομένα εταιρίας, μόνο εξωτερικά APIs· αρκεί να είναι κάποιος
// πραγματικός χρήστης.
// ════════════════════════════════════════════════════════════════════════════

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { AUTH_COOKIE_NAME } from './backends';
import { getServerBackend } from './supabase-server';

export type Guard = { ok: true; userId: string } | { ok: false; response: NextResponse };

export async function requireUser(): Promise<Guard> {
  try {
    const backend = await getServerBackend();
    const cookieStore = await cookies();

    const supabase = createServerClient(backend.url, backend.anonKey, {
      cookieOptions: { name: AUTH_COOKIE_NAME },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        // Route handler: δεν ανανεώνουμε cookies από εδώ — αυτό είναι δουλειά
        // του proxy.ts, που τρέχει ούτως ή άλλως πριν από κάθε request.
        setAll() {},
      },
    });

    const { data, error } = await supabase.auth.getUser();

    if (error || !data?.user) {
      return {
        ok: false,
        response: NextResponse.json({ error: 'unauthorized' }, { status: 401 }),
      };
    }

    return { ok: true, userId: data.user.id };
  } catch (e) {
    // Αν σπάσει ο έλεγχος (π.χ. δεν αποκρίνεται κανένα backend) ΔΕΝ ανοίγουμε
    // την πόρτα: το κόστος ενός αποτυχημένου autocomplete είναι μια πρόταση
    // διεύθυνσης που δεν ήρθε· το κόστος του αντίθετου είναι ο λογαριασμός μας.
    console.error('[api-auth] αποτυχία ελέγχου session:', e);
    return {
      ok: false,
      response: NextResponse.json({ error: 'unauthorized' }, { status: 401 }),
    };
  }
}
