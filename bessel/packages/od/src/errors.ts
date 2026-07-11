// Typed, located errors for orbit determination. Fail loudly (CLAUDE.md): a singular
// normal matrix, a non-convergent batch iteration, a non-positive-definite covariance,
// or a malformed measurement throws a typed error rather than returning a corrupt
// estimate. These extend the propagator IntegrationError so a caller catching the
// propagation/estimation family catches both. (Vallado §10; Tapley-Schutz-Born §4.)

import { IntegrationError } from '@bessel/propagator';

/** Base for every orbit-determination failure (extends IntegrationError). */
export class OdError extends IntegrationError {
  constructor(message: string) {
    super(message);
    this.name = 'OdError';
  }
}

/** A dense linear solve hit a (near) singular matrix: the information was rank deficient. */
export class SingularMatrixError extends OdError {
  constructor(message: string) {
    super(message);
    this.name = 'SingularMatrixError';
  }
}

/**
 * The batch least-squares iteration did not converge: either it exhausted its iteration budget, or
 * it diverged (the residual RMS grew on a sustained run of steps, so the Gauss-Newton step is
 * moving away from the minimum, not toward it). `reason` distinguishes the two; the default keeps
 * the iteration-budget wording for existing callers.
 */
export class ConvergenceError extends OdError {
  constructor(iterations: number, lastRms: number, tol: number, reason?: string) {
    super(
      reason
        ? `batch least squares diverged after ${iterations} iterations: ${reason} ` +
            `(last residual RMS ${lastRms}, state-update tolerance ${tol})`
        : `batch least squares did not converge in ${iterations} iterations ` +
            `(last residual RMS ${lastRms}, state-update tolerance ${tol})`,
    );
    this.name = 'ConvergenceError';
  }
}

/** A measurement, observer geometry, or filter input was malformed. */
export class MeasurementError extends OdError {
  constructor(message: string) {
    super(message);
    this.name = 'MeasurementError';
  }
}
