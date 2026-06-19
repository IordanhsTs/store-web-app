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

function Toast({ message, type, onClose }: { message: string; type: 'success' | 'error'; onClose: () => void }) {
  return (
    <div
      className="fixed bottom-6 right-6 z-[200] flex items-center gap-3 px-5 py-4 rounded-xl shadow-xl animate-fade-in-up text-sm font-medium"
      style={{
        backgroundColor: type === 'success' ? 'var(--success-bg)' : 'var(--danger-bg)',
        border: `1px solid ${type === 'success' ? 'var(--success-border)' : 'var(--danger-border)'}`,
        color: type === 'success' ? 'var(--success)' : 'var(--danger)',
        backdropFilter: 'blur(8px)',
      }}
    >
      <span>{message}</span>
      <button onClick={onClose} className="ml-2 opacity-60 hover:opacity-100 transition-opacity text-xs">✕</button>
    </div>
  );
}

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
      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}

      <form
        onSubmit={handleSubmit}
        className="p-6 rounded-2xl"
        style={{
          backgroundColor: 'var(--bg-card)',
          border: '1px solid var(--border-default)',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-2.5 mb-6">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: 'var(--accent-muted)' }}
          >
            <Navigation className="w-4 h-4" style={{ color: 'var(--accent)' }} />
          </div>
          <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
            Νέα Παραγγελία
          </h2>
        </div>

        {/* Address + Number */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          <div className="md:col-span-2 space-y-1.5">
            <label className="block text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              Οδός
            </label>
            <Autocomplete
              onLoad={(autocomplete) => (autocompleteRef.current = autocomplete)}
              onPlaceChanged={handlePlaceChanged}
            >
              <input
                type="text"
                placeholder="Αρχίστε να πληκτρολογείτε..."
                value={street}
                onChange={(e) => setStreet(e.target.value)}
                style={{ ...inputStyle, paddingLeft: '40px' }}
                className="relative"
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
                position: 'absolute',
                left: '12px',
                top: '50%',
                transform: 'translateY(-50%)',
                pointerEvents: 'none',
              }}
            />
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