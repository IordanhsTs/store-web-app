'use client';

import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import dynamic from 'next/dynamic';
import { Star, MapPin, X, Trash2, Check, Route, Save, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { supabase, getTenantSchema } from './lib/supabase';
import { haversineKm, surchargeFor, formatKm, formatEuro, MAX_DISTANCE_KM } from './lib/distance';

// Το Leaflet αγγίζει το `window` — μόνο στον browser.
const AddressPickerMap = dynamic(() => import('./AddressPickerMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full animate-pulse" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
  ),
});

export type SavedAddress = {
  id: string;
  label: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  distance_km: number | null;
  surcharge: number | null;
};

type LatLng = { lat: number; lon: number };

// Έσχατο fallback κέντρου χάρτη (Φλώρινα) — χρησιμοποιείται μόνο αν λείπουν ΚΑΙ οι
// συντεταγμένες του καταστήματος ΚΑΙ το map_center της εταιρίας.
const FALLBACK_CENTER: LatLng = { lat: 40.7819, lon: 21.4098 };

interface Props {
  isOpen: boolean;
  onClose: () => void;
  saved: SavedAddress[];
  origin: LatLng | null;
  /** Ό,τι έχει ήδη γράψει ο χρήστης στη φόρμα — προσυμπληρώνει την περιγραφή. */
  currentAddress: string;
  maxSaved: number;
  onApply: (a: { address: string; lat: number | null; lon: number | null }) => void;
  onDeleted: () => void;
  onSaved: () => void;
  storeId: string;
}

export default function AddressPicker({
  isOpen, onClose, saved, origin, currentAddress, maxSaved, onApply, onDeleted, onSaved, storeId,
}: Props) {
  const [tab, setTab] = useState<'saved' | 'map'>('saved');
  const [pin, setPin] = useState<LatLng | null>(null);
  const [mapAddress, setMapAddress] = useState('');
  const [saveLabel, setSaveLabel] = useState('');
  const [companyCenter, setCompanyCenter] = useState<LatLng | null>(null);
  const [busy, setBusy] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  // Άνοιγμα: ξεκινάμε από την καρτέλα που έχει νόημα — αν δεν υπάρχουν
  // αποθηκευμένες, ο χάρτης είναι το μόνο χρήσιμο.
  useEffect(() => {
    if (!isOpen) return;
    setTab(saved.length > 0 ? 'saved' : 'map');
    setPin(null);
    setMapAddress(currentAddress.trim());
    setSaveLabel('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Κέντρο εταιρίας ως εφεδρικό, μόνο όταν λείπει η θέση του καταστήματος.
  useEffect(() => {
    if (!isOpen || origin || companyCenter) return;
    (async () => {
      try {
        const { data } = await supabase
          .schema('public')
          .from('companies')
          .select('map_center')
          .eq('schema_name', getTenantSchema())
          .maybeSingle();
        if (data?.map_center) {
          const [lat, lon] = String(data.map_center).split(',').map(Number);
          if (Number.isFinite(lat) && Number.isFinite(lon)) setCompanyCenter({ lat, lon });
        }
      } catch { /* μένει το fallback */ }
    })();
  }, [isOpen, origin, companyCenter]);

  const center = origin ?? companyCenter ?? FALLBACK_CENTER;

  const pinDistance = useMemo(
    () => (origin && pin ? haversineKm(origin.lat, origin.lon, pin.lat, pin.lon) : null),
    [origin, pin]
  );
  const pinSurcharge = pinDistance !== null ? surchargeFor(pinDistance) : 0;
  const pinTooFar = pinDistance !== null && pinDistance > MAX_DISTANCE_KM;

  if (!isOpen || !mounted) return null;

  const applySaved = (a: SavedAddress) => {
    onApply({ address: a.address, lat: a.latitude, lon: a.longitude });
    onClose();
  };

  const handleDelete = async (a: SavedAddress) => {
    const { error } = await supabase.from('saved_addresses').delete().eq('id', a.id);
    if (error) {
      toast.error('Αποτυχία διαγραφής.');
      return;
    }
    toast.success(`Διαγράφηκε «${a.label}».`);
    onDeleted();
  };

  const confirmPin = async () => {
    const addr = mapAddress.trim();
    if (!pin) {
      toast.error('Τοποθετήστε πινέζα στον χάρτη.');
      return;
    }
    if (!addr) {
      toast.error('Γράψτε μια περιγραφή για να ξέρει ο διανομέας πού πάει.');
      return;
    }
    if (pinTooFar) {
      toast.error(`Το σημείο απέχει ${formatKm(pinDistance)} — πάνω από το όριο των ${MAX_DISTANCE_KM} χλμ.`);
      return;
    }

    // Προαιρετική αποθήκευση για μελλοντική χρήση
    const label = saveLabel.trim();
    if (label) {
      if (saved.length >= maxSaved) {
        toast.error(`Όριο ${maxSaved} αποθηκευμένων διευθύνσεων — διαγράψτε κάποια πρώτα.`);
        return;
      }
      setBusy(true);
      const { error } = await supabase.from('saved_addresses').insert({
        store_id: storeId,
        label,
        address: addr,
        latitude: pin.lat,
        longitude: pin.lon,
        distance_km: pinDistance,
        surcharge: pinDistance !== null ? pinSurcharge : null,
      });
      setBusy(false);
      if (error) {
        toast.error(
          error.code === '23505'
            ? 'Υπάρχει ήδη αποθηκευμένη διεύθυνση με αυτό το όνομα.'
            : 'Αποτυχία αποθήκευσης.'
        );
        return;
      }
      toast.success(`Αποθηκεύτηκε ως «${label}».`);
      onSaved();
    }

    onApply({ address: addr, lat: pin.lat, lon: pin.lon });
    onClose();
  };

  const inputStyle = {
    backgroundColor: 'var(--bg-input)',
    border: '1.5px solid var(--border-default)',
    color: 'var(--text-primary)',
    borderRadius: 'var(--radius-md)',
    outline: 'none',
    width: '100%',
    padding: '10px 14px',
    fontSize: '14px',
  };

  const tabStyle = (active: boolean) =>
    active
      ? { background: 'linear-gradient(135deg, var(--accent), var(--accent-hover))', color: '#fff' }
      : { color: 'var(--text-secondary)', backgroundColor: 'transparent' };

  // PORTAL — ΜΗΝ ΤΟ ΑΦΑΙΡΕΣΕΙΣ: η στήλη της φόρμας (app/page.tsx) έχει
  // `animate-fade-in-up`, δηλαδή animation με `transform` και `forwards`. Το
  // transform μένει μόνιμα και κάνει τη στήλη containing block για κάθε `fixed`
  // απόγονο — χωρίς portal το παράθυρο κλειδώνεται στο πλάτος της στήλης και το
  // backdrop σκεπάζει μόνο αυτήν.
  //
  // Οι διαστάσεις γράφονται ως w/max-w και όχι ως `md:w-[min(95vw,1100px)]`:
  // το `min()` μέσα σε arbitrary value ΔΕΝ παράγεται από το Tailwind και έπεφτε
  // σιωπηλά πίσω στο `w-full`. Το ζεύγος w + max-w είναι ισοδύναμο.
  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-stretch md:items-center md:justify-center md:p-4">
      <div className="absolute inset-0 backdrop-blur-sm bg-black/50 animate-fade-in" onClick={onClose} />

      {/* Στο κινητό γεμίζει την οθόνη — ο χάρτης θέλει χώρο και τα πεδία δεν
          πρέπει να κόβονται. Σε desktop γίνεται φαρδύ πάνελ δύο στηλών, στο ίδιο
          ύφος με το παράθυρο Στατιστικών. */}
      <div
        className="relative w-full h-full md:w-[95vw] md:max-w-[1100px] md:h-[90vh] md:max-h-[700px] md:rounded-2xl animate-scale-in overflow-hidden flex flex-col backdrop-blur-xl backdrop-saturate-150"
        style={{
          backgroundColor: 'var(--nav-bg)',
          border: '1px solid var(--nav-border)',
          boxShadow: 'var(--shadow-xl)',
        }}
      >
        {/* Κεφαλίδα */}
        <div className="flex items-center justify-between gap-3 p-4 border-b shrink-0" style={{ borderColor: 'var(--border-subtle)' }}>
          <h3 className="text-base font-bold m-0" style={{ color: 'var(--text-primary)' }}>
            Επιλογή διεύθυνσης
          </h3>
          <button type="button" onClick={onClose} className="p-1 rounded-lg" style={{ color: 'var(--text-muted)' }} aria-label="Κλείσιμο">
            <X size={18} />
          </button>
        </div>

        {/* Καρτέλες */}
        <div className="flex gap-1.5 p-1 m-3 rounded-xl shrink-0" style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-subtle)' }}>
          <button
            type="button"
            onClick={() => setTab('saved')}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold transition-all"
            style={tabStyle(tab === 'saved')}
          >
            <Star className="w-3.5 h-3.5" />
            Αποθηκευμένες ({saved.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('map')}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold transition-all"
            style={tabStyle(tab === 'map')}
          >
            <MapPin className="w-3.5 h-3.5" />
            Επιλογή στον χάρτη
          </button>
        </div>

        <div className="flex-1 min-h-0 flex flex-col">
          {/* ── ΚΑΡΤΕΛΑ: ΑΠΟΘΗΚΕΥΜΕΝΕΣ ── */}
          {tab === 'saved' && (
            <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
            {saved.length === 0 ? (
              <div className="py-10 text-center">
                <Star className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
                <p className="text-sm font-semibold m-0" style={{ color: 'var(--text-primary)' }}>
                  Καμία αποθηκευμένη διεύθυνση
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {saved.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center gap-2 p-2.5 rounded-xl"
                    style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-subtle)' }}
                  >
                    <button
                      type="button"
                      onClick={() => applySaved(a)}
                      className="flex-1 min-w-0 text-left"
                    >
                      <div className="flex items-center gap-1.5">
                        <Star className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent)' }} />
                        <span className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{a.label}</span>
                        {a.distance_km !== null && (
                          <span
                            className="text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0"
                            style={a.surcharge
                              ? { color: 'var(--warning)', backgroundColor: 'var(--warning-bg)' }
                              : { color: 'var(--text-muted)', backgroundColor: 'var(--bg-tertiary)' }}
                          >
                            {formatKm(a.distance_km)}{a.surcharge ? ` · +${formatEuro(a.surcharge)}` : ''}
                          </span>
                        )}
                      </div>
                      <div className="text-xs truncate mt-0.5" style={{ color: 'var(--text-muted)' }}>{a.address}</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(a)}
                      className="p-1.5 rounded-lg shrink-0"
                      style={{ color: 'var(--danger)' }}
                      title="Διαγραφή"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            </div>
          )}

          {/* ── ΚΑΡΤΕΛΑ: ΧΑΡΤΗΣ ── */}
          {/* Κινητό: χάρτης πάνω, πεδία από κάτω, κουμπί καρφωμένο στον πάτο.
              Desktop: χάρτης αριστερά σε όλο το ύψος, πεδία στήλη δεξιά. */}
          {tab === 'map' && (
            <div className="flex-1 min-h-0 flex flex-col md:flex-row gap-3 px-4 pb-4">
              <div
                className="h-[38vh] md:h-auto md:flex-1 shrink-0 md:shrink rounded-xl overflow-hidden border"
                style={{ borderColor: 'var(--border-subtle)' }}
              >
                <AddressPickerMap center={center} origin={origin} pin={pin} onPick={setPin} />
              </div>

              <div className="flex-1 min-h-0 md:flex-none md:w-[340px] flex flex-col">
                <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-0.5">
                  {/* Ζωντανή απόσταση/χρέωση της πινέζας */}
                  {pin && (
                    <div
                      className="flex items-center flex-wrap gap-x-3 gap-y-1 px-3 py-2 rounded-xl text-xs font-semibold"
                      style={
                        pinTooFar
                          ? { backgroundColor: 'var(--danger-bg)', border: '1px solid var(--danger-border)', color: 'var(--danger)' }
                          : pinSurcharge > 0
                          ? { backgroundColor: 'var(--warning-bg)', border: '1px solid var(--warning-border)', color: 'var(--warning)' }
                          : { backgroundColor: 'var(--success-bg)', border: '1px solid var(--success-border)', color: 'var(--success)' }
                      }
                    >
                      <span className="inline-flex items-center gap-1.5">
                        {pinTooFar ? <AlertTriangle className="w-3.5 h-3.5" /> : <Route className="w-3.5 h-3.5" />}
                        {formatKm(pinDistance)}
                      </span>
                      <span>
                        {pinTooFar
                          ? `Πάνω από το όριο των ${MAX_DISTANCE_KM} χλμ`
                          : pinSurcharge > 0
                          ? `Επιπλέον χρέωση ${formatEuro(pinSurcharge)}`
                          : 'Χωρίς επιπλέον χρέωση'}
                      </span>
                    </div>
                  )}

                  {!origin && (
                    <p className="text-[11px] m-0" style={{ color: 'var(--warning)' }}>
                      Το κατάστημα δεν έχει θέση στον χάρτη — δεν υπολογίζεται απόσταση.
                    </p>
                  )}

                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                      Περιγραφή διεύθυνσης <span className="normal-case font-normal">(τη βλέπει ο διανομέας)</span>
                    </label>
                    <input
                      type="text"
                      value={mapAddress}
                      onChange={(e) => setMapAddress(e.target.value)}
                      placeholder="π.χ. Πίσω από το γήπεδο, κίτρινη πόρτα"
                      style={inputStyle}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                      Αποθήκευση με όνομα <span className="normal-case font-normal">(προαιρετικό)</span>
                    </label>
                    <input
                      type="text"
                      value={saveLabel}
                      onChange={(e) => setSaveLabel(e.target.value)}
                      placeholder="π.χ. LIDL"
                      style={inputStyle}
                    />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={confirmPin}
                  disabled={busy || !pin || pinTooFar}
                  className="shrink-0 mt-3 w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-white transition-all"
                  style={{
                    background: !pin || pinTooFar ? 'var(--text-muted)' : 'linear-gradient(135deg, var(--accent), var(--accent-hover))',
                    opacity: busy ? 0.75 : 1,
                    cursor: !pin || pinTooFar ? 'not-allowed' : 'pointer',
                  }}
                >
                  {saveLabel.trim() ? <Save className="w-4 h-4" /> : <Check className="w-4 h-4" />}
                  {saveLabel.trim() ? 'Αποθήκευση και χρήση' : 'Χρήση αυτού του σημείου'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
