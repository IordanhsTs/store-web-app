'use client';

import { useTheme } from 'next-themes';
import { Moon, Sun, LogOut, BarChart3, Store, Volume2, VolumeX, Snowflake, Zap, Flame } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import HistoryStatsModal from './HistoryStatsModal';
import { useRouter } from 'next/navigation';
import { useSystemLoad } from './useSystemLoad';

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// ── System Load Badge ─────────────────────────────────────────────────────────
function SystemLoadBadge() {
  const { activeCount, load } = useSystemLoad();

  const config = {
    quiet: {
      Icon: Snowflake,
      label: 'Χαμηλός Φόρτος',
      color: '#60A5FA',
      bg: 'rgba(96,165,250,0.12)',
      border: 'rgba(96,165,250,0.35)',
      glow: 'rgba(96,165,250,0.25)',
    },
    moderate: {
      Icon: Zap,
      label: 'Μέτριος Φόρτος',
      color: '#FBBF24',
      bg: 'rgba(251,191,36,0.12)',
      border: 'rgba(251,191,36,0.35)',
      glow: 'rgba(251,191,36,0.25)',
    },
    busy: {
      Icon: Flame,
      label: 'Υψυλός Φόρτος',
      color: '#F87171',
      bg: 'rgba(248,113,113,0.12)',
      border: 'rgba(248,113,113,0.35)',
      glow: 'rgba(248,113,113,0.25)',
    },
  } as const;

  const { Icon, label, color, bg, border, glow } = config[load];

  return (
    <div
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all duration-500"
      style={{
        backgroundColor: bg,
        border: `1px solid ${border}`,
        color,
        boxShadow: `0 0 10px ${glow}`,
      }}
      title={`Ενεργές παραγγελίες δικτύου: ${activeCount}`}
    >
      <Icon className="w-3.5 h-3.5" />
      <span className="hidden sm:inline">{label}</span>
      <span className="font-black tabular-nums" style={{ color }}>
        {activeCount}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function Navbar({ storeId, storeName }: { storeId: string; storeName: string }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [isHistoryModalOpen, setHistoryModalOpen] = useState(false);
  const router = useRouter();

  const [isSoundEnabled, setIsSoundEnabled] = useState(true);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    const savedSound = localStorage.getItem('soundEnabled');
    if (savedSound !== null) {
      setIsSoundEnabled(savedSound === 'true');
    }
  }, []);

  const toggleSound = () => {
    const newState = !isSoundEnabled;
    setIsSoundEnabled(newState);
    localStorage.setItem('soundEnabled', newState.toString());

    if (newState) {
      try {
        const audio = new Audio('/notification.mp3');
        audio.volume = 0.1;
        audio.play().catch(() => {});
      } catch (e) {}
    }
  };

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

            {/* Center: System Load Badge */}
            <div className="absolute left-1/2 -translate-x-1/2">
              <SystemLoadBadge />
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

              {/* Sound toggle */}
              {mounted && (
                <button
                  onClick={toggleSound}
                  className="p-2 rounded-lg transition-all duration-150"
                  style={{ color: isSoundEnabled ? 'var(--accent)' : 'var(--text-muted)' }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'var(--accent-muted)';
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent';
                  }}
                  title={isSoundEnabled ? 'Σίγαση ειδοποιήσεων' : 'Ενεργοποίηση ήχων'}
                >
                  {isSoundEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
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
