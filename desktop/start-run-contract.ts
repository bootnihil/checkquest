import { z } from 'zod';

import { runtimeSiteDefaults } from '../agent/config/site-config';

export const desktopRunBudgetLimits = {
  pages: {
    minimum: 1,
    maximum: 20
  },
  navigationSteps: {
    minimum: 1,
    maximum: 50
  },
  investigationStepsPerPage: {
    minimum: 1,
    maximum: 10
  }
} as const;

export const desktopRunDefaults = {
  pageBudget: runtimeSiteDefaults.maxPages,
  navigationBudget: runtimeSiteDefaults.maxAgentSteps,
  investigationStepsPerPage: runtimeSiteDefaults.maxExploratoryStepsPerPage
} as const;

export interface DesktopStartRunInput {
  targetUrl: string;
  pageBudget: number;
  navigationBudget: number;
  investigationStepsPerPage: number;
  geminiApiKey?: string;
}

export const desktopRunFieldNames = [
  'targetUrl',
  'pageBudget',
  'navigationBudget',
  'investigationStepsPerPage',
  'geminiApiKey'
] as const satisfies readonly (keyof DesktopStartRunInput)[];

export type DesktopRunFieldName = (typeof desktopRunFieldNames)[number];

export type DesktopRunFieldErrors = Partial<Record<DesktopRunFieldName, string>>;

const wholeNumber = (minimum: number, maximum: number, label: string) =>
  z
    .number()
    .int(`${label} must be a whole number.`)
    .min(minimum, `${label} must be at least ${minimum}.`)
    .max(maximum, `${label} must be no more than ${maximum}.`);

export function normalizeDesktopTargetUrl(value: string): string {
  const trimmed = value.trim();

  if (trimmed.length === 0 || /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    return trimmed;
  }

  const authority = trimmed.split(/[/?#]/, 1)[0] ?? '';
  const isLocalTarget =
    /^localhost(?::\d+)?$/i.test(authority) ||
    /^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?$/.test(authority) ||
    authority.startsWith('[');
  const candidate = `${isLocalTarget ? 'http' : 'https'}://${trimmed}`;

  try {
    return new URL(candidate).toString();
  } catch {
    return candidate;
  }
}

function getTargetUrlValidationMessage(value: string): string | null {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return 'Target URL must be a complete HTTP or HTTPS URL.';
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return 'Target URL must use HTTP or HTTPS.';
  }

  if (url.username.length > 0 || url.password.length > 0) {
    return 'Target URL must not contain a username or password.';
  }

  const hostname = url.hostname.toLowerCase();

  if (hostname === 'localhost') {
    return null;
  }

  if (hostname.startsWith('[') && hostname.endsWith(']') && hostname.includes(':')) {
    return null;
  }

  const ipv4Parts = hostname.split('.');
  const isIpv4 =
    ipv4Parts.length === 4 &&
    ipv4Parts.every(part => /^(?:0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255);

  if (isIpv4) {
    return null;
  }

  const isDottedHostname =
    ipv4Parts.length > 1 &&
    ipv4Parts.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));

  return isDottedHostname
    ? null
    : 'Target URL must use a plausible website hostname, localhost, or an explicit IP address.';
}

const desktopStartRunInputSchema = z
  .object({
    targetUrl: z
      .string()
      .trim()
      .min(1, 'Target URL is required.')
      .max(2_048, 'Target URL is too long.')
      .superRefine((value, context) => {
        const message = getTargetUrlValidationMessage(value);

        if (message !== null) {
          context.addIssue({
            code: 'custom',
            message
          });
        }
      }),
    pageBudget: wholeNumber(
      desktopRunBudgetLimits.pages.minimum,
      desktopRunBudgetLimits.pages.maximum,
      'Page budget'
    ),
    navigationBudget: wholeNumber(
      desktopRunBudgetLimits.navigationSteps.minimum,
      desktopRunBudgetLimits.navigationSteps.maximum,
      'Navigation budget'
    ),
    investigationStepsPerPage: wholeNumber(
      desktopRunBudgetLimits.investigationStepsPerPage.minimum,
      desktopRunBudgetLimits.investigationStepsPerPage.maximum,
      'Investigation budget'
    ),
    geminiApiKey: z.string().max(4_096, 'Gemini API key is too long.').optional()
  })
  .strict();

export type DesktopStartRunValidation =
  | {
      success: true;
      input: DesktopStartRunInput;
    }
  | {
      success: false;
      message: string;
      fieldErrors: DesktopRunFieldErrors;
    };

export interface DesktopStartRunValidationOptions {
  sessionCredentialAvailable?: boolean;
}

function createDesktopRunFieldErrors(issues: z.core.$ZodIssue[]): DesktopRunFieldErrors {
  const fieldErrors: DesktopRunFieldErrors = {};

  for (const issue of issues) {
    const field = issue.path[0];

    if (
      typeof field === 'string' &&
      desktopRunFieldNames.includes(field as DesktopRunFieldName) &&
      fieldErrors[field as DesktopRunFieldName] === undefined
    ) {
      fieldErrors[field as DesktopRunFieldName] = issue.message;
    }
  }

  return fieldErrors;
}

function getRequestGeminiApiKey(value: unknown): string | undefined {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('geminiApiKey' in value) ||
    typeof value.geminiApiKey !== 'string'
  ) {
    return undefined;
  }

  return value.geminiApiKey;
}

function normalizeDesktopStartRunValue(value: unknown): unknown {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('targetUrl' in value) ||
    typeof value.targetUrl !== 'string'
  ) {
    return value;
  }

  return {
    ...value,
    targetUrl: normalizeDesktopTargetUrl(value.targetUrl)
  };
}

export function validateDesktopStartRunInput(
  value: unknown,
  options: DesktopStartRunValidationOptions = {}
): DesktopStartRunValidation {
  const result = desktopStartRunInputSchema.safeParse(normalizeDesktopStartRunValue(value));
  const suppliedGeminiApiKey = getRequestGeminiApiKey(value);
  const hasSuppliedGeminiApiKey =
    suppliedGeminiApiKey !== undefined && suppliedGeminiApiKey.trim().length > 0;
  const geminiApiKeyRequired =
    !hasSuppliedGeminiApiKey && options.sessionCredentialAvailable !== true;

  if (!result.success) {
    const fieldErrors = createDesktopRunFieldErrors(result.error.issues);

    if (geminiApiKeyRequired) {
      fieldErrors.geminiApiKey = 'Gemini API key is required.';
    }

    return {
      success: false,
      message: Object.values(fieldErrors)[0] ?? 'The run request is invalid.',
      fieldErrors
    };
  }

  if (geminiApiKeyRequired) {
    return {
      success: false,
      message: 'Gemini API key is required.',
      fieldErrors: {
        geminiApiKey: 'Gemini API key is required.'
      }
    };
  }

  return {
    success: true,
    input: {
      ...result.data,
      ...(hasSuppliedGeminiApiKey
        ? {
            geminiApiKey: suppliedGeminiApiKey
          }
        : {
            geminiApiKey: undefined
          })
    }
  };
}
