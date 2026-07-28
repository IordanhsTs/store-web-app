'use client';

import { useState } from 'react';
import { Send, X, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import { supabase, isReadOnly } from './lib/supabase';

// ── Μήνυμα καταστήματος → διαχειριστή ────────────────────────────────────────
// Γράφεται σε ΠΙΝΑΚΑ (store_messages) και όχι σε realtime broadcast όπως τα
// μηνύματα admin→κατάστημα: ο admin μπορεί να μην είναι συνδεδεμένος τη στιγμή
// που στέλνει το κατάστημα, και ένα broadcast θα χανόταν αθόρυβα. Έτσι το μήνυμα
// περιμένει στο κέντρο ελέγχου μέχρι να διαβαστεί.

export default function ContactAdminModal({
  isOpen,
  onClose,
  storeId,
}: {
  isOpen: boolean;
  onClose: () => void;
  storeId: string;
}) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  if (!isOpen) return null;

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = message.trim();
    if (!text) {
      toast.error('Γράψτε το μήνυμά σας πρώτα.');
      return;
    }
    if (isReadOnly()) {
      toast.error('Εφεδρική λειτουργία — προσωρινά μόνο ανάγνωση.');
      return;
    }

    setSending(true);
    const { error } = await supabase.from('store_messages').insert({
      store_id: storeId,
      message: text,
    });
    setSending(false);

    if (error) {
      console.error(error);
      toast.error('Αποτυχία αποστολής. Δοκιμάστε ξανά.');
      return;
    }
    toast.success('Το μήνυμα στάλθηκε στο κέντρο ελέγχου.');
    setMessage('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 backdrop-blur-sm bg-black/40 animate-fade-in" onClick={onClose} />

      <form
        onSubmit={handleSend}
        className="relative w-full max-w-md p-6 rounded-2xl shadow-2xl animate-scale-in overflow-hidden"
        style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-default)' }}
      >
        {/* Η μπάρα την κόβει το overflow-hidden του πλαισίου: δικό της border-radius
            δεν δουλεύει, γιατί σε ύψος 4px ο browser σμικρύνει τα 16px σε 4px και
            οι άκρες ξεπερνούν την καμπύλη της γωνίας. */}
        <div
          className="absolute top-0 left-0 right-0 h-1"
          style={{ background: 'linear-gradient(90deg, var(--accent), var(--accent-hover))' }}
        />

        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            <div
              className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-hover))', color: '#fff' }}
            >
              <MessageSquare size={20} />
            </div>
            <div>
              <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                Μήνυμα στο Κέντρο Ελέγχου
              </h3>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Θα το δει ο διαχειριστής, ακόμα κι αν λείπει τώρα.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg shrink-0"
            style={{ color: 'var(--text-muted)' }}
            aria-label="Κλείσιμο"
          >
            <X size={18} />
          </button>
        </div>

        <textarea
          rows={4}
          autoFocus
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="π.χ. Καθυστερεί η παραγγελία για Τυρνόβου 5..."
          className="resize-none w-full mb-5"
          style={{
            backgroundColor: 'var(--bg-input)',
            border: '1.5px solid var(--border-default)',
            color: 'var(--text-primary)',
            borderRadius: 'var(--radius-md)',
            outline: 'none',
            padding: '10px 14px',
            fontSize: '14px',
            lineHeight: '1.5',
          }}
        />

        <button
          type="submit"
          disabled={sending}
          className="w-full py-3 rounded-xl font-bold text-white transition-all flex items-center justify-center gap-2"
          style={{
            background: sending ? 'var(--accent-hover)' : 'linear-gradient(135deg, var(--accent), var(--accent-hover))',
            boxShadow: sending ? 'none' : '0 4px 16px var(--accent-muted)',
            opacity: sending ? 0.8 : 1,
            cursor: sending ? 'not-allowed' : 'pointer',
          }}
        >
          {sending ? (
            <>
              <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              Αποστολή...
            </>
          ) : (
            <>
              <Send size={16} />
              Αποστολή
            </>
          )}
        </button>
      </form>
    </div>
  );
}
