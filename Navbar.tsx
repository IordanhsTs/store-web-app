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

  // Αποφυγή hydration mismatch για το theme
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.refresh();
    router.push('/login');
  };

  return (
    <nav className="sticky top-0 z-50 w-full bg-white dark:bg-[#121212] border-b border-gray-200 dark:border-gray-800 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Brand & Store Name */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-[#C5A066] flex items-center justify-center text-white font-bold text-lg">
                V
              </div>
              <span className="font-bold text-xl tracking-wider text-gray-900 dark:text-white hidden sm:block">
                VERTEX
              </span>
            </div>
            <div className="h-6 w-px bg-gray-300 dark:bg-gray-700 hidden sm:block"></div>
            <div className="flex items-center gap-2 text-gray-600 dark:text-gray-300 font-medium">
              <Store className="w-4 h-4 text-[#C5A066]" />
              {storeName}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 sm:gap-4">
            <button 
              onClick={() => setHistoryModalOpen(true)}
              className="p-2 text-gray-500 hover:text-[#C5A066] dark:text-gray-400 dark:hover:text-[#C5A066] transition-colors rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <BarChart3 className="w-5 h-5" />
            </button>
            
            {mounted && (
              <button
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                className="p-2 text-gray-500 hover:text-[#C5A066] dark:text-gray-400 dark:hover:text-[#C5A066] transition-colors rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
              </button>
            )}

            <button onClick={handleLogout} className="p-2 text-red-500 hover:text-red-600 transition-colors rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 ml-2">
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      <HistoryStatsModal isOpen={isHistoryModalOpen} onClose={() => setHistoryModalOpen(false)} storeId={storeId} />
    </nav>
  );
}