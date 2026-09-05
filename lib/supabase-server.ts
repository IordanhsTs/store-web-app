// Επιλογή ενεργού backend για server-side κώδικα (proxy, server components).
// Το αποτέλεσμα κρατιέται σε cache 30" ώστε να μην ελέγχουμε σε κάθε request.

import {
  BACKENDS,
  type Backend,
  isHealthy,
  readRemoteConfig,
  SERVER_TIMEOUT_MS,
} from './backends';

const TTL_MS = 30000;

let cached: { backend: Backend; at: number } | null = null;

export async function getServerBackend(): Promise<Backend> {
  if (BACKENDS.length < 2) return BACKENDS[0];
  if (cached && Date.now() - cached.at < TTL_MS) return cached.backend;

  let chosen = BACKENDS[0];
  const desired = await readRemoteConfig(SERVER_TIMEOUT_MS);
  if (desired) {
    chosen = BACKENDS.find((b) => b.name === desired) ?? BACKENDS[0];
  } else {
    // Ταυτόχρονα, όχι σειριακά: αν δεν αποκρίνεται κανένα από τα δύο φταίει το
    // δίκτυο του server και μένουμε στο κύριο, αντί να γυρίσουμε στο εφεδρικό.
    const [primaryOk, standbyOk] = await Promise.all([
      isHealthy(BACKENDS[0], SERVER_TIMEOUT_MS),
      isHealthy(BACKENDS[1], SERVER_TIMEOUT_MS),
    ]);
    if (!primaryOk && standbyOk) chosen = BACKENDS[1];
  }

  cached = { backend: chosen, at: Date.now() };
  return chosen;
}
