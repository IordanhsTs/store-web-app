'use client';

import { useState, useRef } from 'react';
import { useJsApiLoader, Autocomplete } from '@react-google-maps/api';
import { Banknote, CreditCard, MapPin, Send, Navigation } from 'lucide-react';
import { createBrowserClient } from '@supabase/ssr';

const libraries: ('places')[] = ['places'];

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function OrderCreationForm({ storeId }: { storeId: string }) {
  const [street, setStreet] = useState('');
  const [streetNumber, setStreetNumber] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card'>('cash');
  const [comments, setComments] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);

  const { isLoaded } = useJsApiLoader({
    id: 'script-loader',
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY as string,
    libraries,
    language: 'el',
    region: 'GR',
  });

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const handlePlaceChanged = () => {
    if (autocompleteRef.current !== null) {
      const place = autocompleteRef.current.getPlace();
      setStreet(place.name || place.formatted_address || '');
    }
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
      showToast('✓ Η παραγγελία δημιουργήθηκε επιτυχώς!', 'success');
    }
  };

  if (!isLoaded) {
    return (
      <div
        className="p-6 rounded-2xl"
        style={{
          backgroundColor: 'var(--bg-card)',
          border: '1px solid var(--border-default)',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <div className="space-y-4">
          <div className="skeleton h-6 w-32" />
          <div className="skeleton h-11 w-full" />
          <div className="skeleton h-11 w-full" />
          <div className="skeleton h-11 w-full" />
          <div className="skeleton h-20 w-full" />
          <div className="skeleton h-12 w-full" />
        </div>
      </div>
    );
  }

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
          border: '1px solid var(--border-default)',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        {/* Address + Number */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          <div className="md:col-span-2 space-y-1.5">
            <label className="block text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              Οδός
            </label>
            <div className="relative">
              <Autocomplete
                onLoad={(autocomplete) => (autocompleteRef.current = autocomplete)}
                onPlaceChanged={handlePlaceChanged}
                options={{
                  bounds: {
                    south: 40.70,
                    west: 21.30,
                    north: 40.85,
                    east: 21.50,
                  },
                }}
              >
                <input
                  type="text"
                  placeholder="Αρχίστε να πληκτρολογείτε..."
                  value={street}
                  onChange={(e) => setStreet(e.target.value)}
                  style={{ ...inputStyle, paddingLeft: '40px' }}
                  onFocus={e => {
                    e.target.style.borderColor = 'var(--accent)';
                    e.target.style.boxShadow = '0 0 0 3px var(--accent-muted)';
                  }}
                  onBlur={e => {
                    e.target.style.borderColor = 'var(--border-default)';
                    e.target.style.boxShadow = 'none';
                  }}
                />
              </Autocomplete>
              <MapPin
                className="w-4 h-4 absolute"
                style={{
                  color: 'var(--text-muted)',
                  left: '12px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  pointerEvents: 'none',
                }}
              />
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