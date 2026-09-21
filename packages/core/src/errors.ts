/**
 * Every failure a user can hit carries a title, a detail and a remedy.
 * The CLI renders these three fields; nothing else is allowed to print "Failed."
 */
export interface GhostErrorShape {
  readonly code: string;
  readonly title: string;
  readonly detail: string;
  readonly remedy?: string;
  readonly context?: Record<string, unknown>;
}

export class GhostError extends Error implements GhostErrorShape {
  readonly code: string;
  readonly title: string;
  readonly detail: string;
  readonly remedy?: string;
  readonly context?: Record<string, unknown>;

  constructor(shape: GhostErrorShape, options?: { cause?: unknown }) {
    super(`${shape.title}: ${shape.detail}`, options);
    this.name = 'GhostError';
    this.code = shape.code;
    this.title = shape.title;
    this.detail = shape.detail;
    this.remedy = shape.remedy;
    this.context = shape.context;
  }

  toJSON(): GhostErrorShape {
    return {
      code: this.code,
      title: this.title,
      detail: this.detail,
      remedy: this.remedy,
      context: this.context,
    };
  }
}

export function isGhostError(value: unknown): value is GhostError {
  return value instanceof GhostError;
}

export const ErrorCodes = {
  TargetNotFound: 'target_not_found',
  OperationNotFound: 'operation_not_found',
  InvalidInput: 'invalid_input',
  AuthExpired: 'auth_expired',
  ExecutionFailed: 'execution_failed',
  TransportUnsupported: 'transport_unsupported',
  BrowserUnavailable: 'browser_unavailable',
  DecisionFailed: 'decision_failed',
  ConfirmationRequired: 'confirmation_required',
  UnsafeTarget: 'unsafe_target',
  StoreCorrupt: 'store_corrupt',
} as const;

export function describeUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
