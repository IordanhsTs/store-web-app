'use client';

import { useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';
import { Mail, Lock, LogIn } from 'lucide-react';

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message === 'Invalid login credentials' ? 'Λάθος email ή κωδικός πρόσβασης' : error.message);
      setLoading(false);
    } else {
      // Χρησιμοποιούμε window.location.replace για να αναγκάσουμε τον browser
      // να κάνει πλήρες reload της σελίδας, διασφαλίζοντας ότι τα cookies 
      // θα σταλούν σωστά στον Server Component (app/page.tsx).
      // Αυτό λύνει το πρόβλημα των "κολλημένων" redirects σε mobile browsers.
      window.location.replace('/');
    }
  };

  return (
    <form onSubmit={handleLogin} className="space-y-5">
      {error && (
        <div className="bg-red-50 text-red-500 dark:bg-red-900/20 dark:text-red-400 p-3 rounded-lg text-sm text-center">
          {error}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email Καταστήματος</label>
        <div className="relative">
          <Mail className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full pl-10 pr-4 py-2.5 bg-gray-50 dark:bg-[#121212] border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C5A066] dark:text-white transition-all" placeholder="store@vertex.com" />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Κωδικός Πρόσβασης</label>
        <div className="relative">
          <Lock className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="w-full pl-10 pr-4 py-2.5 bg-gray-50 dark:bg-[#121212] border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C5A066] dark:text-white transition-all" placeholder="••••••••" />
        </div>
      </div>

      <button type="submit" disabled={loading} className="w-full flex items-center justify-center gap-2 bg-[#C5A066] hover:bg-[#b08d55] text-white font-medium py-2.5 rounded-lg transition-colors disabled:opacity-50 mt-2">
        <LogIn className="w-5 h-5" />
        {loading ? 'Σύνδεση...' : 'Είσοδος'}
      </button>
    </form>
  );
}