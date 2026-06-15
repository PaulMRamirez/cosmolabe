// Mission time window helpers. The catalog coverage hints often coincide exactly
// with SPK boundaries, so we inset by a margin to guarantee interpolation always
// has data at the sampled epochs.

export function missionWindow(
  rawEt0: number,
  rawEt1: number,
  marginSec: number,
): readonly [number, number] {
  return [rawEt0 + marginSec, rawEt1 - marginSec];
}
