import { describe, it, expect, vi } from 'vitest';
import type { SpiceComputeEngine } from '@bessel/spice';
import { recordKernelOps, type KernelOp } from './spice-recorder.ts';

/** A minimal fake SpiceComputeEngine: the mutators no-op (resolved), and one read is stubbed so
 *  the test can assert pass-through. Other methods are unused by these tests. */
function fakeEngine(): SpiceComputeEngine {
  const engine = {
    furnsh: vi.fn(async () => undefined),
    unload: vi.fn(async () => undefined),
    kclear: vi.fn(async () => undefined),
    writeSpkType13: vi.fn(async () => undefined),
    bodvrd: vi.fn(async () => [6378.137]),
  };
  return engine as unknown as SpiceComputeEngine;
}

describe('recordKernelOps', () => {
  it('records furnsh + writeSpkType13 in apply order and passes the calls through', async () => {
    const inner = fakeEngine();
    const rec = recordKernelOps(inner);
    const bytes = new Uint8Array([1, 2, 3]);
    const et = new Float64Array([0, 1]);
    const states = new Float64Array(12);
    await rec.furnsh('de440.bsp', bytes);
    await rec.writeSpkType13('walker.bsp', -999, 399, 'J2000', 'seg', 7, et, states);

    expect(inner.furnsh).toHaveBeenCalledWith('de440.bsp', bytes);
    expect(inner.writeSpkType13).toHaveBeenCalledOnce();

    const ops = rec.snapshot();
    expect(ops.map((o: KernelOp) => o.kind)).toEqual(['furnsh', 'writeSpkType13']);
    expect(ops[0]).toMatchObject({ kind: 'furnsh', name: 'de440.bsp', bytes });
    expect(ops[1]).toMatchObject({ kind: 'writeSpkType13', name: 'walker.bsp', body: -999 });
  });

  it('an unload drops the matching earlier furnsh from the replay snapshot', async () => {
    const rec = recordKernelOps(fakeEngine());
    await rec.furnsh('a.bsp', new Uint8Array());
    await rec.furnsh('b.bsp', new Uint8Array());
    await rec.unload('a.bsp');
    const names = rec
      .snapshot()
      .filter((o): o is Extract<KernelOp, { name: string }> => 'name' in o && o.kind !== 'unload')
      .map((o) => o.name);
    expect(names).toEqual(['b.bsp']);
  });

  it('a kclear truncates the snapshot to the wipe marker', async () => {
    const rec = recordKernelOps(fakeEngine());
    await rec.furnsh('a.bsp', new Uint8Array());
    await rec.kclear();
    await rec.furnsh('b.bsp', new Uint8Array());
    expect(rec.snapshot().map((o) => o.kind)).toEqual(['kclear', 'furnsh']);
  });

  it('forwards a non-recorded read to the inner engine', async () => {
    const rec = recordKernelOps(fakeEngine());
    const radii = await rec.bodvrd('EARTH', 'RADII');
    expect(radii[0]).toBeCloseTo(6378.137, 3);
    // A read does not appear in the kernel-op log.
    expect(rec.snapshot()).toHaveLength(0);
  });
});
