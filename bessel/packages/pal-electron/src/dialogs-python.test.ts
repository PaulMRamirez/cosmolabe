import { describe, it, expect, vi } from 'vitest';
import { PalError } from '@bessel/pal';
import { openKernelDialog, saveProductDialog, runBatchGeometry } from './index.ts';
import type { BesselBridge, DialogOpenOptions, DialogSaveOptions } from './ipc-contract.ts';

function bridge(over: Partial<BesselBridge> = {}): BesselBridge {
  return {
    platform: 'electron',
    versions: process.versions,
    listKernels: async () => [],
    resolveKernel: async (name) => ({ id: name, name }),
    readKernel: async () => new Uint8Array(),
    readKernelRange: async () => new Uint8Array(),
    resolveMetaKernel: async () => [],
    openDialog: async () => null,
    saveDialog: async () => null,
    runPython: async () => ({ rows: [] }),
    pythonAvailable: async () => false,
    ...over,
  };
}

describe('@bessel/pal-electron dialogs', () => {
  it('opens a kernel dialog with SPICE filters and returns the first path', async () => {
    const openDialog = vi.fn(async (_o: DialogOpenOptions) => ['/k/de440s.bsp', '/k/extra.bsp']);
    const path = await openKernelDialog(bridge({ openDialog }));
    expect(path).toBe('/k/de440s.bsp');
    const opts = openDialog.mock.calls[0]![0];
    expect(opts.filters![0]!.extensions).toContain('tm');
    expect(opts.filters![0]!.extensions).toContain('bds');
  });
  it('maps a cancelled open dialog to null', async () => {
    expect(await openKernelDialog(bridge({ openDialog: async () => null }))).toBeNull();
  });
  it('forwards the save dialog default path', async () => {
    const saveDialog = vi.fn(async (_o: DialogSaveOptions) => '/out/p.czml');
    expect(await saveProductDialog(bridge({ saveDialog }), 'p.czml')).toBe('/out/p.czml');
    expect(saveDialog.mock.calls[0]![0].defaultPath).toBe('p.czml');
  });
});

describe('@bessel/pal-electron python bridge', () => {
  it('throws a typed error when python is unavailable', async () => {
    await expect(
      runBatchGeometry(bridge({ pythonAvailable: async () => false }), {
        kind: 'spkpos-grid', target: 'SATURN', observer: '-82', frame: 'J2000',
        startUtc: '2004-07-01', stopUtc: '2004-07-02', steps: 2, metaKernel: 'm.tm',
      }),
    ).rejects.toBeInstanceOf(PalError);
  });
  it('forwards to the bridge when python is available', async () => {
    const runPython = vi.fn(async () => ({ rows: [{ et: 0, position: [1, 2, 3] as [number, number, number] }] }));
    const result = await runBatchGeometry(
      bridge({ pythonAvailable: async () => true, runPython }),
      { kind: 'spkpos-grid', target: 'SATURN', observer: '-82', frame: 'J2000', startUtc: 'a', stopUtc: 'b', steps: 1, metaKernel: 'm.tm' },
    );
    expect(result.rows).toHaveLength(1);
    expect(runPython).toHaveBeenCalledOnce();
  });
});
