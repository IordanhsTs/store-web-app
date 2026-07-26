'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Banknote, CreditCard, MapPin, Send, Lock, Save, Clock, Route, AlertTriangle, BookMarked } from 'lucide-react';
import { toast } from 'sonner';
import { supabase, isReadOnly } from './lib/supabase';
import { confirmDialog } from './ConfirmDialog';
import { useStoreOrigin } from './useStoreOrigin';
import AddressPicker, { type SavedAddress } from './AddressPicker';
import {
  haversineKm,
  surchargeFor,
  formatKm,
  formatEuro,
  MAX_DISTANCE_KM,
  FREE_RADIUS_KM,
} from './lib/distance';

type Suggestion = { street: string; context: string; lat: number | null; lon: number | null };

const MIN_CHARS = 3;      // δεν ψάχνουμε πριν από τόσα γράμματα (όσα δέχεται και το API route)
const DEBOUNCE_MS = 200;  // περιμένουμε να σταματήσει το πληκτρολόγιο
const MAX_SAVED = 10;     // όριο αποθηκευμένων διευθύνσεων ανά κατάστημα (απόφαση χρήστη)

// Προεπιλογές καθυστέρησης αποστολής (λεπτά). 0 = άμεσα.
const DELAY_PRESETS = [0, 5, 10, 15];

// Σύγκριση χωρίς τόνους/κεφαλαία (και ς→σ) για το τοπικό φιλτράρισμα.
const norm = (s: string) =>
  s.toLowerCase().replace(/ς/g, 'σ').normalize('NFD').replace(/[̀-ͯ]/g, '');

// Οδός και αριθμός ζουν πλέον στο ΙΔΙΟ πεδίο (αίτημα πελάτη). Το autocomplete όμως
// ψάχνει δρόμους — με τον αριθμό μέσα δεν βρίσκει τίποτα. Οπότε τον αποσπάμε για την
// αναζήτηση και τον κρατάμε για την τελική διεύθυνση.
const TRAILING_NUMBER_RE = /[\s,]+(\d+\s*[Α-Ωα-ωA-Za-z]?)\s*$/;

function splitAddress(text: string): { street: string; number: string } {
  const m = text.match(TRAILING_NUMBER_RE);
  if (!m || m.index === undefined) return { street: text.trim(), number: '' };
  return { street: text.slice(0, m.index).trim(), number: m[1].replace(/\s+/g, '') };
}

export default function OrderCreationForm({
  store,
}: {
  store: { id: string; address: string | null; latitude: number | null; longitude: number | null };
}) {
  const storeId = store.id;
  const origin = useStoreOrigin(store);

  const [address, setAddress] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card'>('cash');
  const [comments, setComments] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  // READ-ONLY-ON-FAILOVER: σε standby κλείνουμε τη δημιουργία παραγγελίας (μετά το mount).
  const [readOnly, setReadOnly] = useState(false);

  // ── Συντεταγμένες προορισμού (από την επιλεγμένη πρόταση ή αποθηκευμένη διεύθυνση) ──
  const [dest, setDest] = useState<{ lat: number; lon: number } | null>(null);
  // Η τρέχουσα διεύθυνση είναι ήδη γραμμή του saved_addresses (επιλέχθηκε από
  // την καρτέλα «Αποθηκευμένες» ή μόλις αποθηκεύτηκε με όνομα από τον χάρτη) —
  // δεν έχει νόημα να προτείνουμε ξανά «Αποθήκευση» για κάτι που υπάρχει ήδη.
  const [isAlreadySaved, setIsAlreadySaved] = useState(false);
  // Ο δρόμος (χωρίς αριθμό) για τον οποίο ισχύουν οι τρέχουσες συντεταγμένες. Η
  // ροή χρήσης είναι «διάλεξε δρόμο από το dropdown, ΜΕΤΑ πληκτρολόγησε αριθμό» —
  // αν το onChange ακύρωνε τις συντεταγμένες σε ΚΑΘΕ πλήκτρο, θα χανόταν η
  // απόσταση ακριβώς τη στιγμή που ο χρήστης προσθέτει τον αριθμό.
  const destStreetRef = useRef<string | null>(null);

  // ── Καθυστερημένη αποστολή ──
  const [delayMinutes, setDelayMinutes] = useState(0);
  const [customDelay, setCustomDelay] = useState('');

  // ── Αποθηκευμένες διευθύνσεις ──
  const [saved, setSaved] = useState<SavedAddress[]>([]);
  const [savingLabel, setSavingLabel] = useState<string | null>(null); // null = κλειστό
  const [pickerOpen, setPickerOpen] = useState(false);

  // ── Autocomplete state ──
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cacheRef = useRef<Map<string, Suggestion[]>>(new Map());

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    abortRef.current?.abort();
  }, []);

  useEffect(() => {
    setReadOnly(isReadOnly());
  }, []);

  // Φόρτωση αποθηκευμένων διευθύνσεων του καταστήματος
  const loadSaved = useCallback(async () => {
    const { data } = await supabase
      .from('saved_addresses')
      .select('id, label, address, latitude, longitude, distance_km, surcharge')
      .eq('store_id', storeId)
      .order('label');
    if (data) setSaved(data as SavedAddress[]);
  }, [storeId]);

  useEffect(() => { loadSaved(); }, [loadSaved]);

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

  const onAddressChange = (value: string) => {
    setAddress(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    // Ψάχνουμε μόνο το κομμάτι της οδού (χωρίς τον αριθμό).
    const { street } = splitAddress(value);

    // Ακυρώνουμε τις συντεταγμένες ΜΟΝΟ αν άλλαξε ο ΔΡΟΜΟΣ — όχι σε κάθε πλήκτρο.
    // Έτσι το πληκτρολόγημα του αριθμού ΜΕΤΑ την επιλογή πρότασης δεν τις σβήνει.
    if (norm(street) !== norm(destStreetRef.current || '')) {
      setDest(null);
      destStreetRef.current = null;
      setIsAlreadySaved(false);
    }
    if (street.length < MIN_CHARS) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    const local = localMatches(street);
    if (local) {
      setSuggestions(local);
      setShowSuggestions(local.length > 0);
    }
    debounceRef.current = setTimeout(() => fetchSuggestions(street), DEBOUNCE_MS);
  };

  const selectSuggestion = (s: Suggestion) => {
    // Κρατάμε τον αριθμό που είχε ήδη γράψει ο χρήστης — ένα πεδίο, μία κίνηση.
    const { number } = splitAddress(address);
    setAddress(number ? `${s.street} ${number}` : `${s.street} `);
    const hasCoords = s.lat != null && s.lon != null;
    setDest(hasCoords ? { lat: s.lat!, lon: s.lon! } : null);
    // Θυμόμαστε τον δρόμο ώστε το επόμενο onChange (π.χ. πληκτρολόγηση αριθμού)
    // να ξέρει ότι οι συντεταγμένες εξακολουθούν να ισχύουν.
    destStreetRef.current = hasCoords ? s.street : null;
    setIsAlreadySaved(false); // πρόταση Geoapify — σίγουρα όχι ήδη αποθηκευμένη
    setSuggestions([]);
    setShowSuggestions(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
  };

  // Εφαρμογή διεύθυνσης από τον επιλογέα — είτε αποθηκευμένη, είτε πινέζα χάρτη.
  const applyPicked = (a: { address: string; lat: number | null; lon: number | null; alreadySaved: boolean }) => {
    setAddress(a.address);
    const hasCoords = a.lat != null && a.lon != null;
    setDest(hasCoords ? { lat: a.lat!, lon: a.lon! } : null);
    // Ίδιο κόλπο με το selectSuggestion: θυμόμαστε τον δρόμο ώστε μια μετέπειτα
    // προσθήκη αριθμού να μη σβήσει τις συντεταγμένες.
    destStreetRef.current = hasCoords ? splitAddress(a.address).street : null;
    setIsAlreadySaved(a.alreadySaved);
    setSuggestions([]);
    setShowSuggestions(false);
  };

  // ── Απόσταση / χρέωση της τρέχουσας διεύθυνσης ──
  const distanceKm = origin && dest ? haversineKm(origin.lat, origin.lon, dest.lat, dest.lon) : null;
  const surcharge = distanceKm !== null ? surchargeFor(distanceKm) : 0;
  const tooFar = distanceKm !== null && distanceKm > MAX_DISTANCE_KM;

  const effectiveDelay = delayMinutes === -1 ? parseInt(customDelay, 10) || 0 : delayMinutes;

  const handleSaveAddress = async () => {
    const label = (savingLabel || '').trim();
    if (!label) {
      toast.error('Δώστε ένα όνομα για την διεύθυνση (π.χ. LIDL).');
      return;
    }
    if (saved.length >= MAX_SAVED) {
      toast.error(`Έχετε φτάσει το όριο των ${MAX_SAVED} αποθηκευμένων διευθύνσεων.`);
      return;
    }
    const { error } = await supabase.from('saved_addresses').insert({
      store_id: storeId,
      label,
      address: address.trim(),
      latitude: dest?.lat ?? null,
      longitude: dest?.lon ?? null,
      distance_km: distanceKm,
      surcharge: distanceKm !== null ? surcharge : null,
    });
    if (error) {
      // unique (store_id, label)
      toast.error(
        error.code === '23505'
          ? 'Υπάρχει ήδη αποθηκευμένη διεύθυνση με αυτό το όνομα.'
          : 'Αποτυχία αποθήκευσης της διεύθυνσης.'
      );
      return;
    }
    toast.success(`Η διεύθυνση αποθηκεύτηκε ως «${label}».`);
    setSavingLabel(null);
    loadSaved();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (readOnly) {
      toast.error('Εφεδρική λειτουργία — προσωρινά μόνο ανάγνωση. Δοκιμάστε ξανά μόλις αποκατασταθεί το κύριο σύστημα.');
      return;
    }
    const fullAddress = address.trim();
    if (!fullAddress) {
      toast.error('Παρακαλώ εισάγετε διεύθυνση παράδοσης.');
      return;
    }

    // ── Όριο 15 χλμ: σκληρό μπλοκ ──
    // Ισχύει ΜΟΝΟ όταν ξέρουμε πραγματικά την απόσταση. Αν λείπουν συντεταγμένες
    // (π.χ. ο χρήστης έγραψε τη διεύθυνση χωρίς να διαλέξει πρόταση) αφήνουμε την
    // παραγγελία να περάσει: καλύτερα μια αχρέωτη παραγγελία από μπλοκαρισμένο μαγαζί.
    if (tooFar) {
      toast.error(
        `Η διεύθυνση απέχει ${formatKm(distanceKm)} — πάνω από το όριο των ${MAX_DISTANCE_KM} χλμ. Η παραγγελία δεν μπορεί να σταλεί.`
      );
      return;
    }

    // ── Επιπλέον χρέωση: το κατάστημα ΠΡΕΠΕΙ να πατήσει «Συνέχεια» ──
    if (surcharge > 0) {
      const ok = await confirmDialog(
        `Η διεύθυνση απέχει ${formatKm(distanceKm)}, δηλαδή πάνω από τα ${String(FREE_RADIUS_KM).replace('.', ',')} χλμ. ` +
        `Η παραγγελία χρεώνεται επιπλέον ${formatEuro(surcharge)}.`,
        { title: 'Επιπλέον χρέωση απόστασης', confirmLabel: 'Συνέχεια' }
      );
      if (!ok) return;
    }

    setIsSubmitting(true);

    // Καθυστερημένη αποστολή: μπαίνει ως 'scheduled' και γίνεται 'pending' όταν
    // λάχει η ώρα. Το status είναι σημαντικό — η edge function των push αγνοεί
    // ό,τι δεν είναι 'pending', άρα οι διανομείς ΔΕΝ ειδοποιούνται πρόωρα.
    const scheduledAt =
      effectiveDelay > 0 ? new Date(Date.now() + effectiveDelay * 60000).toISOString() : null;

    const { error } = await supabase.from('orders').insert({
      store_id: storeId,
      address: fullAddress,
      payment_method: paymentMethod,
      comments: comments,
      status: scheduledAt ? 'scheduled' : 'pending',
      scheduled_at: scheduledAt,
      latitude: dest?.lat ?? null,
      longitude: dest?.lon ?? null,
      distance_km: distanceKm,
      surcharge: distanceKm !== null ? surcharge : null,
    });

    setIsSubmitting(false);

    if (error) {
      console.error(error);
      toast.error('Αποτυχία δημιουργίας παραγγελίας. Δοκιμάστε ξανά.');
    } else {
      setAddress('');
      setComments('');
      setPaymentMethod('cash');
      setDest(null);
      destStreetRef.current = null;
      setIsAlreadySaved(false);
      setDelayMinutes(0);
      setCustomDelay('');
      setSuggestions([]);
      setShowSuggestions(false);
      setSavingLabel(null);
      toast.success(
        scheduledAt
          ? `Η παραγγελία προγραμματίστηκε — θα σταλεί στους διανομείς σε ${effectiveDelay} λεπτά.`
          : 'Η παραγγελία δημιουργήθηκε επιτυχώς!'
      );
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

  const canSaveCurrent = !isAlreadySaved && address.trim().length > 0 && dest !== null && saved.length < MAX_SAVED;

  return (
    <>
      {/* Τίτλος */}
      <div className="mb-6 flex items-center gap-3 min-w-0">
        <h1 className="text-2xl font-bold tracking-tight shrink-0" style={{ color: 'var(--text-primary)' }}>
          Νέα Παραγγελία
        </h1>
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
        {/* ── Διεύθυνση: οδός ΚΑΙ αριθμός σε ΕΝΑ πεδίο ── */}
        <div className="mb-1 space-y-1.5">
          <label className="block text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
            Διεύθυνση παράδοσης <span className="normal-case font-normal">(οδός και αριθμός)</span>
          </label>
          <div className="relative">
            <input
              type="text"
              placeholder="π.χ. Παύλου Μελά 12"
              value={address}
              autoComplete="off"
              onChange={(e) => onAddressChange(e.target.value)}
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
              style={{ ...inputStyle, paddingLeft: '40px', paddingRight: '46px' }}
            />
            <MapPin
              className="w-4 h-4 absolute"
              style={{
                color: 'var(--text-muted)',
                left: '12px',
                top: '20px',
                transform: 'translateY(-50%)',
                pointerEvents: 'none',
              }}
            />

            {/* Επιλογέας: αποθηκευμένες διευθύνσεις ή πινέζα στον χάρτη — για τις
                διευθύνσεις που δεν βρίσκονται με αναζήτηση (επαρχιακή πόλη). */}
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="absolute flex items-center justify-center rounded-lg transition-all"
              style={{
                right: '6px',
                top: '20px',
                transform: 'translateY(-50%)',
                width: '32px',
                height: '32px',
                color: 'var(--accent)',
                backgroundColor: 'var(--accent-muted)',
                border: '1px solid var(--border-subtle)',
              }}
              title="Αποθηκευμένες διευθύνσεις ή επιλογή στον χάρτη"
              aria-label="Αποθηκευμένες διευθύνσεις ή επιλογή στον χάρτη"
            >
              <BookMarked className="w-4 h-4" />
              {saved.length > 0 && (
                <span
                  className="absolute -top-1 -right-1 min-w-[15px] h-[15px] px-1 rounded-full text-[9px] font-black flex items-center justify-center"
                  style={{ backgroundColor: 'var(--accent)', color: '#fff' }}
                >
                  {saved.length}
                </span>
              )}
            </button>

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

        {/* ── Απόσταση / χρέωση / όριο ── */}
        {distanceKm !== null && (
          <div
            className="mt-2 mb-1 flex items-center flex-wrap gap-x-3 gap-y-1 px-3 py-2 rounded-xl text-xs font-semibold"
            style={
              tooFar
                ? { backgroundColor: 'var(--danger-bg)', border: '1px solid var(--danger-border)', color: 'var(--danger)' }
                : surcharge > 0
                ? { backgroundColor: 'var(--warning-bg)', border: '1px solid var(--warning-border)', color: 'var(--warning)' }
                : { backgroundColor: 'var(--success-bg)', border: '1px solid var(--success-border)', color: 'var(--success)' }
            }
          >
            <span className="inline-flex items-center gap-1.5">
              {tooFar ? <AlertTriangle className="w-3.5 h-3.5" /> : <Route className="w-3.5 h-3.5" />}
              {formatKm(distanceKm)}
            </span>
            {tooFar ? (
              <span>Πάνω από το όριο των {MAX_DISTANCE_KM} χλμ — δεν επιτρέπεται</span>
            ) : surcharge > 0 ? (
              <span>Επιπλέον χρέωση {formatEuro(surcharge)}</span>
            ) : (
              <span>Χωρίς επιπλέον χρέωση</span>
            )}

            {/* Αποθήκευση της διεύθυνσης για μελλοντική χρήση */}
            {canSaveCurrent && savingLabel === null && !tooFar && (
              <button
                type="button"
                onClick={() => setSavingLabel('')}
                className="ml-auto inline-flex items-center gap-1 underline opacity-80 hover:opacity-100"
                title="Αποθήκευση αυτής της διεύθυνσης"
              >
                <Save className="w-3.5 h-3.5" />
                Αποθήκευση
              </button>
            )}
          </div>
        )}

        {/* Inline πεδίο ονόματος για την αποθήκευση */}
        {savingLabel !== null && (
          <div className="mb-2 flex gap-2">
            <input
              type="text"
              autoFocus
              placeholder="Όνομα (π.χ. LIDL)"
              value={savingLabel}
              onChange={(e) => setSavingLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); handleSaveAddress(); }
                if (e.key === 'Escape') setSavingLabel(null);
              }}
              style={{ ...inputStyle, flex: 1 }}
            />
            <button
              type="button"
              onClick={handleSaveAddress}
              className="px-3 rounded-lg text-xs font-bold text-white shrink-0"
              style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-hover))' }}
            >
              Αποθήκευση
            </button>
            <button
              type="button"
              onClick={() => setSavingLabel(null)}
              className="px-3 rounded-lg text-xs font-semibold shrink-0"
              style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
            >
              Άκυρο
            </button>
          </div>
        )}

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

        {/* ── Χρόνος αποστολής στους διανομείς ── */}
        <div className="mb-4 space-y-1.5">
          <label className="block text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
            Αποστολή στους διανομείς
          </label>
          <div
            className="flex gap-1.5 p-1 rounded-xl"
            style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-subtle)' }}
          >
            {DELAY_PRESETS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setDelayMinutes(m)}
                className="flex-1 py-2 rounded-lg text-xs font-semibold transition-all duration-200"
                style={
                  delayMinutes === m
                    ? {
                        background: 'linear-gradient(135deg, var(--accent), var(--accent-hover))',
                        color: '#fff',
                      }
                    : { color: 'var(--text-secondary)', backgroundColor: 'transparent' }
                }
              >
                {m === 0 ? 'Άμεσα' : `${m}′`}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setDelayMinutes(-1)}
              className="flex-1 py-2 rounded-lg text-xs font-semibold transition-all duration-200"
              style={
                delayMinutes === -1
                  ? { background: 'linear-gradient(135deg, var(--accent), var(--accent-hover))', color: '#fff' }
                  : { color: 'var(--text-secondary)', backgroundColor: 'transparent' }
              }
            >
              Άλλο
            </button>
          </div>
          {delayMinutes === -1 && (
            <input
              type="number"
              min={1}
              max={240}
              placeholder="Λεπτά καθυστέρησης"
              value={customDelay}
              onChange={(e) => setCustomDelay(e.target.value)}
              style={inputStyle}
            />
          )}
          {effectiveDelay > 0 && (
            <p className="text-[11px] flex items-center gap-1.5" style={{ color: 'var(--accent)' }}>
              <Clock className="w-3 h-3" />
              Οι διανομείς θα τη δουν σε {effectiveDelay} λεπτά (με αντίστροφη μέτρηση).
            </p>
          )}
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
          disabled={isSubmitting || readOnly || tooFar}
          title={
            readOnly
              ? 'Προσωρινά μη διαθέσιμο — εφεδρική λειτουργία (μόνο ανάγνωση)'
              : tooFar
              ? `Πάνω από το όριο των ${MAX_DISTANCE_KM} χλμ`
              : undefined
          }
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-white transition-all duration-200"
          style={{
            background: readOnly || tooFar
              ? 'var(--text-muted)'
              : isSubmitting
              ? 'var(--accent-hover)'
              : 'linear-gradient(135deg, var(--accent), var(--accent-hover))',
            boxShadow: isSubmitting || readOnly || tooFar ? 'none' : '0 4px 16px var(--accent-muted)',
            opacity: isSubmitting || readOnly || tooFar ? 0.75 : 1,
            cursor: isSubmitting || readOnly || tooFar ? 'not-allowed' : 'pointer',
          }}
          onMouseEnter={e => {
            if (!isSubmitting && !readOnly && !tooFar) {
              (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)';
              (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 8px 24px var(--accent-muted)';
            }
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)';
            (e.currentTarget as HTMLButtonElement).style.boxShadow = isSubmitting || readOnly || tooFar ? 'none' : '0 4px 16px var(--accent-muted)';
          }}
        >
          {readOnly ? (
            <>
              <Lock className="w-4 h-4" />
              Προσωρινά μη διαθέσιμο
            </>
          ) : tooFar ? (
            <>
              <AlertTriangle className="w-4 h-4" />
              Εκτός ορίου {MAX_DISTANCE_KM} χλμ
            </>
          ) : isSubmitting ? (
            <>
              <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              Αποστολή...
            </>
          ) : (
            <>
              <Send className="w-4 h-4" />
              {effectiveDelay > 0 ? `Προγραμματισμός σε ${effectiveDelay}′` : 'Αποστολή Παραγγελίας'}
            </>
          )}
        </button>
      </form>

      <AddressPicker
        isOpen={pickerOpen}
        onClose={() => setPickerOpen(false)}
        saved={saved}
        origin={origin}
        currentAddress={address}
        maxSaved={MAX_SAVED}
        storeId={storeId}
        onApply={applyPicked}
        onDeleted={loadSaved}
        onSaved={loadSaved}
      />
    </>
  );
}
