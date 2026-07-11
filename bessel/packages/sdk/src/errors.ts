// Typed, located, loud error family for the automation SDK. A job that is malformed,
// references a missing producer, or hits a compute failure throws a specific error
// carrying where it arose (a JSON pointer or kernel/op name), never a silent wrong
// answer. (STK_PARITY_SPEC, SDK.)

export abstract class SdkError extends Error {
  abstract readonly code: string;
  readonly location?: string;
  constructor(message: string, location?: string) {
    super(message);
    this.name = new.target.name;
    this.location = location;
  }
}

/** A batch job failed structural validation. `pointer` is a JSON pointer into the job. */
export class JobSchemaError extends SdkError {
  override readonly code = 'job-schema';
  readonly pointer: string;
  constructor(message: string, pointer: string) {
    super(message, pointer);
    this.pointer = pointer;
  }
}

/** The job declared an unsupported `besselBatch` version. */
export class UnsupportedJobVersionError extends SdkError {
  override readonly code = 'job-version';
  readonly seen: string;
  constructor(seen: string) {
    super(`unsupported besselBatch version "${seen}", expected "1"`);
    this.seen = seen;
  }
}

/** An operation referenced a producer id or entity that was never declared. */
export class JobReferenceError extends SdkError {
  override readonly code = 'job-reference';
  readonly pointer: string;
  readonly ref: string;
  constructor(message: string, pointer: string, ref: string) {
    super(message, pointer);
    this.pointer = pointer;
    this.ref = ref;
  }
}

/** A kernel named by a furnish op could not be resolved from the KernelSource. */
export class KernelResolveError extends SdkError {
  override readonly code = 'kernel-resolve';
  readonly kernel: string;
  override readonly cause: unknown;
  constructor(kernel: string, cause: unknown) {
    super(`kernel "${kernel}" could not be resolved`);
    this.kernel = kernel;
    this.cause = cause;
  }
}

/** An analysis op received inconsistent or out-of-range inputs. */
export class AnalysisInputError extends SdkError {
  override readonly code = 'analysis-input';
}

/** An export op was pointed at a producer whose result it cannot serialize. */
export class ExportError extends SdkError {
  override readonly code = 'export';
}

/** An MCS op's mission sequence failed validation. */
export class McsValidationError extends SdkError {
  override readonly code = 'mcs-validate';
  override readonly cause: unknown;
  constructor(message: string, cause: unknown) {
    super(message);
    this.cause = cause;
  }
}

/** A loadCatalog op could not read or parse its catalog file. */
export class CatalogLoadError extends SdkError {
  override readonly code = 'catalog-load';
  readonly file: string;
  override readonly cause: unknown;
  constructor(file: string, cause: unknown) {
    super(`catalog "${file}" could not be loaded`);
    this.file = file;
    this.cause = cause;
  }
}

/** A report op was pointed at a producer that does not exist or cannot be summarized. */
export class ReportError extends SdkError {
  override readonly code = 'report';
}
