// Typed, located errors for numerical propagation. Fail loudly (CLAUDE.md): a
// step-size collapse, too many rejections, or a non-finite acceleration throws
// rather than silently returning a corrupt arc. (STK_PARITY_SPEC §4.2.)

export class IntegrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IntegrationError';
  }
}

/** Interpolating a dense Solution outside its integrated domain (no clamping). */
export class OutOfDomainError extends IntegrationError {
  constructor(t: number, t0: number, tf: number) {
    super(`interpolation epoch ${t} outside solution domain [${t0}, ${tf}]`);
    this.name = 'OutOfDomainError';
  }
}

/** An event root-finder lost its bracket or failed to converge. */
export class EventError extends IntegrationError {
  constructor(message: string) {
    super(message);
    this.name = 'EventError';
  }
}

/** The STM was requested but a force term supplies no partials and FD is disabled. */
export class StmUnsupportedError extends IntegrationError {
  constructor(termName: string) {
    super(
      `force term "${termName}" supplies no partials() and finite-difference fallback is disabled; cannot assemble the STM`,
    );
    this.name = 'StmUnsupportedError';
  }
}
