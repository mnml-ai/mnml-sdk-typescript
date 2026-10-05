/** One field the API refused, on a `VALIDATION_FAILED` answer. */
export interface MnmlIssue {
  /** The field, as a dotted path (`references.0.mode`). */
  path: string;
  message: string;
}

/**
 * An answer that was not a success: the API's own code, message and request id.
 * The codes are listed at https://developers.mnml.ai/docs/errors.
 */
export class MnmlError extends Error {
  override readonly name = 'MnmlError';
  constructor(
    /** The API's error code, such as `INSUFFICIENT_CREDITS` or `RATE_LIMITED`. */
    readonly code: string,
    message: string,
    /** The HTTP status. */
    readonly status: number,
    /** The `X-Request-Id` to quote to support. */
    readonly requestId: string | null,
    readonly details?: unknown,
    /** On `VALIDATION_FAILED`, each field that was refused. */
    readonly issues: MnmlIssue[] = [],
  ) {
    super(message);
  }
}

/** `jobs.wait` ran out of time before the job settled; the job keeps running. */
export class MnmlTimeoutError extends Error {
  override readonly name = 'MnmlTimeoutError';
  constructor(readonly jobId: string) {
    super(`Job ${jobId} did not finish in time. It is still running; read it again later.`);
  }
}
