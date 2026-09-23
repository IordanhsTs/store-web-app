import { cookies } from 'next/headers';
import { after } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { AUTH_COOKIE_NAME } from './backends';
import { getServerBackend } from './supabase-server';

// ── Μετρητής χρεώσιμων κλήσεων (βλ. migration 0038_api_usage_counter) ────────
//
// Καλείται ΜΟΝΟ όταν έγινε πραγματική εξερχόμενη κλήση που απάντησε επιτυχώς —
// ποτέ σε cache hit. Η εταιρία δεν περνά ως παράμετρος: η βάση τη βγάζει από το
// `tenant` claim του JWT, γι' αυτό το RPC τρέχει με τη συνεδρία του χρήστη.
//
// Η εγγραφή γίνεται με after(), δηλαδή ΜΕΤΑ την απάντηση: ο χρήστης δεν
// περιμένει τη βάση, και το Vercel δεν προλαβαίνει να παγώσει τη συνάρτηση πριν
// τελειώσει (το απλό `void promise` που χρησιμοποιεί το place-cache μπορεί να
// χαθεί). Fail-open και ΣΙΩΠΗΛΟ: μια αποτυχία μέτρησης δεν πρέπει ποτέ να χαλάσει
// την καταχώρηση παραγγελίας.

export type UsageProvider = 'google_places' | 'geoapify';
export type UsageSku = 'autocomplete' | 'place_details' | 'routing' | 'geocode';

export async function trackUsage(provider: UsageProvider, sku: UsageSku): Promise<void> {
  try {
    // Ο client φτιάχνεται ΕΔΩ, μέσα στο request, γιατί διαβάζει cookies.
    const cookieStore = await cookies();
    const backend = await getServerBackend();
    const supabase = createServerClient(backend.url, backend.anonKey, {
      cookieOptions: { name: AUTH_COOKIE_NAME },
      cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} },
    });

    after(async () => {
      try {
        const { error } = await supabase
          .schema('public')
          .rpc('record_api_usage', { p_provider: provider, p_sku: sku });
        if (error) console.error('[usage] record_api_usage', provider, sku, error.message);
      } catch (e) {
        console.error('[usage] record_api_usage', provider, sku, e);
      }
    });
  } catch (e) {
    console.error('[usage] αποτυχία προετοιμασίας', e);
  }
}
