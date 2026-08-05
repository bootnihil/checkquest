import { z } from 'zod';

import type { RunEvent } from '../agent/run/run-event';

interface DesktopRunEventCommon {
  timestamp: string;
  runId: string;
  message: string;
}

export type DesktopApplicationRunEvent =
  | (DesktopRunEventCommon & {
      type: 'run-started';
      pageBudget: number;
      navigationBudget: number;
    })
  | (DesktopRunEventCommon & {
      type: 'inspection-started';
      pageNumber: number;
    })
  | (DesktopRunEventCommon & {
      type: 'inspection-completed';
      pageNumber: number;
      findingCount: number;
      diagnosticCount: number;
    })
  | (DesktopRunEventCommon & {
      type: 'navigation-started';
      navigationStep: number;
      navigationBudget: number;
      pageNumber: number;
    })
  | (DesktopRunEventCommon & {
      type: 'navigation-completed';
      navigationStep: number;
      navigationBudget: number;
      pageNumber: number;
      outcome: 'ready-for-inspection' | 'duplicate-final-url';
    })
  | (DesktopRunEventCommon & {
      type: 'model-request-started';
      operation: string;
      attempt: number;
      maxAttempts: number;
    })
  | (DesktopRunEventCommon & {
      type: 'model-request-retrying';
      operation: string;
      attempt: number;
      maxAttempts: number;
      retryDelayMs: number;
      statusCode: number | null;
    })
  | (DesktopRunEventCommon & {
      type: 'model-request-completed';
      operation: string;
      attempt: number;
      maxAttempts: number;
    })
  | (DesktopRunEventCommon & {
      type: 'investigation-completed';
      pageNumber: number;
      status: 'verified' | 'not-verified' | 'inconclusive';
      stepsUsed: number;
    })
  | (DesktopRunEventCommon & {
      type: 'run-completed';
      outcome: 'completed' | 'finished';
      inspectedPageCount: number;
      findingCount: number;
      confirmedFindingCount: number;
      reviewFindingCount: number;
      technicalObservationCount: number;
      occurrenceCount: number;
    })
  | (DesktopRunEventCommon & {
      type: 'run-failed';
      code:
        | 'CONFIGURATION'
        | 'CANCELLED'
        | 'BROWSER'
        | 'NAVIGATION'
        | 'MODEL'
        | 'MODEL_RESPONSE'
        | 'REPORTING'
        | 'CLEANUP'
        | 'INTERNAL';
      phase?: string;
      pageNumber?: number;
      navigationStep?: number;
    });

export type DesktopRunEvent =
  | (DesktopRunEventCommon & {
      type: 'target-preflight-started';
    })
  | DesktopApplicationRunEvent;

export const desktopApplicationRunEventDecisions = {
  'run-started': 'projected',
  'inspection-started': 'projected',
  'inspection-completed': 'projected',
  'navigation-started': 'projected',
  'navigation-completed': 'projected',
  'model-request-started': 'projected',
  'model-request-retrying': 'projected',
  'model-request-completed': 'projected',
  'investigation-completed': 'projected',
  'run-completed': 'projected',
  'run-failed': 'projected'
} as const satisfies Readonly<Record<RunEvent['type'], 'projected' | 'excluded'>>;

function projectCommon(event: RunEvent): DesktopRunEventCommon {
  return {
    timestamp: event.timestamp,
    runId: event.runId,
    message: event.message
  };
}

export function projectApplicationRunEvent(event: RunEvent): DesktopApplicationRunEvent {
  const common = projectCommon(event);

  switch (event.type) {
    case 'run-started':
      return {
        ...common,
        type: event.type,
        pageBudget: event.pageBudget,
        navigationBudget: event.navigationBudget
      };

    case 'inspection-started':
      return {
        ...common,
        type: event.type,
        pageNumber: event.pageNumber
      };

    case 'inspection-completed':
      return {
        ...common,
        type: event.type,
        pageNumber: event.pageNumber,
        findingCount: event.findingCount,
        diagnosticCount: event.diagnosticCount
      };

    case 'navigation-started':
      return {
        ...common,
        type: event.type,
        navigationStep: event.navigationStep,
        navigationBudget: event.navigationBudget,
        pageNumber: event.pageNumber
      };

    case 'navigation-completed':
      return {
        ...common,
        type: event.type,
        navigationStep: event.navigationStep,
        navigationBudget: event.navigationBudget,
        pageNumber: event.pageNumber,
        outcome: event.outcome
      };

    case 'model-request-started':
      return {
        ...common,
        type: event.type,
        operation: event.operation,
        attempt: event.attempt,
        maxAttempts: event.maxAttempts
      };

    case 'model-request-retrying':
      return {
        ...common,
        type: event.type,
        operation: event.operation,
        attempt: event.attempt,
        maxAttempts: event.maxAttempts,
        retryDelayMs: event.retryDelayMs,
        statusCode: event.statusCode
      };

    case 'model-request-completed':
      return {
        ...common,
        type: event.type,
        operation: event.operation,
        attempt: event.attempt,
        maxAttempts: event.maxAttempts
      };

    case 'investigation-completed':
      return {
        ...common,
        type: event.type,
        pageNumber: event.pageNumber,
        status: event.status,
        stepsUsed: event.stepsUsed
      };

    case 'run-completed':
      return {
        ...common,
        type: event.type,
        outcome: event.outcome,
        inspectedPageCount: event.inspectedPageCount,
        findingCount: event.findingCount,
        confirmedFindingCount: event.confirmedFindingCount,
        reviewFindingCount: event.reviewFindingCount,
        technicalObservationCount: event.technicalObservationCount,
        occurrenceCount: event.occurrenceCount
      };

    case 'run-failed':
      return {
        ...common,
        type: event.type,
        code: event.code,
        ...(event.phase === undefined ? {} : { phase: event.phase }),
        ...(event.pageNumber === undefined ? {} : { pageNumber: event.pageNumber }),
        ...(event.navigationStep === undefined ? {} : { navigationStep: event.navigationStep })
      };
  }
}

const eventCommonSchema = {
  timestamp: z.string().min(1).max(64),
  runId: z.string().min(1).max(128),
  message: z.string().max(4_096)
} as const;

const nonNegativeInteger = z.number().int().nonnegative();
const positiveInteger = z.number().int().positive();

const desktopRunEventSchemas = {
  'target-preflight-started': z.object({
    ...eventCommonSchema,
    type: z.literal('target-preflight-started')
  }),
  'run-started': z.object({
    ...eventCommonSchema,
    type: z.literal('run-started'),
    pageBudget: positiveInteger,
    navigationBudget: nonNegativeInteger
  }),
  'inspection-started': z.object({
    ...eventCommonSchema,
    type: z.literal('inspection-started'),
    pageNumber: positiveInteger
  }),
  'inspection-completed': z.object({
    ...eventCommonSchema,
    type: z.literal('inspection-completed'),
    pageNumber: positiveInteger,
    findingCount: nonNegativeInteger,
    diagnosticCount: nonNegativeInteger
  }),
  'navigation-started': z.object({
    ...eventCommonSchema,
    type: z.literal('navigation-started'),
    navigationStep: positiveInteger,
    navigationBudget: nonNegativeInteger,
    pageNumber: positiveInteger
  }),
  'navigation-completed': z.object({
    ...eventCommonSchema,
    type: z.literal('navigation-completed'),
    navigationStep: positiveInteger,
    navigationBudget: nonNegativeInteger,
    pageNumber: positiveInteger,
    outcome: z.enum(['ready-for-inspection', 'duplicate-final-url'])
  }),
  'model-request-started': z.object({
    ...eventCommonSchema,
    type: z.literal('model-request-started'),
    operation: z.string().max(200),
    attempt: positiveInteger,
    maxAttempts: positiveInteger
  }),
  'model-request-retrying': z.object({
    ...eventCommonSchema,
    type: z.literal('model-request-retrying'),
    operation: z.string().max(200),
    attempt: positiveInteger,
    maxAttempts: positiveInteger,
    retryDelayMs: nonNegativeInteger,
    statusCode: z.number().int().nullable()
  }),
  'model-request-completed': z.object({
    ...eventCommonSchema,
    type: z.literal('model-request-completed'),
    operation: z.string().max(200),
    attempt: positiveInteger,
    maxAttempts: positiveInteger
  }),
  'investigation-completed': z.object({
    ...eventCommonSchema,
    type: z.literal('investigation-completed'),
    pageNumber: positiveInteger,
    status: z.enum(['verified', 'not-verified', 'inconclusive']),
    stepsUsed: nonNegativeInteger
  }),
  'run-completed': z.object({
    ...eventCommonSchema,
    type: z.literal('run-completed'),
    outcome: z.enum(['completed', 'finished']),
    inspectedPageCount: nonNegativeInteger,
    findingCount: nonNegativeInteger,
    confirmedFindingCount: nonNegativeInteger,
    reviewFindingCount: nonNegativeInteger,
    technicalObservationCount: nonNegativeInteger,
    occurrenceCount: nonNegativeInteger
  }),
  'run-failed': z.object({
    ...eventCommonSchema,
    type: z.literal('run-failed'),
    code: z.enum([
      'CONFIGURATION',
      'CANCELLED',
      'BROWSER',
      'NAVIGATION',
      'MODEL',
      'MODEL_RESPONSE',
      'REPORTING',
      'CLEANUP',
      'INTERNAL'
    ]),
    phase: z.string().max(200).optional(),
    pageNumber: positiveInteger.optional(),
    navigationStep: positiveInteger.optional()
  })
} satisfies Readonly<Record<DesktopRunEvent['type'], z.ZodType>>;

export function parseDesktopRunEvent(value: unknown): DesktopRunEvent | null {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('type' in value) ||
    typeof value.type !== 'string'
  ) {
    return null;
  }

  const type = value.type;

  if (!(type in desktopRunEventSchemas)) {
    return null;
  }

  const schema = desktopRunEventSchemas[type as DesktopRunEvent['type']];
  const result = schema.safeParse(value);

  return result.success ? (result.data as DesktopRunEvent) : null;
}
