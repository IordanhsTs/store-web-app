'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { isBackupMode } from './lib/supabase';

// Ενημερωτική μπάρα όταν το σύστημα τρέχει στο εφεδρικό datacenter (standby).
//
// ΔΕΝ σημαίνει περιορισμό: το εφεδρικό δέχεται ΟΛΕΣ τις λειτουργίες (νέες
// παραγγελίες, μηνύματα, τα πάντα), ακριβώς όπως το κύριο. Υπάρχει για να ξέρει
// το κατάστημα ότι το κύριο σύστημα έχει προσωρινό πρόβλημα.
// Ελέγχουμε μετά το mount (το ενεργό backend έρχεται από localStorage), όπως το chip.
export default function BackupModeBanner() {
  const [backupMode, setBackupMode] = useState(false);

  useEffect(() => {
    setBackupMode(isBackupMode());
  }, []);

  if (!backupMode) return null;

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
        Τρέχουμε στο <strong>εφεδρικό σύστημα</strong>. Οι παραγγελίες περνάνε
        κανονικά — τα δεδομένα επιστρέφουν στο κύριο στις 02:00.
      </span>
    </div>
  );
}
