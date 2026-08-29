'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Banknote, CreditCard, MapPin, Send, Clock, BookMarked, CircleCheck, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from './lib/supabase';
import { confirmDialog } from './ConfirmDialog';
import { useStoreOrigin } from './useStoreOrigin';
import { measureRoadDistance, type RoadDistance } from './lib/road-distance';
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

/** Σημείο προορισμού. `exact` = ξέρουμε το κτίριο, όχι απλώς τον δρόμο. */
type DestPoint = { lat: number; lon: number; exact: boolean };

/**
 * Ό,τι ξέρουμε για τον προορισμό ΠΡΙΝ πληρώσουμε γι' αυτόν.
 *
 * Καθώς γράφει ο υπάλληλος δεν ζητάμε ΚΑΝΕΝΑ σημείο από τη Google — κρατάμε
 * μόνο «τι διάλεξε». Η μετατροπή σε συντεταγμένες γίνεται μία φορά, στην
 * αποστολή (βλ. resolveDestination).
 */
type Pending =
  /** Το σημείο το όρισε άνθρωπος (αποθηκευμένη διεύθυνση ή πινέζα χάρτη) — τζάμπα. */
  | { kind: 'picked'; street: string; lat: number; lon: number }
  /** Επιλέχθηκε πρόταση ΟΔΟΥ· ο αριθμός μπορεί να γραφτεί (ή όχι) μετά. */
  | { kind: 'street'; street: string; placeId: string }
  /** Επιλέχθηκε ΚΑΤΑΣΤΗΜΑ (POI) — έχει δικό του ακριβές σημείο, δεν δέχεται αριθμό. */
  | { kind: 'place'; label: string; placeId: string };

const MIN_CHARS = 3;      // δεν ψάχνουμε πριν από τόσα γράμματα (όσα δέχεται και το API route)
const DEBOUNCE_MS = 200;  // περιμένουμε να σταματήσει το πληκτρολόγιο
// Πόσο περιμένουμε ΑΦΟΥ σταματήσει το πληκτρολόγιο πριν πούμε «διάλεξε από τη
// λίστα». Στο πρώτο γράμμα η προειδοποίηση είναι απλώς ενοχλητική — καμία
// διεύθυνση δεν είναι επιβεβαιωμένη τόσο νωρίς. Εμφανίζεται μόνο όταν ο
// υπάλληλος όντως κοντοσταθεί (απόφαση χρήστη 29/8/2026).
const HINT_DELAY_MS = 5000;
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
  // 'measuring' = τρέχει η ΜΙΑ ανάλυση/μέτρηση της αποστολής, 'saving' = γράφουμε.
  const [phase, setPhase] = useState<'idle' | 'measuring' | 'saving'>('idle');
  const busy = phase !== 'idle';

  // ── Ο ΥΠΟΛΟΓΙΣΜΟΣ ΓΙΝΕΤΑΙ ΜΟΝΟ ΣΤΗΝ ΑΠΟΣΤΟΛΗ ───────────────────────────────
  // Παλιότερα το σημείο ζητιόταν ζωντανά, όσο γραφόταν η διεύθυνση, με ένα
  // παράθυρο αναμονής 3 δευτερολέπτων ώστε ο αριθμός που ακολουθεί να ακυρώνει
  // την κλήση για τον σκέτο δρόμο. Στην πράξη ο υπάλληλος αργεί συχνά πάνω από
  // αυτό (κοιτάζει σημείωμα, ρωτάει τον πελάτη), οπότε πληρώναμε ΔΥΟ φορές την
  // ίδια διεύθυνση: μία για το σημείο του δρόμου και μία για το σημείο του
  // αριθμού — και δύο φορές το routing του Geoapify από πάνω.
  //
  // Τώρα, ό,τι κοστίζει γίνεται ΜΙΑ φορά, στο πάτημα της «Αποστολής». Ό,τι
  // πληκτρολογείται πριν είναι δωρεάν (autocomplete μέσα στο ίδιο session token).
  // Το τίμημα: η απόσταση δεν φαίνεται πια όσο γράφεται η διεύθυνση — φαίνεται
  // στον διάλογο χρέωσης και στο μήνυμα επιτυχίας.
  const pendingRef = useRef<Pending | null>(null);
  // Καθρέφτης του pendingRef για το UI: «έχει η διεύθυνση σημείο στον χάρτη;».
  // Χρειάζεται ξεχωριστό state γιατί το ref δεν προκαλεί render — και από αυτό
  // κρέμεται ΟΛΗ η ένδειξη επιβεβαίωσης δίπλα στο πεδίο. Δεν κοστίζει τίποτα:
  // δείχνει τι διάλεξε ο χρήστης, όχι τι απάντησε η Google.
  const [confirmed, setConfirmed] = useState(false);
  const setPending = useCallback((p: Pending | null) => {
    pendingRef.current = p;
    setConfirmed(p !== null);
  }, []);
  // Η προειδοποίηση περιμένει· η πράσινη επιβεβαίωση όχι (δεν ενοχλεί κανέναν).
  const [showHint, setShowHint] = useState(false);
  // Το αποτέλεσμα της ΤΕΛΕΥΤΑΙΑΣ ανάλυσης, κλειδωμένο στο ακριβές κείμενο της
  // διεύθυνσης. Χωρίς αυτό, ένα «Ακύρωση» στον διάλογο επιπλέον χρέωσης και ένα
  // δεύτερο πάτημα «Αποστολή» θα ξανάκανε ΚΑΙ ΤΙΣ ΔΥΟ κλήσεις. Κρατάμε και τη
  // μέτρηση διαδρομής, όχι μόνο το σημείο: το /api/route-distance έχει μεν δικό
  // του cache 24ώρου (άρα δεν ξαναχρεώνει), αλλά το round-trip καθυστερεί την
  // αποστολή χωρίς λόγο.
  const resolvedRef = useRef<{
    address: string;
    point: DestPoint | null;
    distance: RoadDistance;
  } | null>(null);

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
    abortRef.current?.abort();
  }, []);

  // Το χρονόμετρο της προειδοποίησης μηδενίζει σε ΚΑΘΕ πλήκτρο, οπότε στην πράξη
  // μετράει «5″ αφότου σταμάτησε να γράφει». Επιβεβαιωμένη διεύθυνση ή άδειο
  // πεδίο την κρύβουν αμέσως. Μόλις εμφανιστεί μένει — το να αναβοσβήνει σε κάθε
  // γράμμα θα ήταν χειρότερο από το να μην εμφανιζόταν καθόλου.
  useEffect(() => {
    if (confirmed || !address.trim()) {
      setShowHint(false);
      return;
    }
    const t = setTimeout(() => setShowHint(true), HINT_DELAY_MS);
    return () => clearTimeout(t);
  }, [address, confirmed]);

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
  // απόσταση, και ένα χειροκίνητο εύρος υπερισχύει ό,τι κι αν πει ο provider.
  //
  // Αν δεν υπάρχει override, ρωτάμε τη Google για «δρόμος αριθμός». ΜΙΑ κλήση
  // καλύπτει ΚΑΙ τις δύο περιπτώσεις: όταν ξέρει τον αριθμό γυρνάει
  // street_address (exact), όταν ΔΕΝ τον ξέρει γυρνάει τον ίδιο τον δρόμο
  // (route) — δηλαδή ακριβώς το σημείο-fallback που θέλαμε, χωρίς να το
  // πληρώσουμε ξεχωριστά. Γι' αυτό επιστρέφουμε και το `exact`.
  const resolveNumberPoint = async (
    street: string,
    numberStr: string
  ): Promise<DestPoint | null> => {
    const n = parseInt(numberStr, 10);
    if (!Number.isFinite(n)) return null;

    const { data, error } = await supabase.rpc('resolve_street_segment', {
      p_street: street,
      p_number: n,
    });
    if (!error && data && data.length > 0) {
      const row = data[0];
      if (typeof row.latitude === 'number' && typeof row.longitude === 'number') {
        return { lat: row.latitude, lon: row.longitude, exact: true };
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
      if (details) return { lat: details.lat, lon: details.lon, exact: details.exact };
    } catch {}

    return null;
  };

  /**
   * Ισχύει ακόμα η επιλογή που κρατάμε, για το κείμενο που βλέπουμε τώρα;
   *
   * Ο κανόνας δεν είναι «άλλαξε το κείμενο» αλλά «άλλαξε ο ΔΡΟΜΟΣ»: η ροή
   * χρήσης είναι «διάλεξε δρόμο από το dropdown, ΜΕΤΑ πληκτρολόγησε αριθμό»,
   * οπότε ο αριθμός δεν πρέπει να ακυρώνει την επιλογή.
   */
  const stillMatches = (p: Pending, value: string): boolean => {
    // Κατάστημα (POI): κρατάμε ΟΛΟ το κείμενο ως ταυτότητα, ώστε μια προσθήκη
    // (π.χ. «, 2ος όροφος») να μη σβήνει την επιλογή.
    if (p.kind === 'place') return norm(value).startsWith(norm(p.label));
    return norm(splitAddress(value).street) === norm(p.street);
  };

  /**
   * Μετατρέπει την επιλογή του χρήστη σε συντεταγμένες ΚΑΙ μετράει τη διαδρομή.
   * ΕΔΩ ΞΟΔΕΥΟΥΜΕ — και μόνο εδώ. Καλείται μία φορά ανά αποστολή, με το
   * αποτέλεσμα κλειδωμένο στο κείμενο της διεύθυνσης ώστε ένα δεύτερο πάτημα
   * (π.χ. μετά από «Ακύρωση» στον διάλογο χρέωσης) να μην ξαναξοδεύει.
   *
   * Fail-open παντού: χωρίς σημείο η παραγγελία περνά αχρέωτη — καλύτερα από
   * μπλοκαρισμένο μαγαζί.
   */
  const resolveAndMeasure = async (
    fullAddress: string
  ): Promise<{ point: DestPoint | null; distance: RoadDistance }> => {
    const cached = resolvedRef.current;
    if (cached && cached.address === fullAddress) return cached;

    const p = pendingRef.current;
    let point: DestPoint | null = null;

    if (p && stillMatches(p, fullAddress)) {
      if (p.kind === 'picked') {
        // Το όρισε άνθρωπος: ό,τι ακριβέστερο έχουμε, και δωρεάν.
        point = { lat: p.lat, lon: p.lon, exact: true };
      } else if (p.kind === 'place') {
        point = await fetchPlaceDetails(p.placeId);
      } else {
        const { number } = splitAddress(fullAddress);
        point = number
          ? await resolveNumberPoint(p.street, number)
          // Χωρίς αριθμό (χωριό, πλατεία): το σημείο του ίδιου του δρόμου.
          : await fetchPlaceDetails(p.placeId);

        // ΔΙΧΤΥ ΑΣΦΑΛΕΙΑΣ: ο δρόμος ΕΧΕΙ επιλεγεί από τη λίστα, άρα ξέρουμε
        // σίγουρα ένα σημείο γι' αυτόν — δεν επιτρέπεται μια αποτυχία στην
        // αναζήτηση του ΑΡΙΘΜΟΥ να αφήσει την παραγγελία χωρίς συντεταγμένες
        // (και πλέον να την μπλοκάρει κιόλας, βλ. handleSubmit). Πέφτουμε στο
        // σημείο της οδού, όπως ακριβώς και όταν δεν γράφτηκε καθόλου αριθμός.
        // Κοστίζει ένα δεύτερο Place Details μόνο σε αυτή τη σπάνια περίπτωση.
        if (!point) point = await fetchPlaceDetails(p.placeId);
      }
    }

    const distance = await measureRoadDistance(origin, point);
    resolvedRef.current = { address: fullAddress, point, distance };
    return { point, distance };
  };

  const onAddressChange = (value: string) => {
    setAddress(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    // Ψάχνουμε μόνο το κομμάτι της οδού (χωρίς τον αριθμό).
    const { street } = splitAddress(value);

    // Άλλαξε ο δρόμος → η επιλογή δεν ισχύει πια. Καμία κλήση εδώ: ούτε για να
    // ακυρωθεί κάτι, ούτε για να ζητηθεί κάτι νέο.
    if (pendingRef.current && !stillMatches(pendingRef.current, value)) {
      setPending(null);
    }
    // Η ανάλυση είναι κλειδωμένη σε ΑΚΡΙΒΕΣ κείμενο· μόλις αυτό αλλάξει (π.χ.
    // διορθώθηκε ο αριθμός), το προηγούμενο σημείο δεν ισχύει.
    if (resolvedRef.current && resolvedRef.current.address !== value.trim()) {
      resolvedRef.current = null;
    }

    // Ο ΔΡΟΜΟΣ ΕΧΕΙ ΚΛΕΙΔΩΣΕΙ και ο χρήστης απλώς συμπληρώνει τον αριθμό.
    // Χωρίς αυτό, κάθε ψηφίο ξανάνοιγε το dropdown προτείνοντας τον δρόμο που
    // μόλις διάλεξε — και έπρεπε να πατήσει σε κενό σημείο για να το κλείσει.
    // Το φιλτράρισμα γίνεται ούτως ή άλλως στο κομμάτι της οδού, οπότε η
    // πρόταση ήταν πάντα η ίδια και πάντα άχρηστη.
    if (pendingRef.current) {
      abortRef.current?.abort();
      setSuggestions([]);
      setShowSuggestions(false);
      return;
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

  // Καμία κλήση εδώ. Η επιλογή απλώς καταγράφεται· πληρώνεται στην αποστολή.
  const selectSuggestion = (s: Suggestion) => {
    setSuggestions([]);
    setShowSuggestions(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    // Μια αναζήτηση που έφυγε ΠΡΙΝ το κλικ προλαβαίνει να γυρίσει ΜΕΤΑ από
    // αυτό και να ξανανοίξει το dropdown μόνη της. Την κόβουμε.
    abortRef.current?.abort();
    resolvedRef.current = null;

    // ── ΚΑΤΑΣΤΗΜΑ (π.χ. «Coffee Train») ──
    // Το POI έχει ΔΙΚΕΣ ΤΟΥ ακριβείς συντεταγμένες — δεν είναι σημείο δρόμου,
    // άρα ούτε «κατά προσέγγιση» είναι, ούτε δέχεται αριθμό (το «Coffee Train 5»
    // δεν σημαίνει τίποτα). Στη διεύθυνση γράφουμε όνομα + οδό, γιατί ο
    // διανομέας χρειάζεται και τα δύο για να το βρει.
    if (s.isPlace) {
      const label = s.streetName ? `${s.street}, ${s.streetName}` : s.street;
      setAddress(label);
      setPending({ kind: 'place', label, placeId: s.placeId });
      return;
    }

    // ── ΟΔΟΣ ──
    // Κρατάμε τον αριθμό που είχε ήδη γράψει ο χρήστης — ένα πεδίο, μία κίνηση.
    const { number } = splitAddress(address);
    setAddress(number ? `${s.street} ${number}` : `${s.street} `);
    setPending({ kind: 'street', street: s.street, placeId: s.placeId });
  };

  // Εφαρμογή διεύθυνσης από τον επιλογέα — είτε αποθηκευμένη, είτε πινέζα χάρτη.
  const applyPicked = (a: { address: string; lat: number | null; lon: number | null; alreadySaved: boolean }) => {
    setAddress(a.address);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    abortRef.current?.abort();
    resolvedRef.current = null;
    // Το σημείο το όρισε ΑΝΘΡΩΠΟΣ, άρα είναι ό,τι ακριβέστερο έχουμε — και δεν
    // κοστίζει τίποτα στην αποστολή, γιατί δεν χρειάζεται καμία κλήση.
    setPending(
      a.lat != null && a.lon != null
        ? { kind: 'picked', street: splitAddress(a.address).street, lat: a.lat, lon: a.lon }
        : null
    );
    setSuggestions([]);
    setShowSuggestions(false);
  };

  const effectiveDelay =
    delayMinutes === -1
      ? parseInt(customDelay, 10) || 0
      : delayMinutes === -2
      ? clockTimeDelayMinutes(scheduledTime)
      : delayMinutes;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;

    const fullAddress = address.trim();
    if (!fullAddress) {
      toast.error('Παρακαλώ εισάγετε διεύθυνση παράδοσης.');
      return;
    }

    // Οι ΤΖΑΜΠΑ έλεγχοι πρώτοι: δεν έχει νόημα να πληρώσουμε ανάλυση διεύθυνσης
    // για μια φόρμα που θα κοπεί έτσι κι αλλιώς σε λάθος ώρα αποστολής.
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

    // ── Η ΔΙΕΥΘΥΝΣΗ ΠΡΕΠΕΙ ΝΑ ΕΧΕΙ ΣΗΜΕΙΟ ΣΤΟΝ ΧΑΡΤΗ (αίτημα διαχειριστή) ──────
    // Μέχρι τώρα η φόρμα ήταν fail-open: ελεύθερο κείμενο περνούσε ως παραγγελία
    // χωρίς συντεταγμένες. Στην πράξη αυτό ήταν οι ΜΙΣΕΣ παραγγελίες (54 στις 110
    // τον Αύγουστο 2026) — ο διανομέας δεν είχε πού να πλοηγηθεί και η απόσταση
    // δεν χρεωνόταν ποτέ. Πλέον κόβεται εδώ.
    //
    // Ο έλεγχος είναι ΤΖΑΜΠΑ και μπαίνει ΠΡΙΝ από κάθε πληρωμένη κλήση: κοιτάζει
    // μόνο τι διάλεξε ο χρήστης. Χωρίς επιλογή από τη λίστα / τον χάρτη /
    // αποθηκευμένη, δεν υπάρχει περίπτωση να προκύψει σημείο — άρα δεν έχει
    // κανένα νόημα να ρωτήσουμε τη Google.
    const picked = pendingRef.current;
    if (!picked || !stillMatches(picked, fullAddress)) {
      // Χτύπησε στον τοίχο — η ένδειξη δεν έχει λόγο να περιμένει άλλο.
      setShowHint(true);
      toast.error(
        'Η διεύθυνση δεν έχει επιβεβαιωθεί στον χάρτη. Διαλέξτε μία από τις προτάσεις ' +
        'που εμφανίζονται καθώς γράφετε, ή χρησιμοποιήστε τον χάρτη/τις αποθηκευμένες ' +
        'διευθύνσεις. Αν δεν ξέρετε ακριβή διεύθυνση, γράψτε «Φλώρινα», διαλέξτε την ' +
        'από τη λίστα και βάλτε τα στοιχεία του πελάτη στα Σχόλια.',
        { duration: 10000 }
      );
      return;
    }

    // ── ΕΔΩ, ΚΑΙ ΜΟΝΟ ΕΔΩ, ΞΟΔΕΥΟΥΜΕ ──────────────────────────────────────────
    // Μία ανάλυση σημείου (Google) + μία μέτρηση διαδρομής (Geoapify) ανά
    // παραγγελία, ό,τι κι αν πληκτρολογήθηκε πριν και με όποια σειρά. Και τα δύο
    // αποτελέσματα είναι cached στο κείμενο της διεύθυνσης, ώστε ένα «Ακύρωση»
    // στον διάλογο χρέωσης να μη διπλασιάζει το κόστος στο επόμενο πάτημα.
    setPhase('measuring');
    const { point, distance } = await resolveAndMeasure(fullAddress);
    const distanceKm = distance.km;
    const surcharge = distanceKm !== null ? surchargeFor(distanceKm) : 0;

    // ── Ο χρήστης έκανε τη δουλειά του, το σύστημα απέτυχε ────────────────────
    // Εδώ φτάνουμε ΜΟΝΟ αν είχε επιλεγεί κανονικά διεύθυνση και παρ' όλα αυτά
    // δεν γύρισε σημείο — δηλαδή πρόβλημα δικτύου ή της ίδιας της Google, όχι
    // κακή χρήση. Σκληρό μπλοκ εδώ θα σήμαινε ότι μια βλάβη της Google σταματά
    // ΚΑΘΕ παραγγελία σε ΚΑΘΕ κατάστημα — χειρότερο από το πρόβλημα που λύνουμε.
    // Οπότε ρωτάμε ρητά: η παραγγελία μπορεί να φύγει, αλλά ως συνειδητή πράξη.
    if (!point) {
      setPhase('idle');
      const ok = await confirmDialog(
        'Δεν καταφέραμε να βρούμε το σημείο της διεύθυνσης στον χάρτη (πιθανό πρόβλημα ' +
        'σύνδεσης). Αν σταλεί έτσι, ο διανομέας θα δει μόνο το κείμενο της διεύθυνσης, ' +
        'χωρίς πλοήγηση, και δεν θα υπολογιστεί χρέωση απόστασης.',
        {
          title: 'Η διεύθυνση δεν βρέθηκε στον χάρτη',
          confirmLabel: 'Αποστολή έτσι κι αλλιώς',
          cancelLabel: 'Άκυρο, θα ξαναδοκιμάσω',
        }
      );
      if (!ok) return;
    }

    // ── Όριο 15 χλμ: σκληρό μπλοκ ──
    // Ισχύει ΜΟΝΟ όταν ξέρουμε πραγματικά την απόσταση. Αν λείπουν συντεταγμένες
    // (π.χ. ο χρήστης έγραψε τη διεύθυνση χωρίς να διαλέξει πρόταση) αφήνουμε την
    // παραγγελία να περάσει: καλύτερα μια αχρέωτη παραγγελία από μπλοκαρισμένο μαγαζί.
    if (distanceKm !== null && distanceKm > MAX_DISTANCE_KM) {
      setPhase('idle');
      toast.error(
        `Η διεύθυνση απέχει ${formatKm(distanceKm)} — πάνω από το όριο των ${MAX_DISTANCE_KM} χλμ. Η παραγγελία δεν μπορεί να σταλεί.`
      );
      return;
    }

    // ── Επιπλέον χρέωση: το κατάστημα ΠΡΕΠΕΙ να πατήσει «Συνέχεια» ──
    if (surcharge > 0) {
      // Ο ΑΡΙΘΜΟΣ ΔΕΝ ΒΡΕΘΗΚΕ: το σημείο είναι του δρόμου, όχι του κτιρίου. Σε
      // δρόμο 2 χλμ (π.χ. Κ. Καραμανλή) αυτό είναι έως 2 χλμ σφάλμα και έως
      // 3,90 € λάθος χρέωση. Το λέμε ΕΔΩ, τη στιγμή που παίζονται τα λεφτά.
      const approx =
        point && !point.exact && splitAddress(fullAddress).number
          ? ' Ο αριθμός δεν βρέθηκε στον χάρτη, οπότε η απόσταση είναι κατά προσέγγιση (σημείο του δρόμου).'
          : '';
      setPhase('idle');
      const ok = await confirmDialog(
        `Η διεύθυνση απέχει ${formatKm(distanceKm)}, δηλαδή πάνω από τα ${String(FREE_RADIUS_KM).replace('.', ',')} χλμ. ` +
        `Η παραγγελία χρεώνεται επιπλέον ${formatEuro(surcharge)}.` + approx,
        { title: 'Επιπλέον χρέωση απόστασης', confirmLabel: 'Συνέχεια' }
      );
      if (!ok) return;
    }

    setPhase('saving');

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
      latitude: point?.lat ?? null,
      longitude: point?.lon ?? null,
      distance_km: distanceKm,
      surcharge: distanceKm !== null ? surcharge : null,
    });

    setPhase('idle');

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
      setPending(null);
      resolvedRef.current = null;
      setDelayMinutes(0);
      setCustomDelay('');
      setScheduledTime('');
      setSuggestions([]);
      setShowSuggestions(false);
      // Η απόσταση δεν φαίνεται πια όσο γράφεται η διεύθυνση (βλ. «Ο ΥΠΟΛΟΓΙΣΜΟΣ
      // ΓΙΝΕΤΑΙ ΜΟΝΟ ΣΤΗΝ ΑΠΟΣΤΟΛΗ»), οπότε το μήνυμα επιτυχίας είναι η μόνη
      // ευκαιρία να δει ο μαγαζάτορας με τι χρεώθηκε.
      const charged =
        distanceKm !== null
          ? ` (${formatKm(distanceKm)}${surcharge > 0 ? ` · +${formatEuro(surcharge)}` : ''})`
          : '';
      toast.success(
        scheduledAt
          ? `Η παραγγελία προγραμματίστηκε${charged} — θα σταλεί στους διανομείς σε ${effectiveDelay} λεπτά.`
          : `Η παραγγελία δημιουργήθηκε επιτυχώς!${charged}`
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
                // Πράσινο = έχουμε σημείο στον χάρτη. Η ένδειξη ζει πάνω στο ίδιο
                // το εικονίδιο του πεδίου ώστε να μη χρειάζεται δεύτερη γραμμή
                // κειμένου όταν όλα πάνε καλά (βλ. και το μήνυμα από κάτω).
                color: confirmed ? 'var(--success)' : 'var(--text-muted)',
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

        {/* ── Κατάσταση διεύθυνσης ──
            Η μόνη γραμμή που μπήκε ξανά κάτω από το πεδίο: χωρίς αυτήν, ο
            υπάλληλος μαθαίνει ότι πρέπει να διαλέξει από τη λίστα μόνο όταν του
            κοπεί η αποστολή. Δεν κοστίζει καμία κλήση — δείχνει την επιλογή,
            όχι απάντηση της Google.

            Η πράσινη επιβεβαίωση βγαίνει αμέσως· η πορτοκαλί προειδοποίηση
            περιμένει HINT_DELAY_MS αφότου σταματήσει το πληκτρολόγιο (ή σκάει
            κατευθείαν αν κοπεί η αποστολή). */}
        {address.trim() ? (
          confirmed ? (
            <p className="mt-1.5 text-[11px] flex items-start gap-1.5" style={{ color: 'var(--success)' }}>
              <CircleCheck className="w-3 h-3 shrink-0 mt-[1px]" />
              Η διεύθυνση επιβεβαιώθηκε στον χάρτη.
            </p>
          ) : showHint ? (
            <p className="mt-1.5 text-[11px] flex items-start gap-1.5" style={{ color: 'var(--warning)' }}>
              <TriangleAlert className="w-3 h-3 shrink-0 mt-[1px]" />
              Διαλέξτε διεύθυνση από τη λίστα προτάσεων ή από τον χάρτη.
            </p>
          ) : null
        ) : null}

        {/* Το ζωντανό badge απόστασης αφαιρέθηκε μαζί με τους ζωντανούς
            υπολογισμούς: κάθε φορά που εμφάνιζε αριθμό, κάποιος τον είχε
            πληρώσει. Δεν μπήκε τίποτα στη θέση του (απόφαση χρήστη — έπιανε
            χώρο χωρίς να λέει κάτι): η πραγματική τιμή έρχεται στον διάλογο
            επιπλέον χρέωσης και στο μήνυμα επιτυχίας, και η αναμονή φαίνεται
            πάνω στο ίδιο το κουμπί αποστολής. */}

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
        {/* Το κουμπί ΔΕΝ κλειδώνει πια προληπτικά για απόσταση εκτός ορίου: η
            απόσταση είναι άγνωστη μέχρι να το πατήσει κάποιος. Το όριο των 15 χλμ
            ελέγχεται μέσα στο handleSubmit και κόβει την παραγγελία εκεί. */}
        <button
          type="submit"
          disabled={busy}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-white transition-all duration-200"
          style={{
            background: busy
              ? 'var(--accent-hover)'
              : 'linear-gradient(135deg, var(--accent), var(--accent-hover))',
            boxShadow: busy ? 'none' : '0 4px 16px var(--accent-muted)',
            opacity: busy ? 0.75 : 1,
            cursor: busy ? 'not-allowed' : 'pointer',
          }}
          onMouseEnter={e => {
            if (!busy) {
              (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)';
              (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 8px 24px var(--accent-muted)';
            }
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)';
            (e.currentTarget as HTMLButtonElement).style.boxShadow = busy ? 'none' : '0 4px 16px var(--accent-muted)';
          }}
        >
          {busy ? (
            <>
              <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              {phase === 'measuring' ? 'Υπολογισμός διαδρομής…' : 'Αποστολή...'}
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
