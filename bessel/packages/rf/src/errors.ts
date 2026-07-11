// Typed, located errors for the RF math. Fail loudly (CLAUDE.md): a bad modulation
// order or an unsupported argument throws with the offending value rather than
// silently returning a meaningless number. (STK_PARITY_SPEC §4.5.)

export class RfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RfError';
  }
}

/** A modulation order M that is not a power of two, or below the model's floor. */
export class ModulationError extends RfError {
  constructor(message: string) {
    super(message);
    this.name = 'ModulationError';
  }
}
