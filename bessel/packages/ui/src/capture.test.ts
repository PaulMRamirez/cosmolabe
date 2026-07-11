import { describe, it, expect, vi, afterEach } from 'vitest';
import { captureStill, startRecording, CaptureError, downloadBlob } from './capture.ts';

describe('@bessel/ui capture', () => {
  it('resolves a still blob from toBlob', async () => {
    const canvas = { toBlob: (cb: (b: Blob | null) => void) => cb(new Blob(['x'])) } as unknown as HTMLCanvasElement;
    const blob = await captureStill(canvas);
    expect(blob).toBeInstanceOf(Blob);
  });
  it('rejects with CaptureError when toBlob yields null', async () => {
    const canvas = { toBlob: (cb: (b: Blob | null) => void) => cb(null) } as unknown as HTMLCanvasElement;
    await expect(captureStill(canvas)).rejects.toBeInstanceOf(CaptureError);
  });
  it('throws CaptureError when recording is unsupported', () => {
    const canvas = {} as HTMLCanvasElement;
    expect(() => startRecording(canvas)).toThrow(CaptureError);
  });
});

describe('@bessel/ui downloadBlob', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    delete (globalThis as { document?: unknown }).document;
    delete (globalThis as { URL?: unknown }).URL;
  });

  it('appends the anchor before clicking and defers revocation off the click', () => {
    vi.useFakeTimers();
    const order: string[] = [];
    const anchor = {
      style: {} as Record<string, string>,
      href: '',
      download: '',
      click: () => order.push('click'),
      remove: () => order.push('remove'),
    };
    const appended: unknown[] = [];
    (globalThis as { document?: unknown }).document = {
      createElement: () => anchor,
      body: {
        appendChild: (el: unknown) => {
          appended.push(el);
          order.push('append');
        },
      },
    };
    let revoked = 0;
    (globalThis as { URL?: unknown }).URL = {
      createObjectURL: () => 'blob:fake',
      revokeObjectURL: () => {
        revoked += 1;
        order.push('revoke');
      },
    };

    downloadBlob(new Blob(['x']), 'frame.png');

    // The anchor must be in the DOM (Firefox) and clicked, in that order.
    expect(appended).toContain(anchor);
    expect(order.indexOf('append')).toBeLessThan(order.indexOf('click'));
    expect(anchor.download).toBe('frame.png');
    // Revocation must NOT have run synchronously (that cancels large downloads).
    expect(revoked).toBe(0);
    // It runs only after the deferred timer fires.
    vi.runAllTimers();
    expect(revoked).toBe(1);
    expect(order.indexOf('revoke')).toBeGreaterThan(order.indexOf('click'));
  });
});
