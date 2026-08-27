'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { isReadOnly } from './lib/supabase';

// READ-ONLY-ON-FAILOVER: όταν το σύστημα τρέχει στο εφεδρικό datacenter (standby),
// οι νέες εγγραφές είναι προσωρινά κλειστές ώστε να μην αποκλίνουν τα δεδομένα.
// Ελέγχουμε μετά το mount (το ενεργό backend έρχεται από localStorage), όπως το chip.
export default function ReadOnlyBanner() {
  const [readOnly, setReadOnly] = useState(false);

  useEffect(() => {
    setReadOnly(isReadOnly());
  }, []);

  if (!readOnly) return null;

  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-center"
      style={{
        backgroundColor: 'var(--warning-bg)',
        borderBottom: '1px solid var(--warning-border)',
        color: 'var(--warning)',
      }}
    >
      <AlertTriangle className="w-4 h-4 shrink-0" />
      <span>
        Εφεδρική λειτουργία — προσωρινά <strong>μόνο ανάγνωση</strong>. Οι νέες
        παραγγελίες θα είναι διαθέσιμες μόλις αποκατασταθεί το κύριο σύστημα.
      </span>
    </div>
  );
}
