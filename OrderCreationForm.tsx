'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Banknote, CreditCard, MapPin, Send } from 'lucide-react';
import { supabase } from './lib/supabase';

type Suggestion = { street: string; context: string };

const MIN_CHARS = 3;      // δεν ψάχνουμε πριν από τόσα γράμματα (όσα δέχεται και το API route)
const DEBOUNCE_MS = 200;  // περιμένουμε να σταματήσει το πληκτρολόγιο

// Σύγκριση χωρίς τόνους/κεφαλαία (και ς→σ) για το τοπικό φιλτράρισμα.
const norm = (s: string) =>
  s.toLowerCase().replace(/ς/g, 'σ').normalize('NFD').replace(/[̀-ͯ]/g, '');

export default function OrderCreationForm({ storeId }: { storeId: string }) {
  const [street, setStreet] = useState('');
  const [streetNumber, setStreetNumber] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card'>('cash');
  const [comments, setComments] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // ── Autocomplete state ──
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cacheRef = useRef<Map<string, Suggestion[]>>(new Map());
  const justSelectedRef = useRef(false);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    abortRef.current?.abort();
  }, []);

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchSuggestions = useCallback(async (text: string) => {
    const cached = cacheRef.current.get(text.toLowerCase());
    if (cached) {
      setSuggestions(cached);
      setShowSuggestions(cached.length > 0);
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch(`/api/autocomplete?text=${encodeURIComponent(text)}`, {
        signal: controller.signal,
      });
      const data = await res.json();
      const list: Suggestion[] = data.suggestions || [];
      cacheRef.current.set(text.toLowerCase(), list);
      setSuggestions(list);
      setShowSuggestions(list.length > 0);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') console.error(e);
    }
  }, []);

  // Άμεσες προτάσεις από το cache: βρίσκουμε το μεγαλύτερο ήδη-κατεβασμένο
  // πρόθεμα του q και φιλτράρουμε τοπικά. Έτσι το dropdown ενημερώνεται
  // ακαριαία σε κάθε πλήκτρο, και το (debounced) fetch απλώς το επιβεβαιώνει.
  const localMatches = (q: string): Suggestion[] | null => {
    for (let len = q.length; len >= MIN_CHARS; len--) {
      const cached = cacheRef.current.get(q.slice(0, len).toLowerCase());
      if (cached) {
        const nq = norm(q);
        return cached.filter((s) => norm(s.street).includes(nq));
      }
    }
    return null;
  };

  const onStreetChange = (value: string) => {
    setStreet(value);
    justSelectedRef.current = false;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = value.trim();
    if (q.length < MIN_CHARS) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    const local = localMatches(q);
    if (local) {
      setSuggestions(local);
      setShowSuggestions(local.length > 0);
    }
    debounceRef.current = setTimeout(() => fetchSuggestions(q), DEBOUNCE_MS);
  };

  const selectSuggestion = (s: Suggestion) => {
    justSelectedRef.current = true;
    setStreet(s.street);
    setSuggestions([]);
    setShowSuggestions(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!street) {
      showToast('Παρακαλώ εισάγετε διεύθυνση παράδοσης.', 'error');
      return;
    }

    setIsSubmitting(true);
    const fullAddress = `${street} ${streetNumber}`.trim();

    const { error } = await supabase.from('orders').insert({
      store_id: storeId,
      address: fullAddress,
      payment_method: paymentMethod,
      comments: comments,
      status: 'pending',
    });

    setIsSubmitting(false);

    if (error) {
      console.error(error);
      showToast('Αποτυχία δημιουργίας παραγγελίας. Δοκιμάστε ξανά.', 'error');
    } else {
      setStreet('');
      setStreetNumber('');
      setComments('');
      setPaymentMethod('cash');
      setSuggestions([]);
      setShowSuggestions(false);
      showToast('✓ Η παραγγελία δημιουργήθηκε επιτυχώς!', 'success');
    }
  };

  const inputStyle = {
    backgroundColor: 'var(--bg-input)',
    border: '1.5px solid var(--border-default)',
    color: 'var(--text-primary)',
    borderRadius: 'var(--radius-md)',
    outline: 'none',
    transition: 'border-color var(--transition-fast), box-shadow var(--transition-fast)',
    width: '100%',
    padding: '10px 14px',
    fontSize: '14px',
  };

  return (
    <>
      {/* Τίτλος + inline μήνυμα (στην ίδια γραμμή, χωρίς αναδίπλωση) */}
      <div className="mb-6 flex items-center gap-3 min-w-0">
        <h1 className="text-2xl font-bold tracking-tight shrink-0" style={{ color: 'var(--text-primary)' }}>
          Νέα Παραγγελία
        </h1>
        {toast && (
          <div
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap animate-fade-in min-w-0"
            style={{
              backgroundColor: toast.type === 'success' ? 'var(--success-bg)' : 'var(--danger-bg)',
              border: `1px solid ${toast.type === 'success' ? 'var(--success-border)' : 'var(--danger-border)'}`,
              color: toast.type === 'success' ? 'var(--success)' : 'var(--danger)',
            }}
          >
            <span className="truncate">{toast.message}</span>
            <button
              onClick={() => setToast(null)}
              className="opacity-60 hover:opacity-100 transition-opacity shrink-0"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        className="p-6 rounded-2xl"
        style={{
          backgroundColor: 'var(--bg-card)',
          border: '2px solid var(--accent)',
          boxShadow: '0 0 0 1px var(--accent-muted), var(--shadow-sm)',
        }}
      >
        {/* Address + Number */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-1">
          <div className="md:col-span-2 space-y-1.5">
            <label className="block text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              Οδός
            </label>
            <div className="relative">
              <input
                type="text"
                placeholder="Αρχίστε να πληκτρολογείτε..."
                value={street}
                autoComplete="off"
                onChange={(e) => onStreetChange(e.target.value)}
                onFocus={(e) => {
                  e.target.style.borderColor = 'var(--accent)';
                  e.target.style.boxShadow = '0 0 0 3px var(--accent-muted)';
                  if (suggestions.length > 0) setShowSuggestions(true);
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = 'var(--border-default)';
                  e.target.style.boxShadow = 'none';
                  // μικρή καθυστέρηση ώστε να προλάβει το click στην πρόταση
                  setTimeout(() => setShowSuggestions(false), 150);
                }}
                style={{ ...inputStyle, paddingLeft: '40px' }}
              />
              <MapPin
                className="w-4 h-4 absolute"
                style={{
                  color: 'var(--text-muted)',
                  left: '12px',
                  top: '25px',
                  transform: 'translateY(-50%)',
                  pointerEvents: 'none',
                }}
              />

              {/* Dropdown προτάσεων */}
              {showSuggestions && suggestions.length > 0 && (
                <ul
                  className="absolute left-0 right-0 z-50 mt-1 py-1 rounded-xl overflow-hidden"
                  style={{
                    backgroundColor: 'var(--bg-card)',
                    border: '1.5px solid var(--border-default)',
                    boxShadow: 'var(--shadow-md)',
                    maxHeight: '260px',
                    overflowY: 'auto',
                  }}
                >
                  {suggestions.map((s, i) => (
                    <li
                      key={`${s.street}-${i}`}
                      // onMouseDown (όχι onClick) ώστε να προλάβει το blur
                      onMouseDown={(e) => {
                        e.preventDefault();
                        selectSuggestion(s);
                      }}
                      className="flex items-start gap-2 px-3 py-2 cursor-pointer text-sm transition-colors"
                      style={{ color: 'var(--text-primary)' }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-input)')}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                    >
                      <MapPin className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: 'var(--accent)' }} />
                      <span className="flex flex-col min-w-0">
                        <span className="font-medium leading-snug" style={{ color: 'var(--text-primary)' }}>
                          {s.street}
                        </span>
                        {s.context && (
                          <span className="text-[11px] leading-snug" style={{ color: 'var(--text-muted)' }}>
                            {s.context}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              Αριθμός
            </label>
            <input
              type="text"
              placeholder="π.χ. 12Α"
              value={streetNumber}
              onChange={(e) => setStreetNumber(e.target.value)}
              style={inputStyle}
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

        {/* Attribution (απαίτηση δωρεάν πλάνου Geoapify) */}
        <p className="mb-4 text-[10px]" style={{ color: 'var(--text-muted)' }}>
          Προτάσεις διευθύνσεων: Geoapify · OpenStreetMap
        </p>

        {/* Payment Method */}
        <div className="mb-4 space-y-1.5">
          <label className="block text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
            Τρόπος Πληρωμής
          </label>
          <div
            className="flex gap-2 p-1 rounded-xl"
            style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-subtle)' }}
          >
            {/* Cash */}
            <button
              type="button"
              onClick={() => setPaymentMethod('cash')}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200"
              style={
                paymentMethod === 'cash'
                  ? {
                      background: 'linear-gradient(135deg, var(--accent), var(--accent-hover))',
                      color: '#fff',
                      boxShadow: '0 2px 8px var(--accent-muted)',
                    }
                  : {
                      color: 'var(--text-secondary)',
                      backgroundColor: 'transparent',
                    }
              }
            >
              <Banknote className="w-4 h-4" />
              Μετρητά
            </button>
            {/* Card */}
            <button
              type="button"
              onClick={() => setPaymentMethod('card')}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200"
              style={
                paymentMethod === 'card'
                  ? {
                      background: 'linear-gradient(135deg, var(--accent), var(--accent-hover))',
                      color: '#fff',
                      boxShadow: '0 2px 8px var(--accent-muted)',
                    }
                  : {
                      color: 'var(--text-secondary)',
                      backgroundColor: 'transparent',
                    }
              }
            >
              <CreditCard className="w-4 h-4" />
              Κάρτα
            </button>
          </div>
        </div>

        {/* Comments */}
        <div className="mb-6 space-y-1.5">
          <label className="block text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
            Σχόλια <span className="normal-case font-normal">(προαιρετικά)</span>
          </label>
          <textarea
            rows={2}
            placeholder="π.χ. Χτύπα κουδούνι, 2ος όροφος..."
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            className="resize-none"
            style={{ ...inputStyle, lineHeight: '1.5' }}
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

        {/* Submit */}
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-white transition-all duration-200"
          style={{
            background: isSubmitting
              ? 'var(--accent-hover)'
              : 'linear-gradient(135deg, var(--accent), var(--accent-hover))',
            boxShadow: isSubmitting ? 'none' : '0 4px 16px var(--accent-muted)',
            opacity: isSubmitting ? 0.75 : 1,
            cursor: isSubmitting ? 'not-allowed' : 'pointer',
          }}
          onMouseEnter={e => {
            if (!isSubmitting) {
              (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)';
              (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 8px 24px var(--accent-muted)';
            }
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)';
            (e.currentTarget as HTMLButtonElement).style.boxShadow = isSubmitting ? 'none' : '0 4px 16px var(--accent-muted)';
          }}
        >
          {isSubmitting ? (
            <>
              <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              Αποστολή...
            </>
          ) : (
            <>
              <Send className="w-4 h-4" />
              Αποστολή Παραγγελίας
            </>
          )}
        </button>
      </form>
    </>
  );
}
