import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { redirect } from 'next/navigation';
import Navbar from '../Navbar';
import OrderCreationForm from '../OrderCreationForm';
import ActiveOrdersList from '../ActiveOrdersList';
import SystemAlertListener from '../SystemAlertListener';

export default async function DashboardPage() {
  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Αγνοούμε το σφάλμα αν καλείται από Server Component
          }
        },
      },
    }
  );

  // Έλεγχος Authentication
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect('/login');
  }

  // Λήψη δεδομένων καταστήματος
  const { data: store } = await supabase
    .from('stores')
    .select('*')
    .eq('id', user.id)
    .single();

  if (!store) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ backgroundColor: 'var(--bg-primary)' }}
      >
        <div
          className="p-8 rounded-2xl text-center max-w-md"
          style={{
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--border-default)',
            color: 'var(--danger)',
          }}
        >
          <p className="text-lg font-medium">Δεν βρέθηκε κατάστημα για αυτόν τον χρήστη.</p>
        </div>
      </div>
    );
  }

  if (store.is_blocked) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ backgroundColor: 'var(--bg-primary)' }}
      >
        <div
          className="p-8 rounded-2xl text-center max-w-md space-y-4"
          style={{
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--danger-border)',
            color: 'var(--danger)',
          }}
        >
          <h2 className="text-2xl font-bold">Λογαριασμός Μπλοκαρισμένος</h2>
          <p className="text-sm">Η πρόσβαση στο σύστημα έχει διακοπεί από το διαχειριστή.</p>
          <form action="/login">
            <button type="submit" className="px-4 py-2 bg-red-500 text-white rounded-lg mt-4 font-semibold">
              Επιστροφή στην Είσοδο
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)' }}>
      <SystemAlertListener storeId={store.id} />
      <Navbar storeId={store.id} storeName={store.name || 'Άγνωστο Κατάστημα'} />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Order creation panel */}
        <div className="lg:col-span-5 xl:col-span-4 animate-fade-in-up" style={{ animationDelay: '0ms' }}>
          <div className="mb-6 flex items-center justify-between">
            <h1
              className="text-2xl font-bold tracking-tight"
              style={{ color: 'var(--text-primary)' }}
            >
              Νέα Παραγγελία
            </h1>
          </div>
          <OrderCreationForm storeId={store.id} />
        </div>

        {/* Active orders panel */}
        <div className="lg:col-span-7 xl:col-span-8 animate-fade-in-up" style={{ animationDelay: '80ms' }}>
          <div className="mb-6 flex items-center justify-between">
            <h1
              className="text-2xl font-bold tracking-tight"
              style={{ color: 'var(--text-primary)' }}
            >
              Ενεργές Παραγγελίες
            </h1>
          </div>
          <ActiveOrdersList storeId={store.id} />
        </div>
      </main>
    </div>
  );
}