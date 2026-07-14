// Επιλογή ενεργού backend για server-side κώδικα (middleware, server components).
// Το αποτέλεσμα κρατιέται σε cache 30" ώστε να μην ελέγχουμε σε κάθε request.

import { BACKENDS, type Backend, isHealthy, readRemoteConfig } from './backends';

const TTL_MS = 30000;

let cached: { backend: Backend; at: number } | null = null;

export async function getServerBackend(): Promise<Backend> {
  if (BACKENDS.length < 2) return BACKENDS[0];
  if (cached && Date.now() - cached.at < TTL_MS) return cached.backend;

  let chosen = BACKENDS[0];
  const desired = await readRemoteConfig();
  if (desired) {
    chosen = BACKENDS.find((b) => b.name === desired) ?? BACKENDS[0];
  } else if (!(await isHealthy(BACKENDS[0])) && (await isHealthy(BACKENDS[1]))) {
    chosen = BACKENDS[1];
  }

  cached = { backend: chosen, at: Date.now() };
  return chosen;
}
