// The exportOem op: serialize an ephemeris or MCS result to a CCSDS OEM (502.0-B) file
// through the existing interop writer, with UTC epochs from the engine. (STK_PARITY_SPEC, SDK.)

import { writeOem, type Oem, type OemState } from '@bessel/interop';
import { ExportError } from '../errors.ts';
import type { ExportOemOp } from '../job/types.ts';
import type { OpContext } from '../runner/context.ts';
import type { OpResult } from '../runner/results.ts';

export async function runExportOem(op: ExportOemOp, ctx: OpContext): Promise<OpResult> {
  const src = ctx.registry.get(op.from);
  if (!src) throw new ExportError(`exportOem source "${op.from}" was not produced by any prior op`, `from`);

  let states: OemState[];
  let frame: string;
  let center: string;
  let objectName: string | undefined;
  if (src.kind === 'ephemeris') {
    frame = src.frame;
    center = src.center;
    objectName = src.objectName;
    states = [];
    for (let i = 0; i < src.et.length; i++) {
      states.push(await oemState(ctx, src.et[i]!, src.states.subarray(i * 6, i * 6 + 6)));
    }
  } else if (src.kind === 'mcs') {
    frame = src.frame;
    center = src.center;
    states = [];
    for (const sample of src.run.samples) {
      const p = sample.state.position;
      const v = sample.state.velocity;
      states.push(await oemState(ctx, sample.et, Float64Array.of(p.x, p.y, p.z, v.x, v.y, v.z)));
    }
  } else {
    throw new ExportError(`exportOem cannot serialize a "${src.kind}" result`, `from`);
  }

  const oem: Oem = {
    version: '2.0',
    metadata: { objectName, centerName: center, refFrame: frame, timeSystem: 'UTC', ...op.metadata },
    states,
  };
  await ctx.io.writeFile(op.file, new TextEncoder().encode(writeOem(oem)));
  return { kind: 'void' };
}

async function oemState(ctx: OpContext, et: number, row: Float64Array): Promise<OemState> {
  const epoch = await ctx.engine.et2utc(et, 'ISOC', 6);
  return {
    epoch,
    position: [row[0]!, row[1]!, row[2]!],
    velocity: [row[3]!, row[4]!, row[5]!],
  };
}
