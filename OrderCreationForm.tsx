'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Banknote, CreditCard, MapPin, Send, Lock, Clock, Route, AlertTriangle, BookMarked } from 'lucide-react';
import { toast } from 'sonner';
import { supabase, isReadOnly } from './lib/supabase';
import { confirmDialog } from './ConfirmDialog';
import { useStoreOrigin } from './useStoreOrigin';
import { useRoadDistance } from './useRoadDistance';
import AddressPicker, { type SavedAddress } from './AddressPicker';
import {
  surchargeFor,
  formatKm,
  formatEuro,
  MAX_DISTANCE_KM,
  FREE_RADIUS_KM,
} from './lib/distance';

type Suggestion = {
  street: string;
  context: string;
  /** Google Places δεν δίνει συντεταγμένες στις προτάσεις — χρειάζεται
   *  ξεχωριστό Place Details call (βλ. fetchPlaceDetails) πριν έχουμε σημείο. */
  placeId: string;
  /** Κατάστημα/σημείο ενδιαφέροντος αντί για οδό (π.χ. «Coffee Train»). */
  isPlace?: boolean;
  /** Η οδός στην οποία βρίσκεται το κατάστημα — μπαίνει στη διεύθυνση. */
  streetName?: string;
};

const MIN_CHARS = 3;      // δεν ψάχνουμε πριν από τόσα γράμματα (όσα δέχεται και το API route)
const DEBOUNCE_MS = 200;  // περιμένουμε να σταματήσει το πληκτρολόγιο
const MAX_SAVED = 10;     // όριο αποθηκευμένων διευθύνσεων ανά κατάστημα (απόφαση χρήστη)

// Προεπιλογές καθυστέρησης αποστολής (λεπτά). 0 = άμεσα.
const DELAY_PRESETS = [0, 5, 10, 15];

/** Λεπτά μέχρι την επόμενη φορά που «χτυπάει» η ώρα hh:mm σήμερα (0 αν έχει ήδη περάσει). */
function clockTimeDelayMinutes(hhmm: string): number {
  if (!hhmm) return 0;
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  const target = new Date();
  target.setHours(h, m, 0, 0);
  const diffMs = target.getTime() - Date.now();
  return diffMs > 0 ? Math.ceil(diffMs / 60000) : 0;
}

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
  // Ξέρουμε το σημείο ΤΟΥ ΑΡΙΘΜΟΥ ή μόνο του δρόμου; Η Google το δηλώνει μέσω
  // του type (street_address/premise vs route) — βλ. googlePlaceDetails στο
  // lib/google-places.ts. Ένα σημείο-δρόμου σε δρόμο 2 χλμ σημαίνει έως 2 χλμ
  // λάθος και έως 3,90 € λάθος χρέωση. Το κρατάμε ξεχωριστά ώστε να ΦΑΙΝΕΤΑΙ.
  const [destExact, setDestExact] = useState(false);
  // Ο δρόμος (χωρίς αριθμό) για τον οποίο ισχύουν οι τρέχουσες συντεταγμένες. Η
  // ροή χρήσης είναι «διάλεξε δρόμο από το dropdown, ΜΕΤΑ πληκτρολόγησε αριθμό» —
  // αν το onChange ακύρωνε τις συντεταγμένες σε ΚΑΘΕ πλήκτρο, θα χανόταν η
  // απόσταση ακριβώς τη στιγμή που ο χρήστης προσθέτει τον αριθμό.
  const destStreetRef = useRef<string | null>(null);
  // Το «ακατέργαστο» σημείο της Google (κέντρο δρόμου) για τον τρέχοντα
  // δρόμο — η βάση στην οποία επιστρέφουμε όταν ο αριθμός δεν ταιριάζει σε
  // κανένα καταχωρημένο override (βλ. street_segments πιο κάτω).
  const baseDestRef = useRef<{ lat: number; lon: number } | null>(null);
  const overrideDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Το τρέχον σημείο προήλθε από ΚΑΤΑΣΤΗΜΑ (POI), όχι από οδό. Τότε είναι ήδη
  // ακριβές και δεν δέχεται αριθμό — «Coffee Train 5» δεν σημαίνει τίποτα.
  const destIsPlaceRef = useRef(false);

  // ── Καθυστερημένη αποστολή ── (-1 = χειροκίνητα λεπτά, -2 = συγκεκριμένη ώρα ρολογιού σήμερα)
  const [delayMinutes, setDelayMinutes] = useState(0);
  const [customDelay, setCustomDelay] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');

  // ── Αποθηκευμένες διευθύνσεις ──
  const [saved, setSaved] = useState<SavedAddress[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  // ── Autocomplete state ──
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cacheRef = useRef<Map<string, Suggestion[]>>(new Map());

  // ── Google Places session token ──
  // Ένα token ανά «αναζήτηση» (από την πρώτη πληκτρολόγηση μέχρι να κλειδώσει
  // ένα σημείο) — κρατά όλα τα ενδιάμεσα autocomplete requests δωρεάν, βλ.
  // /api/autocomplete. Ανανεώνεται μετά από κάθε ολοκληρωμένο Place Details call
  // (endSession) και όποτε ξεκινά καινούρια αναζήτηση.
  const sessionTokenRef = useRef<string>(crypto.randomUUID());
  const endSession = () => { sessionTokenRef.current = crypto.randomUUID(); };

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (overrideDebounceRef.current) clearTimeout(overrideDebounceRef.current);
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
      const res = await fetch(
        `/api/autocomplete?text=${encodeURIComponent(text)}&session=${sessionTokenRef.current}`,
        { signal: controller.signal }
      );
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

  // Ένα Place Details call — κλείνει το τρέχον session (βλ. sessionTokenRef).
  const fetchPlaceDetails = async (placeId: string): Promise<{ lat: number; lon: number; exact: boolean } | null> => {
    try {
      const res = await fetch(
        `/api/place-details?placeId=${encodeURIComponent(placeId)}&session=${sessionTokenRef.current}`
      );
      const p = await res.json();
      endSession();
      if (typeof p?.lat === 'number' && typeof p?.lon === 'number') {
        return { lat: p.lat, lon: p.lon, exact: !!p.exact };
      }
    } catch {}
    return null;
  };

  // ΧΕΙΡΟΚΙΝΗΤΟ OVERRIDE ανά τμήμα δρόμου (βλ. migration 0012_street_segment_overrides):
  // κάποιοι δρόμοι είναι αρκετά μεγάλοι ώστε ο αριθμός να αλλάζει ουσιαστικά την
  // απόσταση, και ένα χειροκίνητο εύρος υπερισχύει ό,τι κι αν πει ο provider. Αν
  // δεν υπάρχει override, ρωτάμε τη Google για «δρόμος αριθμός» — αν το top
  // αποτέλεσμα είναι σε επίπεδο συγκεκριμένου κτιρίου (street_address/premise),
  // εμπιστευόμαστε το σημείο της· διαφορετικά ο caller κρατά το σημείο-κέντρο
  // του δρόμου, σημαδεμένο ως ανακριβές. Αόρατο για τον χρήστη, καμία ερώτηση/κλικ.
  const resolveNumberPoint = async (street: string, numberStr: string) => {
    const n = parseInt(numberStr, 10);
    if (!Number.isFinite(n)) return null;

    const { data, error } = await supabase.rpc('resolve_street_segment', {
      p_street: street,
      p_number: n,
    });
    if (!error && data && data.length > 0) {
      const row = data[0];
      if (typeof row.latitude === 'number' && typeof row.longitude === 'number') {
        return { lat: row.latitude, lon: row.longitude };
      }
    }

    // Fail-open: κάθε αποτυχία εδώ σημαίνει απλώς «δεν ξέρουμε τον αριθμό»,
    // ποτέ μπλοκαρισμένη παραγγελία.
    try {
      const res = await fetch(
        `/api/autocomplete?text=${encodeURIComponent(`${street} ${numberStr}`)}&session=${sessionTokenRef.current}`
      );
      const data = await res.json();
      const top: Suggestion | undefined = data.suggestions?.[0];
      if (!top) return null;
      const details = await fetchPlaceDetails(top.placeId);
      if (details?.exact) return { lat: details.lat, lon: details.lon };
    } catch {}

    return null;
  };

  const onAddressChange = (value: string) => {
    setAddress(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    // Ψάχνουμε μόνο το κομμάτι της οδού (χωρίς τον αριθμό).
    const { street, number } = splitAddress(value);

    // Ακυρώνουμε τις συντεταγμένες ΜΟΝΟ αν άλλαξε ο ΔΡΟΜΟΣ — όχι σε κάθε πλήκτρο.
    // Έτσι το πληκτρολόγημα του αριθμού ΜΕΤΑ την επιλογή πρότασης δεν τις σβήνει.
    if (norm(street) !== norm(destStreetRef.current || '')) {
      setDest(null);
      setDestExact(false);
      baseDestRef.current = null;
      destStreetRef.current = null;
      destIsPlaceRef.current = false;
    } else if (destIsPlaceRef.current) {
      // Κατάστημα: το σημείο του POI είναι ήδη ακριβές και δεν αλλάζει με αριθμό.
      setDest(baseDestRef.current);
      setDestExact(true);
    } else if (baseDestRef.current) {
      // Ίδιος δρόμος, άλλαξε ο αριθμός: ελέγχουμε αν πέφτει σε καταχωρημένο
      // override, αλλιώς ξαναγυρνάμε στο σημείο-κέντρο του δρόμου.
      if (overrideDebounceRef.current) clearTimeout(overrideDebounceRef.current);
      const streetForLookup = destStreetRef.current;
      const base = baseDestRef.current;
      if (!number) {
        setDest(base);
        setDestExact(false);
      } else {
        overrideDebounceRef.current = setTimeout(() => {
          resolveNumberPoint(streetForLookup!, number).then((ov) => {
            if (destStreetRef.current !== streetForLookup) return;
            setDest(ov ?? base);
            setDestExact(ov !== null);
          });
        }, DEBOUNCE_MS);
      }
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

  // Async: η Google δεν δίνει συντεταγμένες μέσα στις προτάσεις (βλ. Suggestion
  // type) — χρειάζεται ένα Place Details call πριν έχουμε σημείο. Το κείμενο της
  // διεύθυνσης μπαίνει ΑΜΕΣΩΣ (καμία καθυστέρηση στο UI), το σημείο έρχεται λίγο
  // αργότερα και ενημερώνει το dest όταν φτάσει.
  const selectSuggestion = async (s: Suggestion) => {
    setSuggestions([]);
    setShowSuggestions(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    // ── ΚΑΤΑΣΤΗΜΑ (π.χ. «Coffee Train») ──
    // Το POI έχει ΔΙΚΕΣ ΤΟΥ ακριβείς συντεταγμένες — δεν είναι σημείο δρόμου,
    // άρα ούτε «κατά προσέγγιση» είναι, ούτε δέχεται αριθμό (το «Coffee Train 5»
    // δεν σημαίνει τίποτα). Στη διεύθυνση γράφουμε όνομα + οδό, γιατί ο
    // διανομέας χρειάζεται και τα δύο για να το βρει.
    if (s.isPlace) {
      const label = s.streetName ? `${s.street}, ${s.streetName}` : s.street;
      setAddress(label);
      const details = await fetchPlaceDetails(s.placeId);
      const hasCoords = !!details;
      const basePoint = details ? { lat: details.lat, lon: details.lon } : null;
      baseDestRef.current = basePoint;
      setDest(basePoint);
      setDestExact(hasCoords);
      // Κρατάμε ΟΛΟ το κείμενο ως «δρόμο»: έτσι το onAddressChange το αναγνωρίζει
      // και δεν σβήνει τις συντεταγμένες αν ο χρήστης προσθέσει κάτι (π.χ. όροφο).
      destStreetRef.current = hasCoords ? label : null;
      destIsPlaceRef.current = hasCoords;
      return;
    }

    // ── ΟΔΟΣ ──
    destIsPlaceRef.current = false;
    // Κρατάμε τον αριθμό που είχε ήδη γράψει ο χρήστης — ένα πεδίο, μία κίνηση.
    const { number } = splitAddress(address);
    setAddress(number ? `${s.street} ${number}` : `${s.street} `);
    // Η πρόταση είναι σημείο ΔΡΟΜΟΥ· γίνεται ακριβής μόνο αν λυθεί ο αριθμός.
    setDestExact(false);
    const details = await fetchPlaceDetails(s.placeId);
    const hasCoords = !!details;
    const basePoint = details ? { lat: details.lat, lon: details.lon } : null;
    baseDestRef.current = basePoint;
    setDest(basePoint);
    // Θυμόμαστε τον δρόμο ώστε το επόμενο onChange (π.χ. πληκτρολόγηση αριθμού)
    // να ξέρει ότι οι συντεταγμένες εξακολουθούν να ισχύουν.
    destStreetRef.current = hasCoords ? s.street : null;

    if (hasCoords && number) {
      resolveNumberPoint(s.street, number).then((ov) => {
        if (ov && destStreetRef.current === s.street) {
          setDest(ov);
          setDestExact(true);
        }
      });
    }
  };

  // Εφαρμογή διεύθυνσης από τον επιλογέα — είτε αποθηκευμένη, είτε πινέζα χάρτη.
  const applyPicked = (a: { address: string; lat: number | null; lon: number | null; alreadySaved: boolean }) => {
    setAddress(a.address);
    const hasCoords = a.lat != null && a.lon != null;
    const basePoint = hasCoords ? { lat: a.lat!, lon: a.lon! } : null;
    baseDestRef.current = basePoint;
    setDest(basePoint);
    // Αποθηκευμένη διεύθυνση ή πινέζα χάρτη: το σημείο το όρισε ΑΝΘΡΩΠΟΣ, άρα
    // είναι ό,τι ακριβέστερο έχουμε — δεν το σημαδεύουμε ποτέ ως προσεγγιστικό.
    setDestExact(hasCoords);
    destIsPlaceRef.current = false;
    // Ίδιο κόλπο με το selectSuggestion: θυμόμαστε τον δρόμο ώστε μια μετέπειτα
    // προσθήκη αριθμού να μη σβήσει τις συντεταγμένες.
    destStreetRef.current = hasCoords ? splitAddress(a.address).street : null;
    setSuggestions([]);
    setShowSuggestions(false);
  };

  // ── Απόσταση / χρέωση της τρέχουσας διεύθυνσης ──
  // ΟΔΙΚΗ απόσταση μέσω δρόμων (Geoapify Routing) με άμεσο fallback στην ευθεία:
  // το badge δείχνει αμέσως έναν αριθμό και τον αναβαθμίζει μόλις γυρίσει η
  // διαδρομή. Ό,τι δείχνει το badge είναι ΚΑΙ ό,τι αποθηκεύεται στην παραγγελία.
  const distance = useRoadDistance(origin, dest);
  const distanceKm = distance.km;
  const surcharge = distanceKm !== null ? surchargeFor(distanceKm) : 0;
  const tooFar = distanceKm !== null && distanceKm > MAX_DISTANCE_KM;

  const effectiveDelay =
    delayMinutes === -1
      ? parseInt(customDelay, 10) || 0
      : delayMinutes === -2
      ? clockTimeDelayMinutes(scheduledTime)
      : delayMinutes;

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

    // Η οδική απόσταση είναι ακόμα στον αέρα. Μισό δευτερόλεπτο αναμονής είναι
    // προτιμότερο από παραγγελία χρεωμένη με την (μικρότερη) ευθεία. Δεν κολλάει
    // ποτέ: το useRoadDistance έχει πλαφόν 5s και μετά πέφτει στην ευθεία.
    if (distance.loading) {
      toast.info('Υπολογίζεται η διαδρομή — μια στιγμή.');
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

    if (delayMinutes === -2) {
      if (!scheduledTime) {
        toast.error('Επιλέξτε ώρα αποστολής.');
        return;
      }
      if (effectiveDelay <= 0) {
        toast.error('Η ώρα που επιλέξατε έχει ήδη περάσει.');
        return;
      }
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
      // Ο ΚΩΔΙΚΟΣ ΣΤΗΝ ΟΘΟΝΗ, όχι μόνο στην κονσόλα. Στις 30/07/2026 έπεσε η
      // αποστολή παραγγελιών και χάθηκε μια ώρα σε εικασίες, επειδή το μόνο
      // στοιχείο ήταν ένα γενικό «δοκιμάστε ξανά»: μέσα στο μαγαζί κανείς δεν
      // ανοίγει F12 τη στιγμή που τρέχει η βάρδια. Με τον κωδικό ορατό, ο
      // μαγαζάτορας τον διαβάζει στο τηλέφωνο και η διάγνωση είναι άμεση
      // (42501/PGRST301 = RLS, 23502/23514 = constraint, 5xx = δίκτυο).
      const code = error.code || 'άγνωστος';
      toast.error(`Αποτυχία δημιουργίας παραγγελίας. Δοκιμάστε ξανά. (κωδικός: ${code})`);
    } else {
      setAddress('');
      setComments('');
      setPaymentMethod('cash');
      setDest(null);
      setDestExact(false);
      destStreetRef.current = null;
      destIsPlaceRef.current = false;
      setDelayMinutes(0);
      setCustomDelay('');
      setScheduledTime('');
      setSuggestions([]);
      setShowSuggestions(false);
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
        className="p-6 rounded-2xl card-surface"
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
        {/* Το badge μένει ΜΟΝΤΑΡΙΣΜΕΝΟ και όσο υπολογίζεται: αν εμφανιζόταν μόνο
            με έτοιμο αριθμό, θα «πεταγόταν» στη σελίδα και θα μετακινούσε τα
            πεδία από κάτω — δηλαδή ίδια εντύπωση αστάθειας με τον αριθμό που
            άλλαζε. Ουδέτερο χρώμα όσο δεν ξέρουμε αν υπάρχει χρέωση. */}
        {(distanceKm !== null || distance.loading) && (
          <div
            className="mt-2 mb-1 flex items-center flex-wrap gap-x-3 gap-y-1 px-3 py-2 rounded-xl text-xs font-semibold"
            style={
              distance.loading
                ? { backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }
                : tooFar
                ? { backgroundColor: 'var(--danger-bg)', border: '1px solid var(--danger-border)', color: 'var(--danger)' }
                : surcharge > 0
                ? { backgroundColor: 'var(--warning-bg)', border: '1px solid var(--warning-border)', color: 'var(--warning)' }
                : { backgroundColor: 'var(--success-bg)', border: '1px solid var(--success-border)', color: 'var(--success)' }
            }
          >
            <span className="inline-flex items-center gap-1.5">
              {distance.loading ? (
                <Route className="w-3.5 h-3.5 opacity-60" />
              ) : tooFar ? (
                <AlertTriangle className="w-3.5 h-3.5" />
              ) : (
                <Route className="w-3.5 h-3.5" />
              )}
              {/* ΚΑΜΙΑ τιμή όσο υπολογίζεται — ποτέ η ευθεία ως «προσωρινή». */}
              {distance.loading ? 'Υπολογισμός διαδρομής…' : formatKm(distanceKm)}
              {/* Ποια απόσταση βλέπει το μαγαζί: οδική ή (εφεδρικά) ευθεία.
                  Χρεώνεται αυτό που γράφει εδώ, οπότε δεν το κρύβουμε. */}
              {!distance.loading && (
                <span className="font-normal opacity-70">
                  {distance.source === 'road'
                    ? `· οδικά${distance.minutes !== null ? ` · ~${distance.minutes}′` : ''}`
                    : '· σε ευθεία'}
                </span>
              )}
              {/* Ο ΑΡΙΘΜΟΣ ΔΕΝ ΒΡΕΘΗΚΕ: το σημείο είναι του δρόμου, όχι του κτιρίου.
                  Σε δρόμο 2 χλμ (π.χ. Κ. Καραμανλή) αυτό είναι έως 2 χλμ σφάλμα και
                  έως 3,90 € λάθος χρέωση. Επειδή χρεώνεται ό,τι γράφει το badge,
                  η ανακρίβεια πρέπει να είναι ΟΡΑΤΗ — όχι σιωπηλή. */}
              {!distance.loading && !destExact && dest !== null && splitAddress(address).number && (
                <span className="font-normal opacity-70">· κατά προσέγγιση</span>
              )}
            </span>
            {/* Όσο υπολογίζεται ΔΕΝ λέμε τίποτα για χρέωση: με km = null το
                surcharge είναι 0, οπότε θα γράφαμε «Χωρίς επιπλέον χρέωση» σε
                μια διεύθυνση που μπορεί να καταλήξει χρεώσιμη. */}
            {distance.loading ? null : tooFar ? (
              <span>Πάνω από το όριο των {MAX_DISTANCE_KM} χλμ — δεν επιτρέπεται</span>
            ) : surcharge > 0 ? (
              <span>Επιπλέον χρέωση {formatEuro(surcharge)}</span>
            ) : (
              <span>Χωρίς επιπλέον χρέωση</span>
            )}
          </div>
        )}

        {/* Η αποθήκευση διεύθυνσης ΔΕΝ προτείνεται εδώ (απόφαση χρήστη): το inline
            κουμπί εμφανιζόταν σε κάθε πληκτρολόγηση οδού και ενοχλούσε στη ροή
            της παραγγελίας. Ζει αποκλειστικά στον AddressPicker, όπου υπάρχει
            ολόκληρη οθόνη γι' αυτό (λίστα, ονομασία, διαγραφή, πινέζα χάρτη). */}

        {/* Attribution (απαιτεί η Google όταν εμφανίζονται τα δεδομένα της χωρίς το δικό της UI widget) */}
        <p className="mb-4 text-[10px]" style={{ color: 'var(--text-muted)' }}>
          Προτάσεις διευθύνσεων: Google
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
            <button
              type="button"
              onClick={() => setDelayMinutes(-2)}
              className="flex-1 py-2 rounded-lg text-xs font-semibold transition-all duration-200"
              style={
                delayMinutes === -2
                  ? { background: 'linear-gradient(135deg, var(--accent), var(--accent-hover))', color: '#fff' }
                  : { color: 'var(--text-secondary)', backgroundColor: 'transparent' }
              }
            >
              Ώρα
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
          {delayMinutes === -2 && (
            <input
              type="time"
              placeholder="Ώρα αποστολής"
              value={scheduledTime}
              onChange={(e) => setScheduledTime(e.target.value)}
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
