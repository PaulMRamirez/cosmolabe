// First-run welcome state, persisted through the PAL Storage interface (OPFS-backed
// on native, localStorage on web), on the same path family as bookmarks. Once the
// welcome card has been dismissed or acted on, the flag is set so it does not reappear.

import type { Storage } from '@bessel/pal';

const KEY = 'bessel:welcome-seen';

export async function loadWelcomeSeen(storage: Storage): Promise<boolean> {
  return (await storage.get(KEY)) === '1';
}

export async function persistWelcomeSeen(storage: Storage): Promise<void> {
  await storage.set(KEY, '1');
}
