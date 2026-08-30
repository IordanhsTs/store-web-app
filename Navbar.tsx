'use client';

import { useTheme } from 'next-themes';
import { Moon, Sun, LogOut, BarChart3, Store, Volume2, VolumeX, Snowflake, Zap, Flame, MessageSquare, Menu, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import HistoryStatsModal from './HistoryStatsModal';
import ContactAdminModal from './ContactAdminModal';
import { useRouter } from 'next/navigation';
import { useSystemLoad } from './useSystemLoad';
import { supabase } from './lib/supabase';

// Το κατάστημα ΔΕΝ μαθαίνει ΠΟΤΕ σε ποιο backend τρέχουμε (απόφαση πελάτη,
// 28/08/2026): ούτε ένδειξη στο Navbar, ούτε μπάρα «εφεδρική λειτουργία». Είναι
// εσωτερική πληροφορία υποδομής και δεν του λέει τίποτα χρήσιμο — από τη στιγμή
// που το εφεδρικό κάνει ό,τι και το κύριο, δεν υπάρχει καν κάτι να προσέξει.
// Η ένδειξη παραμένει μόνο εκεί που έχει νόημα: στο admin, που τη διαχειρίζεται.

// ── System Load Badge ─────────────────────────────────────────────────────────
// Ο πελάτης ζήτησε να φαίνεται ο ΦΟΡΤΟΣ αλλά ΟΧΙ ο αριθμός παραγγελιών — με την
// ίδια κλιμάκωση (5+ / 10+ / 15+). Δείχνουμε λοιπόν μόνο ετικέτα επιπέδου.
function SystemLoadBadge() {
  const { load } = useSystemLoad();

  const config = {
    quiet: {
      Icon: Snowflake,
      label: 'Χαμηλός φόρτος',
      color: 'var(--info)',
      bg: 'var(--info-bg)',
      border: 'var(--info-border)',
    },
    moderate: {
      Icon: Zap,
      label: 'Μέτριος φόρτος',
      color: 'var(--success)',
      bg: 'var(--success-bg)',
      border: 'var(--success-border)',
    },
    busy: {
      Icon: Flame,
      label: 'Υψηλός φόρτος',
      color: 'var(--warning)',
      bg: 'var(--warning-bg)',
      border: 'var(--warning-border)',
    },
    very_busy: {
      Icon: Flame,
      label: 'Πολύ υψηλός φόρτος',
      color: 'var(--danger)',
      bg: 'var(--danger-bg)',
      border: 'var(--danger-border)',
    },
  } as const;

  const { Icon, label, color, bg, border } = config[load];

  return (
    <div
      className="flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-xl text-xs font-bold transition-all duration-500"
      style={{
        backgroundColor: bg,
        border: `1px solid ${border}`,
        color,
        boxShadow: `0 0 10px ${border}`,
      }}
      title={`${label} — φόρτος εργασίας του δικτύου διανομής`}
    >
      <Icon className="w-3.5 h-3.5" />
      {/* Σε στενή οθόνη μένει μόνο το σύμβολο: το λεκτικό έσπρωχνε έξω το όνομα
          του καταστήματος, που είναι η πιο σημαντική πληροφορία της μπάρας. */}
      <span className="hidden sm:inline">{label}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function Navbar({ storeId, storeName }: { storeId: string; storeName: string }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [isHistoryModalOpen, setHistoryModalOpen] = useState(false);
  const [isContactModalOpen, setContactModalOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
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
            <div className="flex items-center gap-2 sm:gap-4 min-w-0">
              <button
                type="button"
                onClick={() => router.refresh()}
                className="flex items-center gap-2.5 cursor-pointer transition-opacity hover:opacity-80 active:opacity-60"
                title="Ανανέωση σελίδας"
              >
                {/* Logo */}
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-base shadow-sm"
                  style={{
                    color: 'var(--on-accent)',
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
              </button>

              {/* Divider */}
              <div
                className="h-5 w-px hidden sm:block"
                style={{ backgroundColor: 'var(--border-default)' }}
              />

              {/* Ποιο κατάστημα είναι συνδεδεμένο — ορατό ΠΑΝΤΑ, και στο κινητό:
                  ο ίδιος υπολογιστής/τηλέφωνο μπορεί να αλλάξει λογαριασμό. */}
              <div
                className="flex items-center gap-1.5 text-sm font-medium min-w-0"
                style={{ color: 'var(--text-secondary)' }}
              >
                <Store className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent)' }} />
                <span className="truncate">{storeName}</span>
              </div>
            </div>

            {/* Center: System Load Badge — in-flow στο κινητό, centered σε sm+ */}
            <div className="static sm:absolute sm:left-1/2 sm:-translate-x-1/2 mx-2 sm:mx-0">
              <SystemLoadBadge />
            </div>

            {/* Actions — desktop: όλα ορατά σε μία γραμμή. Σε στενή οθόνη δεν
                χωράνε 5 κουμπιά δίπλα στο όνομα καταστήματος, γι' αυτό εδώ
                κρύβονται υπέρ του hamburger menu παρακάτω. */}
            <div className="hidden sm:flex items-center gap-1">
              {/* Μήνυμα στον διαχειριστή */}
              <button
                onClick={() => setContactModalOpen(true)}
                className="p-2 rounded-lg transition-all duration-150"
                style={{ color: 'var(--nav-icon)' }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'var(--accent-muted)';
                  (e.currentTarget as HTMLButtonElement).style.color = 'var(--accent)';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent';
                  (e.currentTarget as HTMLButtonElement).style.color = 'var(--nav-icon)';
                }}
                title="Μήνυμα στο κέντρο ελέγχου"
              >
                <MessageSquare className="w-5 h-5" />
              </button>

              {/* Stats button */}
              <button
                onClick={() => setHistoryModalOpen(true)}
                className="p-2 rounded-lg transition-all duration-150 group"
                style={{ color: 'var(--nav-icon)' }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'var(--accent-muted)';
                  (e.currentTarget as HTMLButtonElement).style.color = 'var(--accent)';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent';
                  (e.currentTarget as HTMLButtonElement).style.color = 'var(--nav-icon)';
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
                  style={{ color: 'var(--nav-icon)' }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'var(--accent-muted)';
                    (e.currentTarget as HTMLButtonElement).style.color = 'var(--accent)';
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent';
                    (e.currentTarget as HTMLButtonElement).style.color = 'var(--nav-icon)';
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
                  style={{ color: isSoundEnabled ? 'var(--accent)' : 'var(--nav-icon)' }}
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

            {/* Actions — mobile: ένα κουμπί, όλα τα υπόλοιπα μέσα στο dropdown από κάτω. */}
            <div className="sm:hidden">
              <button
                onClick={() => setMobileMenuOpen(o => !o)}
                className="p-2 rounded-lg transition-all duration-150"
                style={{ color: 'var(--nav-icon)' }}
                aria-label={mobileMenuOpen ? 'Κλείσιμο μενού' : 'Άνοιγμα μενού'}
                aria-expanded={mobileMenuOpen}
              >
                {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile dropdown — λίστα με ετικέτες αντί για γυμνά εικονίδια, μια φορά
            τη φορά κλείνει ξανά μόλις πατηθεί κάτι, ώστε να μη μένει ανοιχτό πάνω
            από τη λίστα παραγγελιών. */}
        {mobileMenuOpen && (
          <div
            className="sm:hidden border-t"
            style={{ backgroundColor: 'var(--nav-bg)', borderColor: 'var(--nav-border)' }}
          >
            <div className="max-w-7xl mx-auto px-4 py-2 flex flex-col">
              <button
                onClick={() => { setContactModalOpen(true); setMobileMenuOpen(false); }}
                className="flex items-center gap-3 px-2 py-3 rounded-lg text-sm font-medium text-left"
                style={{ color: 'var(--text-primary)' }}
              >
                <MessageSquare className="w-5 h-5 shrink-0" style={{ color: 'var(--text-muted)' }} />
                Μήνυμα στο κέντρο ελέγχου
              </button>

              <button
                onClick={() => { setHistoryModalOpen(true); setMobileMenuOpen(false); }}
                className="flex items-center gap-3 px-2 py-3 rounded-lg text-sm font-medium text-left"
                style={{ color: 'var(--text-primary)' }}
              >
                <BarChart3 className="w-5 h-5 shrink-0" style={{ color: 'var(--text-muted)' }} />
                Ιστορικό &amp; Στατιστικά
              </button>

              {mounted && (
                <button
                  onClick={() => { setTheme(isDark ? 'light' : 'dark'); setMobileMenuOpen(false); }}
                  className="flex items-center gap-3 px-2 py-3 rounded-lg text-sm font-medium text-left"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {isDark
                    ? <Sun className="w-5 h-5 shrink-0" style={{ color: 'var(--text-muted)' }} />
                    : <Moon className="w-5 h-5 shrink-0" style={{ color: 'var(--text-muted)' }} />}
                  {isDark ? 'Φωτεινό θέμα' : 'Σκούρο θέμα'}
                </button>
              )}

              {mounted && (
                <button
                  onClick={() => { toggleSound(); setMobileMenuOpen(false); }}
                  className="flex items-center gap-3 px-2 py-3 rounded-lg text-sm font-medium text-left"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {isSoundEnabled
                    ? <Volume2 className="w-5 h-5 shrink-0" style={{ color: 'var(--accent)' }} />
                    : <VolumeX className="w-5 h-5 shrink-0" style={{ color: 'var(--text-muted)' }} />}
                  {isSoundEnabled ? 'Ενεργοί ήχοι ειδοποιήσεων' : 'Ήχοι σε σίγαση'}
                </button>
              )}

              <div className="h-px my-1" style={{ backgroundColor: 'var(--border-default)' }} />

              <button
                onClick={() => { setMobileMenuOpen(false); handleLogout(); }}
                className="flex items-center gap-3 px-2 py-3 rounded-lg text-sm font-medium text-left"
                style={{ color: 'var(--danger)' }}
              >
                <LogOut className="w-5 h-5 shrink-0" />
                Αποσύνδεση
              </button>
            </div>
          </div>
        )}
      </nav>

      <HistoryStatsModal
        isOpen={isHistoryModalOpen}
        onClose={() => setHistoryModalOpen(false)}
        storeId={storeId}
      />

      <ContactAdminModal
        isOpen={isContactModalOpen}
        onClose={() => setContactModalOpen(false)}
        storeId={storeId}
      />
    </>
  );
}
