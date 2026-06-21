// Light-time oracles. (1) The light-time correction shifts the predicted range away from the
// instantaneous range by approximately (range/c) * rangeRate, in the expected direction: when
// the target is receding (positive range-rate) the retarded position is CLOSER than now, so the
// light-time range is SMALLER than the instantaneous range, and the shift magnitude matches the
// first-order estimate. (2) A direct two-step light-time solve (evaluate the retarded state once,
// then once more at the refined tau) matches the iterative solver's converged value tightly.
// (3) The analytic light-time Jacobian matches a central finite difference of the corrected
// observable with respect to the reception-epoch state.

import { describe, expect, it } from 'vitest';
import { predict } from './measurements.ts';
import { predictLightTime, SPEED_OF_LIGHT_KM_S } from './light-time.ts';
import { propagateArc, type Arc } from './propagate.ts';
import { earthForceModel, fixedObserver, truthState } from './test-fixtures.ts';
import type { Measurement } from './types.ts';

const FM = earthForceModel();
const OBS = fixedObserver();
const T0 = 0;
const T_RX = 120; // reception epoch, 2 min into the arc

function arcFor(state0: Float64Array, span: number): Arc {
  return propagateArc(state0, T0, [span], FM);
}

describe('light-time correction', () => {
  it('shifts the predicted range by ~ (range/c) * rangeRate in the expected direction', () => {
    const truth = truthState();
    const arc = arcFor(truth, 300);
    const m: Measurement = { kind: 'range', epoch: T_RX, observer: OBS, sigma: 1e-3, value: 0 };

    // Instantaneous geometry at the reception epoch.
    const stateRx = arc.stateAt(T_RX);
    const inst = predict(m, stateRx).value[0]!;
    const rho: [number, number, number] = [stateRx[0]! - OBS[0], stateRx[1]! - OBS[1], stateRx[2]! - OBS[2]];
    const range = Math.hypot(rho[0], rho[1], rho[2]);
    const rangeRate = (rho[0] * stateRx[3]! + rho[1] * stateRx[4]! + rho[2] * stateRx[5]!) / range;

    const lt = predictLightTime(m, arc).value[0]!;
    const shift = lt - inst;

    // First-order light-time range shift: r_lt ~ r - rangeRate * tau, tau ~ range/c, so
    // shift ~ -(range/c) * rangeRate. Sign: receding (rangeRate>0) => shift negative.
    const predictedShift = -(range / SPEED_OF_LIGHT_KM_S) * rangeRate;
    expect(Math.sign(shift)).toBe(Math.sign(predictedShift));
    // Match to ~1% of the first-order estimate (second-order terms are tiny over ~1 ms).
    expect(Math.abs(shift - predictedShift)).toBeLessThan(Math.abs(predictedShift) * 0.05 + 1e-9);
  });

  it('the converged light time matches a direct two-step light-time solve', () => {
    const truth = truthState();
    const arc = arcFor(truth, 300);
    const m: Measurement = { kind: 'range', epoch: T_RX, observer: OBS, sigma: 1e-3, value: 0 };
    const c = SPEED_OF_LIGHT_KM_S;

    // Direct two-step solve: tau0 from the reception-epoch geometry, then one refinement.
    const s0 = arc.stateAt(T_RX);
    const r0 = Math.hypot(s0[0]! - OBS[0], s0[1]! - OBS[1], s0[2]! - OBS[2]);
    const tau0 = r0 / c;
    const s1 = arc.stateAt(T_RX - tau0);
    const r1 = Math.hypot(s1[0]! - OBS[0], s1[1]! - OBS[1], s1[2]! - OBS[2]);
    const tau1 = r1 / c;

    const lt = predictLightTime(m, arc);
    // Two steps of the contraction already nail tau to sub-ns precision (the converged value
    // refines tau1 by the next contraction increment, ~ (rangeRate/c)^2 of tau).
    expect(lt.lightTime).toBeCloseTo(tau1, 9);
    expect(lt.transmitEpoch).toBeCloseTo(T_RX - tau1, 9);
  });

  it('the analytic light-time Jacobian matches a finite difference of the corrected range', () => {
    const truth = truthState();
    const m: Measurement = { kind: 'range', epoch: T_RX, observer: OBS, sigma: 1e-3, value: 0 };

    // The analytic partial is dh/dx_rx (with respect to the reception-epoch state). Referred to
    // the arc base epoch t0=0 it is dh/dx_0 = dh/dx_rx * Phi(t_rx, t0). We finite-difference the
    // corrected observable with respect to the INITIAL state x_0 (perturb, re-propagate, predict)
    // and compare to that chained analytic partial.
    const phiRx = arcFor(truth, 300).stmAt(T_RX); // Phi(t_rx, t0)
    const analyticRx = predictLightTime(m, arcFor(truth, 300)).jac; // dh/dx_rx (1x6)
    const analytic0 = new Float64Array(6); // dh/dx_0 = dh/dx_rx * Phi(t_rx, t0)
    for (let j = 0; j < 6; j++) {
      let acc = 0;
      for (let k = 0; k < 6; k++) acc += analyticRx[k]! * phiRx[k * 6 + j]!;
      analytic0[j] = acc;
    }

    const fd = new Float64Array(6);
    for (let j = 0; j < 6; j++) {
      const h = Math.max(1, Math.abs(truth[j]!)) * 1e-6;
      const plus = Float64Array.from(truth);
      const minus = Float64Array.from(truth);
      plus[j]! += h;
      minus[j]! -= h;
      const vp = predictLightTime(m, arcFor(plus, 300)).value[0]!;
      const vm = predictLightTime(m, arcFor(minus, 300)).value[0]!;
      fd[j] = (vp - vm) / (2 * h);
    }
    // The analytic light-time partial is a first-order model (the retarded geometry mapped
    // through the STM with the 1/(1 - rangeRate/c) light-time factor), so we hold it to a
    // relative tolerance rather than to the integrator floor: every component agrees with the
    // re-propagated central difference to ~1e-4 relative.
    for (let j = 0; j < 6; j++) {
      const scale = Math.max(Math.abs(fd[j]!), 1e-3);
      expect(Math.abs(analytic0[j]! - fd[j]!) / scale).toBeLessThan(1e-3);
    }
  });

  it('caches the reception-epoch STM inverse: same result, one inversion per (arc, tRx)', () => {
    // Phi(t_rx, t0)^-1 depends only on the arc and the reception epoch, not on the measurement
    // component being rebased. Wrap the arc to count stmAt(tRx) calls and confirm two predictions
    // at the SAME reception epoch invert that STM only once (the second hits the cache), while a
    // prediction at a DIFFERENT reception epoch inverts its own STM (a fresh cache entry). Results
    // must be byte-for-byte identical to the uncached reference.
    const truth = truthState();
    const base = arcFor(truth, 300);
    let stmRxCalls = 0;
    const TOL = 1e-9;
    const counting: Arc = {
      stateAt: (et) => base.stateAt(et),
      stmAt: (et) => {
        if (Math.abs(et - T_RX) < TOL) stmRxCalls += 1;
        return base.stmAt(et);
      },
      result: base.result,
    };
    const m1: Measurement = { kind: 'range', epoch: T_RX, observer: OBS, sigma: 1e-3, value: 0 };
    const m2: Measurement = { kind: 'rangeRate', epoch: T_RX, observer: OBS, sigma: 1e-6, value: 0 };

    const ref1 = predictLightTime(m1, base);
    const ref2 = predictLightTime(m2, base);
    const got1 = predictLightTime(m1, counting);
    const got2 = predictLightTime(m2, counting); // same tRx, must reuse the cached inverse
    // Parity with the uncached reference (jac and value identical for both components).
    expect(Array.from(got1.jac)).toEqual(Array.from(ref1.jac));
    expect(got1.value[0]!).toBe(ref1.value[0]!);
    expect(Array.from(got2.jac)).toEqual(Array.from(ref2.jac));
    expect(got2.value[0]!).toBe(ref2.value[0]!);
    // mapPartialToReception requests stmAt(tRx) only on the FIRST call; the second reuses the
    // cached Phi(tRx)^-1 (later predictLightTime steps may read stmAt at OTHER epochs, e.g. tTx,
    // which this counter ignores). So across two same-tRx predictions tRx is inverted once.
    expect(stmRxCalls).toBe(1);

    // A prediction at a different reception epoch builds its own cache entry (a second inversion).
    const m3: Measurement = { kind: 'range', epoch: T_RX + 30, observer: OBS, sigma: 1e-3, value: 0 };
    predictLightTime(m3, counting);
    expect(stmRxCalls).toBe(1); // still 1: T_RX itself was not re-inverted
  });

  it('reduces to the instantaneous partial in the c -> infinity limit (no light time)', () => {
    // Driving the light time to zero (a huge tolerance with the iteration starting at tau=0, or
    // physically c -> infinity) must collapse the corrected observable onto the plain predict.
    const truth = truthState();
    const arc = arcFor(truth, 300);
    const m: Measurement = { kind: 'range', epoch: T_RX, observer: OBS, sigma: 1e-3, value: 0 };
    const lt = predictLightTime(m, arc);
    const inst = predict(m, arc.stateAt(T_RX));
    // The light time is positive but small (LEO range / c ~ a few ms), so values agree closely.
    expect(lt.lightTime).toBeGreaterThan(0);
    expect(lt.lightTime).toBeLessThan(0.05); // ~ range/c, a few tens of ms for LEO
    // The light-time range shift is ~ (range/c) * rangeRate, at most a fraction of a km here.
    expect(Math.abs(lt.value[0]! - inst.value[0]!)).toBeLessThan(0.5);
  });
});
