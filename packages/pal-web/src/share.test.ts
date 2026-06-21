// WebShare.shareLink must fail loudly (CLAUDE.md): when neither the Web Share API
// nor the clipboard is available, or the clipboard write rejects (insecure or
// permission-blocked context), it must throw a located PalError rather than
// silently returning the URL so the UI reports "shared/copied" when nothing did.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { PalError } from '@bessel/pal';
import { createWebPlatform } from './index.ts';

const ORIGINAL_NAVIGATOR = globalThis.navigator;

function setNavigator(value: unknown): void {
  Object.defineProperty(globalThis, 'navigator', {
    value,
    configurable: true,
    writable: true,
  });
}

async function makeShare() {
  const platform = await createWebPlatform({ kernelUrls: {}, cache: false });
  return platform.share;
}

const request = { title: 'Bessel', url: 'https://example.test/scene#xyz' };

describe('WebShare.shareLink', () => {
  afterEach(() => setNavigator(ORIGINAL_NAVIGATOR));

  it('uses the Web Share API when present and returns the url', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    setNavigator({ share });
    const result = await (await makeShare()).shareLink(request);
    expect(share).toHaveBeenCalledWith({ title: request.title, url: request.url });
    expect(result).toBe(request.url);
  });

  it('falls back to the clipboard and returns the url', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigator({ clipboard: { writeText } });
    const result = await (await makeShare()).shareLink(request);
    expect(writeText).toHaveBeenCalledWith(request.url);
    expect(result).toBe(request.url);
  });

  it('throws a located PalError when neither share nor clipboard is available', async () => {
    setNavigator({});
    const share = await makeShare();
    await expect(share.shareLink(request)).rejects.toBeInstanceOf(PalError);
    await expect(share.shareLink(request)).rejects.toMatchObject({
      code: 'not-supported',
      location: 'WebShare.shareLink',
    });
  });

  it('throws a located PalError when the clipboard write rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('blocked'));
    setNavigator({ clipboard: { writeText } });
    const share = await makeShare();
    await expect(share.shareLink(request)).rejects.toBeInstanceOf(PalError);
    await expect(share.shareLink(request)).rejects.toMatchObject({ code: 'not-supported' });
  });
});
