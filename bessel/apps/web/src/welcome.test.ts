import { describe, expect, it } from 'vitest';
import { loadWelcomeSeen, persistWelcomeSeen } from './welcome.ts';
import type { Storage } from '@bessel/pal';

function fakeStorage(): Storage & { value: string | null } {
  return {
    value: null,
    async get() {
      return this.value;
    },
    async set(_key: string, value: string) {
      this.value = value;
    },
    async remove() {
      this.value = null;
    },
  };
}

describe('welcome-seen persistence', () => {
  it('is false until persisted, then true', async () => {
    const storage = fakeStorage();
    expect(await loadWelcomeSeen(storage)).toBe(false);
    await persistWelcomeSeen(storage);
    expect(await loadWelcomeSeen(storage)).toBe(true);
  });
});
