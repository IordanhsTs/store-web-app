'use client';

import { useTheme } from 'next-themes';
import { Moon, Sun, LogOut, BarChart3, Store } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import HistoryStatsModal from './HistoryStatsModal';
import { useRouter } from 'next/navigation';

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function Navbar({ storeId, storeName }: { storeId: string; storeName: string }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [isHistoryModalOpen, setHistoryModalOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.refresh();
    router.push('/login');
  };

  const isDark = theme === 'dark';

  return (
    <>
      <nav
        className="sticky top-0 z-50 w-full border-b backdrop-blur-xl backdrop-saturate-150"
        style={{
          backgroundColor: 'var(--nav-bg)',
          borderColor: 'var(--nav-border)',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">

            {/* Brand & Store Name */}
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2.5">
                {/* Logo */}
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-base shadow-sm"
                  style={{
                    background: 'linear-gradient(135deg, var(--accent), var(--accent-hover))',
                    boxShadow: '0 2px 8px var(--accent-muted)',
                  }}
                >
                  V
                </div>
                <span
                  className="font-bold text-xl tracking-widest hidden sm:block"
                  style={{ color: 'var(--text-primary)', letterSpacing: '0.15em' }}
                >
                  VERTEX
                </span>
              </div>

              {/* Divider */}
              <div
                className="h-5 w-px hidden sm:block"
                style={{ backgroundColor: 'var(--border-default)' }}
              />

              {/* Store name */}
              <div
                className="flex items-center gap-1.5 text-sm font-medium hidden sm:flex"
                style={{ color: 'var(--text-secondary)' }}
              >
                <Store className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
                {storeName}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1">
              {/* Stats button */}
              <button
                onClick={() => setHistoryModalOpen(true)}
                className="p-2 rounded-lg transition-all duration-150 group"
                style={{ color: 'var(--text-muted)' }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'var(--accent-muted)';
                  (e.currentTarget as HTMLButtonElement).style.color = 'var(--accent)';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent';
                  (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)';
                }}
                title="Ιστορικό & Στατιστικά"
              >
                <BarChart3 className="w-5 h-5" />
              </button>

              {/* Theme toggle */}
              {mounted && (
                <button
                  onClick={() => setTheme(isDark ? 'light' : 'dark')}
                  className="p-2 rounded-lg transition-all duration-150 relative overflow-hidden"
                  style={{ color: 'var(--text-muted)' }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'var(--accent-muted)';
                    (e.currentTarget as HTMLButtonElement).style.color = 'var(--accent)';
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent';
                    (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)';
                  }}
                  title={isDark ? 'Εναλλαγή σε Light Mode' : 'Εναλλαγή σε Dark Mode'}
                >
                  <div
                    className="transition-all duration-300"
                    style={{
                      transform: isDark ? 'rotate(0deg) scale(1)' : 'rotate(-30deg) scale(0.9)',
                      opacity: isDark ? 1 : 0,
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Sun className="w-5 h-5" />
                  </div>
                  <div
                    className="transition-all duration-300"
                    style={{
                      transform: isDark ? 'rotate(30deg) scale(0.9)' : 'rotate(0deg) scale(1)',
                      opacity: isDark ? 0 : 1,
                    }}
                  >
                    <Moon className="w-5 h-5" />
                  </div>
                </button>
              )}

              {/* Divider */}
              <div
                className="h-5 w-px mx-1"
                style={{ backgroundColor: 'var(--border-default)' }}
              />

              {/* Logout */}
              <button
                onClick={handleLogout}
                className="p-2 rounded-lg transition-all duration-150"
                style={{ color: 'var(--danger)' }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'var(--danger-bg)';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent';
                }}
                title="Αποσύνδεση"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </nav>

      <HistoryStatsModal
        isOpen={isHistoryModalOpen}
        onClose={() => setHistoryModalOpen(false)}
        storeId={storeId}
      />
    </>
  );
}