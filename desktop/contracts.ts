import {
  z
} from 'zod';
import {
  runtimeSiteDefaults
} from '../agent/config/site-config';

export const desktopRunBudgetLimits = {
  pages: {
    minimum:
      1,
    maximum:
      20
  },
  navigationSteps: {
    minimum:
      1,
    maximum:
      50
  },
  investigationStepsPerPage: {
    minimum:
      1,
    maximum:
      10
  }
} as const;

export const desktopRunDefaults = {
  pageBudget:
    runtimeSiteDefaults
      .maxPages,
  navigationBudget:
    runtimeSiteDefaults
      .maxAgentSteps,
  investigationStepsPerPage:
    runtimeSiteDefaults
      .maxExploratoryStepsPerPage
} as const;

export interface DesktopStartRunInput {
  targetUrl:
    string;
  pageBudget:
    number;
  navigationBudget:
    number;
  investigationStepsPerPage:
    number;
  geminiApiKey?:
    string;
}

export const desktopRunFieldNames = [
  'targetUrl',
  'pageBudget',
  'navigationBudget',
  'investigationStepsPerPage',
  'geminiApiKey'
] as const;

export type DesktopRunFieldName =
  (
    typeof desktopRunFieldNames
  )[number];

export type DesktopRunFieldErrors =
  Partial<
    Record<
      DesktopRunFieldName,
      string
    >
  >;

export type DesktopStartRunReply =
  | {
      accepted:
        true;
    }
  | {
      accepted:
        false;
      reason:
        | 'active-run'
        | 'invalid-request'
        | 'credential-rejected'
        | 'preflight-failed'
        | 'target-unreachable'
        | 'cancelled'
        | 'application-unavailable';
      message:
        string;
      fieldErrors?:
        DesktopRunFieldErrors;
    };

export interface DesktopCancelRunReply {
  requested:
    boolean;
}

export interface DesktopSessionCredentialStatus {
  available:
    boolean;
}

interface DesktopRunEventCommon {
  timestamp:
    string;
  runId:
    string;
  message:
    string;
}

export type DesktopRunEvent =
  | (
      DesktopRunEventCommon & {
        type:
          'target-preflight-started';
      }
    )
  | (
      DesktopRunEventCommon & {
        type:
          'run-started';
        pageBudget:
          number;
        navigationBudget:
          number;
      }
    )
  | (
      DesktopRunEventCommon & {
        type:
          'inspection-started';
        pageNumber:
          number;
      }
    )
  | (
      DesktopRunEventCommon & {
        type:
          'inspection-completed';
        pageNumber:
          number;
        findingCount:
          number;
        diagnosticCount:
          number;
      }
    )
  | (
      DesktopRunEventCommon & {
        type:
          'navigation-started';
        navigationStep:
          number;
        navigationBudget:
          number;
        pageNumber:
          number;
      }
    )
  | (
      DesktopRunEventCommon & {
        type:
          'navigation-completed';
        navigationStep:
          number;
        navigationBudget:
          number;
        pageNumber:
          number;
        outcome:
          | 'ready-for-inspection'
          | 'duplicate-final-url';
      }
    )
  | (
      DesktopRunEventCommon & {
        type:
          'model-request-started';
        operation:
          string;
        attempt:
          number;
        maxAttempts:
          number;
      }
    )
  | (
      DesktopRunEventCommon & {
        type:
          'model-request-retrying';
        operation:
          string;
        attempt:
          number;
        maxAttempts:
          number;
        retryDelayMs:
          number;
        statusCode:
          number | null;
      }
    )
  | (
      DesktopRunEventCommon & {
        type:
          'model-request-completed';
        operation:
          string;
        attempt:
          number;
        maxAttempts:
          number;
      }
    )
  | (
      DesktopRunEventCommon & {
        type:
          'investigation-completed';
        pageNumber:
          number;
        status:
          | 'verified'
          | 'not-verified'
          | 'inconclusive';
        stepsUsed:
          number;
      }
    )
  | (
      DesktopRunEventCommon & {
        type:
          'run-completed';
        outcome:
          | 'completed'
          | 'finished';
        inspectedPageCount:
          number;
        findingCount:
          number;
        confirmedFindingCount:
          number;
        reviewFindingCount:
          number;
        technicalObservationCount:
          number;
        occurrenceCount:
          number;
      }
    )
  | (
      DesktopRunEventCommon & {
        type:
          'run-failed';
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
        phase?:
          string;
        pageNumber?:
          number;
        navigationStep?:
          number;
      }
    );

export interface CheckQuestDesktopApi {
  startRun:
    (
      input:
        DesktopStartRunInput
    ) => Promise<
      DesktopStartRunReply
    >;
  cancelRun:
    () => Promise<
      DesktopCancelRunReply
    >;
  getSessionCredentialStatus:
    () => Promise<
      DesktopSessionCredentialStatus
    >;
  onRunEvent:
    (
      listener:
        (
          event:
            DesktopRunEvent
        ) => void
    ) => () => void;
}

export const desktopIpcChannels = {
  startRun:
    'checkquest:start-run',
  cancelRun:
    'checkquest:cancel-run',
  sessionCredentialStatus:
    'checkquest:session-credential-status',
  runEvent:
    'checkquest:run-event'
} as const;

const wholeNumber =
  (
    minimum:
      number,
    maximum:
      number,
    label:
      string
  ) =>
    z
      .number()
      .int(
        `${label} must be a whole number.`
      )
      .min(
        minimum,
        `${label} must be at least ${minimum}.`
      )
      .max(
        maximum,
        `${label} must be no more than ${maximum}.`
      );

export function normalizeDesktopTargetUrl(
  value:
    string
): string {
  const trimmed =
    value.trim();

  if (
    trimmed.length ===
      0 ||
    /^[a-z][a-z0-9+.-]*:\/\//i.test(
      trimmed
    )
  ) {
    return trimmed;
  }

  const authority =
    trimmed.split(
      /[/?#]/,
      1
    )[0] ??
    '';
  const isLocalTarget =
    /^localhost(?::\d+)?$/i.test(
      authority
    ) ||
    /^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?$/.test(
      authority
    ) ||
    authority.startsWith(
      '['
    );
  const candidate =
    `${
      isLocalTarget
        ? 'http'
        : 'https'
    }://${trimmed}`;

  try {
    return new URL(
      candidate
    ).toString();
  } catch {
    return candidate;
  }
}

function getTargetUrlValidationMessage(
  value:
    string
): string | null {
  let url:
    URL;

  try {
    url =
      new URL(
        value
      );
  } catch {
    return 'Target URL must be a complete HTTP or HTTPS URL.';
  }

  if (
    url.protocol !==
      'http:' &&
    url.protocol !==
      'https:'
  ) {
    return 'Target URL must use HTTP or HTTPS.';
  }

  if (
    url.username.length >
      0 ||
    url.password.length >
      0
  ) {
    return 'Target URL must not contain a username or password.';
  }

  const hostname =
    url.hostname
      .toLowerCase();

  if (
    hostname ===
      'localhost'
  ) {
    return null;
  }

  if (
    hostname.startsWith(
      '['
    ) &&
    hostname.endsWith(
      ']'
    ) &&
    hostname.includes(
      ':'
    )
  ) {
    return null;
  }

  const ipv4Parts =
    hostname.split(
      '.'
    );
  const isIpv4 =
    ipv4Parts.length ===
      4 &&
    ipv4Parts.every(
      part =>
        /^(?:0|[1-9]\d{0,2})$/.test(
          part
        ) &&
        Number(
          part
        ) <=
          255
    );

  if (
    isIpv4
  ) {
    return null;
  }

  const isDottedHostname =
    ipv4Parts.length >
      1 &&
    ipv4Parts.every(
      label =>
        /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(
          label
        )
    );

  return isDottedHostname
    ? null
    : 'Target URL must use a plausible website hostname, localhost, or an explicit IP address.';
}

const desktopStartRunInputSchema =
  z
    .object({
      targetUrl:
        z
          .string()
          .trim()
          .min(
            1,
            'Target URL is required.'
          )
          .max(
            2_048,
            'Target URL is too long.'
          )
          .superRefine(
            (
              value,
              context
            ) => {
              const message =
                getTargetUrlValidationMessage(
                  value
                );

              if (
                message !==
                  null
              ) {
                context.addIssue({
                  code:
                    'custom',
                  message
                });
              }
            }
          ),
      pageBudget:
        wholeNumber(
          desktopRunBudgetLimits
            .pages
            .minimum,
          desktopRunBudgetLimits
            .pages
            .maximum,
          'Page budget'
        ),
      navigationBudget:
        wholeNumber(
          desktopRunBudgetLimits
            .navigationSteps
            .minimum,
          desktopRunBudgetLimits
            .navigationSteps
            .maximum,
          'Navigation budget'
        ),
      investigationStepsPerPage:
        wholeNumber(
          desktopRunBudgetLimits
            .investigationStepsPerPage
            .minimum,
          desktopRunBudgetLimits
            .investigationStepsPerPage
            .maximum,
          'Investigation budget'
        ),
      geminiApiKey:
        z
          .string()
          .max(
            4_096,
            'Gemini API key is too long.'
          )
          .optional()
    })
    .strict();

export type DesktopStartRunValidation =
  | {
      success:
        true;
      input:
        DesktopStartRunInput;
    }
  | {
      success:
        false;
      message:
        string;
      fieldErrors:
        DesktopRunFieldErrors;
    };

export interface DesktopStartRunValidationOptions {
  sessionCredentialAvailable?:
    boolean;
}

function createDesktopRunFieldErrors(
  issues:
    z.core.$ZodIssue[]
): DesktopRunFieldErrors {
  const fieldErrors:
    DesktopRunFieldErrors =
      {};

  for (
    const issue of
      issues
  ) {
    const field =
      issue.path[0];

    if (
      typeof field ===
        'string' &&
      desktopRunFieldNames.includes(
        field as
          DesktopRunFieldName
      ) &&
      fieldErrors[
        field as
          DesktopRunFieldName
      ] ===
        undefined
    ) {
      fieldErrors[
        field as
          DesktopRunFieldName
      ] =
        issue.message;
    }
  }

  return fieldErrors;
}

function getRequestGeminiApiKey(
  value:
    unknown
): string | undefined {
  if (
    typeof value !==
      'object' ||
    value ===
      null ||
    !(
      'geminiApiKey' in
      value
    ) ||
    typeof value
      .geminiApiKey !==
      'string'
  ) {
    return undefined;
  }

  return value
    .geminiApiKey;
}

function normalizeDesktopStartRunValue(
  value:
    unknown
): unknown {
  if (
    typeof value !==
      'object' ||
    value ===
      null ||
    !(
      'targetUrl' in
      value
    ) ||
    typeof value.targetUrl !==
      'string'
  ) {
    return value;
  }

  return {
    ...value,
    targetUrl:
      normalizeDesktopTargetUrl(
        value.targetUrl
      )
  };
}

export function validateDesktopStartRunInput(
  value:
    unknown,
  options:
    DesktopStartRunValidationOptions =
      {}
): DesktopStartRunValidation {
  const result =
    desktopStartRunInputSchema
      .safeParse(
        normalizeDesktopStartRunValue(
          value
        )
      );
  const suppliedGeminiApiKey =
    getRequestGeminiApiKey(
      value
    );
  const hasSuppliedGeminiApiKey =
    suppliedGeminiApiKey !==
      undefined &&
    suppliedGeminiApiKey
      .trim()
      .length >
      0;
  const geminiApiKeyRequired =
    !hasSuppliedGeminiApiKey &&
    options
      .sessionCredentialAvailable !==
      true;

  if (
    !result.success
  ) {
    const fieldErrors =
      createDesktopRunFieldErrors(
        result.error
          .issues
      );

    if (
      geminiApiKeyRequired
    ) {
      fieldErrors
        .geminiApiKey =
          'Gemini API key is required.';
    }

    return {
      success:
        false,
      message:
        Object.values(
          fieldErrors
        )[0] ??
        'The run request is invalid.',
      fieldErrors
    };
  }

  if (
    geminiApiKeyRequired
  ) {
    return {
      success:
        false,
      message:
        'Gemini API key is required.',
      fieldErrors: {
        geminiApiKey:
          'Gemini API key is required.'
      }
    };
  }

  return {
    success:
      true,
    input:
      {
        ...result.data,
        ...(
          hasSuppliedGeminiApiKey
            ? {
                geminiApiKey:
                  suppliedGeminiApiKey
              }
            : {
                geminiApiKey:
                  undefined
              }
        )
      }
  };
}

const eventCommonSchema = {
  timestamp:
    z
      .string()
      .min(1)
      .max(64),
  runId:
    z
      .string()
      .min(1)
      .max(128),
  message:
    z
      .string()
      .max(4_096)
} as const;

const nonNegativeInteger =
  z
    .number()
    .int()
    .nonnegative();

const positiveInteger =
  z
    .number()
    .int()
    .positive();

const desktopRunEventSchemas:
  Readonly<
    Record<
      DesktopRunEvent['type'],
      z.ZodType
    >
  > = {
    'target-preflight-started':
      z.object({
        ...eventCommonSchema,
        type:
          z.literal(
            'target-preflight-started'
          )
      }),
    'run-started':
      z.object({
        ...eventCommonSchema,
        type:
          z.literal(
            'run-started'
          ),
        pageBudget:
          positiveInteger,
        navigationBudget:
          nonNegativeInteger
      }),
    'inspection-started':
      z.object({
        ...eventCommonSchema,
        type:
          z.literal(
            'inspection-started'
          ),
        pageNumber:
          positiveInteger
      }),
    'inspection-completed':
      z.object({
        ...eventCommonSchema,
        type:
          z.literal(
            'inspection-completed'
          ),
        pageNumber:
          positiveInteger,
        findingCount:
          nonNegativeInteger,
        diagnosticCount:
          nonNegativeInteger
      }),
    'navigation-started':
      z.object({
        ...eventCommonSchema,
        type:
          z.literal(
            'navigation-started'
          ),
        navigationStep:
          positiveInteger,
        navigationBudget:
          nonNegativeInteger,
        pageNumber:
          positiveInteger
      }),
    'navigation-completed':
      z.object({
        ...eventCommonSchema,
        type:
          z.literal(
            'navigation-completed'
          ),
        navigationStep:
          positiveInteger,
        navigationBudget:
          nonNegativeInteger,
        pageNumber:
          positiveInteger,
        outcome:
          z.enum([
            'ready-for-inspection',
            'duplicate-final-url'
          ])
      }),
    'model-request-started':
      z.object({
        ...eventCommonSchema,
        type:
          z.literal(
            'model-request-started'
          ),
        operation:
          z
            .string()
            .max(200),
        attempt:
          positiveInteger,
        maxAttempts:
          positiveInteger
      }),
    'model-request-retrying':
      z.object({
        ...eventCommonSchema,
        type:
          z.literal(
            'model-request-retrying'
          ),
        operation:
          z
            .string()
            .max(200),
        attempt:
          positiveInteger,
        maxAttempts:
          positiveInteger,
        retryDelayMs:
          nonNegativeInteger,
        statusCode:
          z
            .number()
            .int()
            .nullable()
      }),
    'model-request-completed':
      z.object({
        ...eventCommonSchema,
        type:
          z.literal(
            'model-request-completed'
          ),
        operation:
          z
            .string()
            .max(200),
        attempt:
          positiveInteger,
        maxAttempts:
          positiveInteger
      }),
    'investigation-completed':
      z.object({
        ...eventCommonSchema,
        type:
          z.literal(
            'investigation-completed'
          ),
        pageNumber:
          positiveInteger,
        status:
          z.enum([
            'verified',
            'not-verified',
            'inconclusive'
          ]),
        stepsUsed:
          nonNegativeInteger
      }),
    'run-completed':
      z.object({
        ...eventCommonSchema,
        type:
          z.literal(
            'run-completed'
          ),
        outcome:
          z.enum([
            'completed',
            'finished'
          ]),
        inspectedPageCount:
          nonNegativeInteger,
        findingCount:
          nonNegativeInteger,
        confirmedFindingCount:
          nonNegativeInteger,
        reviewFindingCount:
          nonNegativeInteger,
        technicalObservationCount:
          nonNegativeInteger,
        occurrenceCount:
          nonNegativeInteger
      }),
    'run-failed':
      z.object({
        ...eventCommonSchema,
        type:
          z.literal(
            'run-failed'
          ),
        code:
          z.enum([
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
        phase:
          z
            .string()
            .max(200)
            .optional(),
        pageNumber:
          positiveInteger
            .optional(),
        navigationStep:
          positiveInteger
            .optional()
      })
  };

export function projectDesktopRunEvent(
  value:
    unknown
): DesktopRunEvent | null {
  if (
    typeof value !==
      'object' ||
    value ===
      null ||
    !(
      'type' in
      value
    ) ||
    typeof value.type !==
      'string'
  ) {
    return null;
  }

  const type =
    value.type;

  if (
    !(
      type in
      desktopRunEventSchemas
    )
  ) {
    return null;
  }

  const schema =
    desktopRunEventSchemas[
      type as DesktopRunEvent[
        'type'
      ]
    ];
  const result =
    schema.safeParse(
      value
    );

  if (
    !result.success
  ) {
    return null;
  }

  /*
   * Zod object schemas strip unknown properties. This is the explicit
   * desktop-safe projection boundary: new or provider-specific fields are
   * never forwarded merely because a future RunEvent happens to contain them.
   */
  return result.data as
    DesktopRunEvent;
}

const desktopStartRunReplySchema =
  z.union([
    z.object({
      accepted:
        z.literal(
          true
        )
    }),
    z.object({
      accepted:
        z.literal(
          false
        ),
      reason:
        z.enum([
          'active-run',
          'invalid-request',
          'credential-rejected',
          'preflight-failed',
          'target-unreachable',
          'cancelled',
          'application-unavailable'
        ]),
      message:
        z
          .string()
          .max(1_000),
      fieldErrors:
        z
          .object({
            targetUrl:
              z
                .string()
                .max(1_000)
                .optional(),
            pageBudget:
              z
                .string()
                .max(1_000)
                .optional(),
            navigationBudget:
              z
                .string()
                .max(1_000)
                .optional(),
            investigationStepsPerPage:
              z
                .string()
                .max(1_000)
                .optional(),
            geminiApiKey:
              z
                .string()
                .max(1_000)
                .optional()
          })
          .optional()
    })
  ]);

export function projectDesktopStartRunReply(
  value:
    unknown
): DesktopStartRunReply {
  const result =
    desktopStartRunReplySchema
      .safeParse(
        value
      );

  if (
    result.success
  ) {
    return result.data;
  }

  return {
    accepted:
      false,
    reason:
      'application-unavailable',
    message:
      'The desktop application could not start the run.'
  };
}

const desktopCancelRunReplySchema =
  z.object({
    requested:
      z.boolean()
  });

export function projectDesktopCancelRunReply(
  value:
    unknown
): DesktopCancelRunReply {
  const result =
    desktopCancelRunReplySchema
      .safeParse(
        value
      );

  return result.success
    ? result.data
    : {
        requested:
          false
      };
}

const desktopSessionCredentialStatusSchema =
  z.object({
    available:
      z.boolean()
  });

export function projectDesktopSessionCredentialStatus(
  value:
    unknown
): DesktopSessionCredentialStatus {
  const result =
    desktopSessionCredentialStatusSchema
      .safeParse(
        value
      );

  return result.success
    ? result.data
    : {
        available:
          false
      };
}
