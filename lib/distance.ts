// ── Απόσταση & επιβάρυνση παραγγελίας ───────────────────────────────────────
// Κοινή, καθαρή λογική (χωρίς I/O) που μοιράζονται φόρμα παραγγελίας, αποθηκευμένες
// διευθύνσεις και εμφάνιση. Οι ίδιοι κανόνες υπάρχουν σε delivery-admin
// (src/distance.js) και final-app (src/utils/distance.js) — τα τρία apps είναι
// ξεχωριστά repos χωρίς κοινό package, οπότε η μία μικρή pure function
// αντιγράφεται αντί να στηθεί shared dependency. ΑΝ ΑΛΛΑΞΕΙ ΤΙΜΟΛΟΓΗΣΗ,
// άλλαξέ την και στα άλλα δύο.

/** Πάνω από τόσα χλμ η παραγγελία δεν επιτρέπεται καθόλου (Μαγαζιά #3). */
export const MAX_DISTANCE_KM = 15;

/** Μέχρι τόσα χλμ δεν υπάρχει επιπλέον χρέωση. */
export const FREE_RADIUS_KM = 2.5;

/** Χρέωση ανά 100 μέτρα πέρα από το FREE_RADIUS_KM. */
export const SURCHARGE_PER_100M = 0.1;

/**
 * Απόσταση σε ευθεία γραμμή (Haversine) σε χιλιόμετρα, με ακρίβεια μέτρου.
 *
 * ΔΕΝ είναι πια η απόσταση χρέωσης — αυτή έρχεται οδικά από το Geoapify Routing
 * (βλ. useRoadDistance / app/api/route-distance). Παραμένει όμως κρίσιμη σε τρεις
 * ρόλους, γι' αυτό δεν αφαιρέθηκε:
 *   • ΑΜΕΣΗ τιμή στην οθόνη όσο τρέχει η κλήση routing (0 κόστος, 0 καθυστέρηση)
 *   • fallback όταν το routing αποτύχει — καμία παραγγελία δεν μπλοκάρει
 *   • δωρεάν φραγμός: αν η ευθεία ξεπερνά ήδη το MAX_DISTANCE_KM, η οδική
 *     (πάντα ≥ αυτής) το ξεπερνά σίγουρα, άρα γλιτώνουμε το credit
 */
export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // μέση ακτίνα Γης σε χλμ
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const km = 2 * R * Math.asin(Math.sqrt(a));
  return Math.round(km * 1000) / 1000; // ακρίβεια μέτρου (ταιριάζει με numeric(6,3))
}

/**
 * Επιπλέον χρέωση προς το κατάστημα για απόσταση πάνω από το FREE_RADIUS_KM.
 * Στρογγυλοποίηση ΠΡΟΣ ΤΑ ΚΑΤΩ — χρεώνονται μόνο τα ΣΥΜΠΛΗΡΩΜΕΝΑ 100μ
 * (απόφαση χρήστη): 3,5χλμ → 1,00€ · 3,55χλμ → 1,00€ · 3,6χλμ → 1,10€.
 *
 * Το toFixed(6) πριν το floor ΔΕΝ είναι καλλωπισμός. Σε IEEE-754 το
 * `(2.8 - 2.5) * 10` δίνει 2.999999999999998, που με σκέτο floor γίνεται 2 αντί
 * για 3 — δηλαδή 0,20€ αντί για 0,30€. Ελέγχθηκε ανά μέτρο ως τα 15 χλμ: χωρίς
 * τη σταθεροποίηση υποχρεώνονται 10 αποστάσεις, ανάμεσά τους οι 2,8 / 2,9 / 3,3
 * / 3,8 χλμ — από τις πιο συνηθισμένες σε επαρχιακή πόλη.
 */
export function surchargeFor(distanceKm: number | null | undefined): number {
  if (distanceKm === null || distanceKm === undefined || !Number.isFinite(distanceKm)) return 0;
  const beyond = distanceKm - FREE_RADIUS_KM;
  if (beyond <= 0) return 0;
  const units = Math.floor(Number((beyond * 10).toFixed(6)));
  return Math.round(units * SURCHARGE_PER_100M * 100) / 100;
}

/** «3,4 χλμ» — ελληνικό δεκαδικό κόμμα, 1 δεκαδικό. */
export function formatKm(distanceKm: number | null | undefined): string {
  if (distanceKm === null || distanceKm === undefined || !Number.isFinite(distanceKm)) return '—';
  return `${distanceKm.toFixed(1).replace('.', ',')} χλμ`;
}

/** «1,00 €» */
export function formatEuro(amount: number): string {
  return `${amount.toFixed(2).replace('.', ',')} €`;
}
