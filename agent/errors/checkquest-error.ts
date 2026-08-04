export type CheckQuestErrorCode =
  | 'CONFIGURATION'
  | 'CANCELLED'
  | 'BROWSER'
  | 'NAVIGATION'
  | 'MODEL'
  | 'MODEL_RESPONSE'
  | 'REPORTING'
  | 'CLEANUP'
  | 'INTERNAL';

export interface CheckQuestErrorOptions {
  phase?: string;
  runId?: string;
  pageNumber?: number;
  navigationStep?: number;
  candidateReference?: string;
  requestedUrl?: string;
  finalUrl?: string;
  statusCode?: number;
  retryable?: boolean;
  cause?: unknown;
  secondaryCleanupError?: CheckQuestError;
}

export class CheckQuestError extends Error {
  readonly code: CheckQuestErrorCode;

  readonly phase: string | undefined;

  readonly runId: string | undefined;

  readonly pageNumber: number | undefined;

  readonly navigationStep: number | undefined;

  readonly candidateReference: string | undefined;

  readonly requestedUrl: string | undefined;

  readonly finalUrl: string | undefined;

  readonly statusCode: number | undefined;

  readonly retryable: boolean | undefined;

  secondaryCleanupError: CheckQuestError | undefined;

  constructor(code: CheckQuestErrorCode, message: string, options: CheckQuestErrorOptions = {}) {
    super(message, {
      cause: options.cause
    });

    this.name = 'CheckQuestError';
    this.code = code;
    this.phase = options.phase;
    this.runId = options.runId;
    this.pageNumber = options.pageNumber;
    this.navigationStep = options.navigationStep;
    this.candidateReference = options.candidateReference;
    this.requestedUrl = options.requestedUrl;
    this.finalUrl = options.finalUrl;
    this.statusCode = options.statusCode;
    this.retryable = options.retryable;
    this.secondaryCleanupError = options.secondaryCleanupError;
  }
}

export function formatPublicError(error: unknown): string {
  if (!(error instanceof CheckQuestError)) {
    return 'An unexpected CheckQuest failure occurred.';
  }

  const context: string[] = [];

  if (error.phase !== undefined) {
    context.push(`phase=${error.phase}`);
  }

  if (error.runId !== undefined) {
    context.push(`run=${error.runId}`);
  }

  if (error.pageNumber !== undefined) {
    context.push(`page=${error.pageNumber}`);
  }

  if (error.navigationStep !== undefined) {
    context.push(`navigation-step=${error.navigationStep}`);
  }

  if (error.requestedUrl !== undefined) {
    context.push(`requested-url=${error.requestedUrl}`);
  }

  if (error.finalUrl !== undefined) {
    context.push(`final-url=${error.finalUrl}`);
  }

  return (
    `[${error.code}] ${error.message}` + (context.length === 0 ? '' : ` (${context.join(', ')})`)
  );
}
