'use client';

import { useEffect, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { Bell, CheckCircle2 } from 'lucide-react';

export default function SystemAlertListener({ storeId }: { storeId: string }) {
  const [alertMessage, setAlertMessage] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    // Audio for notification
    const alertSound = new Audio('https://actions.google.com/sounds/v1/alarms/beep_short.ogg');

    const channel = supabase
      .channel('system_alerts')
      .on('broadcast', { event: 'admin_message' }, (payload) => {
        const data = payload.payload;
        if (!data) return;

        // Check if the message is for this store
        if (data.target_type === 'store') {
          if (data.target_id === 'all' || data.target_id === storeId) {
            setAlertMessage(data.message);
            // Play sound
            alertSound.currentTime = 0;
            alertSound.play().catch(e => console.log('Audio play blocked:', e));
          }
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [storeId]);

  if (!alertMessage) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 backdrop-blur-sm bg-black/40 transition-opacity" 
        onClick={() => setAlertMessage(null)}
      />
      
      {/* Modal */}
      <div 
        className="relative w-full max-w-md p-6 rounded-2xl shadow-2xl animate-scale-in"
        style={{
          backgroundColor: 'var(--bg-card)',
          border: '1px solid var(--border-default)',
        }}
      >
        {/* Accent top line */}
        <div 
          className="absolute top-0 left-0 right-0 h-1 rounded-t-2xl"
          style={{ background: 'linear-gradient(90deg, var(--accent), var(--accent-hover))' }}
        />

        <div className="flex items-center gap-4 mb-4">
          <div 
            className="w-12 h-12 rounded-xl flex items-center justify-center shadow-lg"
            style={{ 
              background: 'linear-gradient(135deg, var(--accent), var(--accent-hover))',
              color: 'white'
            }}
          >
            <Bell size={24} />
          </div>
          <div>
            <h3 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
              Νέο Μήνυμα από Κέντρο
            </h3>
            <p className="text-sm font-medium" style={{ color: 'var(--accent)' }}>
              Σύστημα Επικοινωνίας VERTEX
            </p>
          </div>
        </div>

        <div 
          className="p-4 rounded-xl mb-6 text-sm"
          style={{ 
            backgroundColor: 'var(--bg-tertiary)',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border-subtle)',
            whiteSpace: 'pre-wrap'
          }}
        >
          {alertMessage}
        </div>

        <button
          onClick={() => setAlertMessage(null)}
          className="w-full py-3.5 rounded-xl font-bold text-white transition-all flex items-center justify-center gap-2"
          style={{
            background: 'linear-gradient(135deg, var(--accent), var(--accent-hover))',
            boxShadow: '0 4px 16px var(--accent-muted)'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-1px)';
            e.currentTarget.style.boxShadow = '0 8px 24px var(--accent-muted)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 4px 16px var(--accent-muted)';
          }}
        >
          <CheckCircle2 size={18} />
          Το είδα (ΟΚ)
        </button>
      </div>
    </div>
  );
}
