'use client';

import { useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { Mail, Lock, LogIn, AlertCircle } from 'lucide-react';

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');


  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError(
        error.message === 'Invalid login credentials'
          ? 'Λάθος email ή κωδικός πρόσβασης'
          : error.message
      );
      setLoading(false);
    } else {
      window.location.replace('/');
    }
  };

  return (
    <form onSubmit={handleLogin} className="space-y-5">
      {/* Error message */}
      {error && (
        <div
          className="flex items-start gap-2.5 p-3.5 rounded-xl text-sm animate-fade-in"
          style={{
            backgroundColor: 'var(--danger-bg)',
            border: '1px solid var(--danger-border)',
            color: 'var(--danger)',
          }}
        >
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {/* Email field */}
      <div className="space-y-1.5">
        <label
          className="block text-sm font-medium"
          style={{ color: 'var(--text-secondary)' }}
        >
          Email Καταστήματος
        </label>
        <div className="relative">
          <Mail
            className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ color: 'var(--text-muted)' }}
          />
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="store@vertex.com"
            className="w-full pl-10 pr-4 py-3 rounded-xl text-sm transition-all duration-150"
            style={{
              backgroundColor: 'var(--bg-input)',
              border: '1.5px solid var(--border-default)',
              color: 'var(--text-primary)',
              outline: 'none',
            }}
            onFocus={e => {
              e.target.style.borderColor = 'var(--accent)';
              e.target.style.boxShadow = '0 0 0 3px var(--accent-muted)';
            }}
            onBlur={e => {
              e.target.style.borderColor = 'var(--border-default)';
              e.target.style.boxShadow = 'none';
            }}
          />
        </div>
      </div>

      {/* Password field */}
      <div className="space-y-1.5">
        <label
          className="block text-sm font-medium"
          style={{ color: 'var(--text-secondary)' }}
        >
          Κωδικός Πρόσβασης
        </label>
        <div className="relative">
          <Lock
            className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ color: 'var(--text-muted)' }}
          />
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="w-full pl-10 pr-4 py-3 rounded-xl text-sm transition-all duration-150"
            style={{
              backgroundColor: 'var(--bg-input)',
              border: '1.5px solid var(--border-default)',
              color: 'var(--text-primary)',
              outline: 'none',
            }}
            onFocus={e => {
              e.target.style.borderColor = 'var(--accent)';
              e.target.style.boxShadow = '0 0 0 3px var(--accent-muted)';
            }}
            onBlur={e => {
              e.target.style.borderColor = 'var(--border-default)';
              e.target.style.boxShadow = 'none';
            }}
          />
        </div>
      </div>

      {/* Submit button */}
      <button
        type="submit"
        disabled={loading}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold text-white transition-all duration-150 mt-2"
        style={{
          background: loading
            ? 'var(--accent-hover)'
            : 'linear-gradient(135deg, var(--accent), var(--accent-hover))',
          boxShadow: loading ? 'none' : '0 4px 16px var(--accent-muted)',
          opacity: loading ? 0.7 : 1,
          cursor: loading ? 'not-allowed' : 'pointer',
        }}
        onMouseEnter={e => {
          if (!loading) {
            (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)';
            (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 8px 24px var(--accent-muted)';
          }
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)';
          (e.currentTarget as HTMLButtonElement).style.boxShadow = loading ? 'none' : '0 4px 16px var(--accent-muted)';
        }}
      >
        {loading ? (
          <>
            <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
            Σύνδεση...
          </>
        ) : (
          <>
            <LogIn className="w-4 h-4" />
            Είσοδος
          </>
        )}
      </button>
    </form>
  );
}