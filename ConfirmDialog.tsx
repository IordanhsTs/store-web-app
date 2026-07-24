'use client';

import { useEffect, useState, useCallback } from 'react';
import { AlertTriangle } from 'lucide-react';

type DialogOptions = {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  alertOnly?: boolean; // κρύβει το κουμπί ακύρωσης — μόνο "OK"
};

type DialogRequest = Required<Omit<DialogOptions, 'danger' | 'alertOnly'>> &
  Pick<DialogOptions, 'danger' | 'alertOnly'> & {
    message: string;
    resolve: (result: boolean) => void;
  };

// Promise-based αντικαταστάτης των native confirm()/alert(), styled με τα CSS variables
// του store-web-app. Μόνο ένα αίτημα εκκρεμεί κάθε φορά — mount το <ConfirmDialogHost />
// μία φορά στο root layout και κάλεσε confirmDialog()/alertDialog() από οπουδήποτε.
let listener: ((req: DialogRequest) => void) | null = null;

export function confirmDialog(message: string, options: DialogOptions = {}): Promise<boolean> {
  return new Promise((resolve) => {
    listener?.({
      message,
      title: options.title ?? 'Επιβεβαίωση',
      confirmLabel: options.confirmLabel ?? 'Επιβεβαίωση',
      cancelLabel: options.cancelLabel ?? 'Ακύρωση',
      danger: options.danger,
      alertOnly: options.alertOnly,
      resolve,
    });
  });
}

export function alertDialog(message: string, options: Omit<DialogOptions, 'cancelLabel' | 'alertOnly'> = {}): Promise<void> {
  return confirmDialog(message, { ...options, confirmLabel: options.confirmLabel ?? 'Το είδα (ΟΚ)', alertOnly: true }).then(() => undefined);
}

export default function ConfirmDialogHost() {
  const [request, setRequest] = useState<DialogRequest | null>(null);

  useEffect(() => {
    listener = setRequest;
    return () => { listener = null; };
  }, []);

  const close = useCallback((result: boolean) => {
    setRequest((current) => {
      current?.resolve(result);
      return null;
    });
  }, []);

  if (!request) return null;

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 backdrop-blur-sm bg-black/40 animate-fade-in"
        onClick={() => close(false)}
      />
      <div
        role="alertdialog"
        aria-modal="true"
        className="relative w-full max-w-sm p-5 rounded-2xl shadow-2xl animate-scale-in"
        style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-default)' }}
      >
        <div className="flex items-start gap-3 mb-5">
          <AlertTriangle
            size={20}
            className="shrink-0 mt-0.5"
            style={{ color: request.danger ? 'var(--danger)' : 'var(--accent)' }}
          />
          <div>
            <h3 className="font-bold text-base mb-1" style={{ color: 'var(--text-primary)' }}>
              {request.title}
            </h3>
            <p className="text-sm m-0" style={{ color: 'var(--text-secondary)' }}>
              {request.message}
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          {!request.alertOnly && (
            <button
              type="button"
              onClick={() => close(false)}
              className="px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
              style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
            >
              {request.cancelLabel}
            </button>
          )}
          <button
            type="button"
            onClick={() => close(true)}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white transition-colors"
            style={{
              background: request.danger
                ? 'var(--danger)'
                : 'linear-gradient(135deg, var(--accent), var(--accent-hover))',
            }}
          >
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
