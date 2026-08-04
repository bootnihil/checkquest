import type { SiteConfig } from '../config/site-config';
import { CheckQuestError } from '../errors/checkquest-error';
import { createRunId } from '../reporting/report-utils';

export interface RunSiteValidationInput {
  site: SiteConfig;
  startedAt?: Date;
  runId?: string;
  model?: string;
}

export interface ValidatedRunSiteInput {
  site: SiteConfig;
  startedAt: Date;
  runId: string;
  configuredStartUrl: URL;
}

function configurationError(message: string, cause?: unknown): CheckQuestError {
  return new CheckQuestError('CONFIGURATION', message, {
    phase: 'run-input-validation',
    cause
  });
}

function validateBudget(label: string, value: number, minimum: number): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw configurationError(
      `${label} must be a safe whole number greater than or equal to ${minimum}.`
    );
  }
}

function validateRunId(runId: string): void {
  const windowsReservedName = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(runId) || windowsReservedName.test(runId)) {
    throw configurationError(
      'runId must contain 1-128 letters, numbers, underscores, or hyphens and must start with a letter or number.'
    );
  }
}

export function validateRunSiteInput(input: RunSiteValidationInput): ValidatedRunSiteInput {
  const { site } = input;

  const startedAt = input.startedAt ?? new Date();

  if (!(startedAt instanceof Date) || !Number.isFinite(startedAt.getTime())) {
    throw configurationError('startedAt must be a valid Date.');
  }

  const runId = input.runId ?? createRunId(startedAt);

  validateRunId(runId);

  let configuredStartUrl: URL;

  try {
    configuredStartUrl = new URL(site.startUrl);
  } catch (error: unknown) {
    throw configurationError('startUrl must be a valid HTTP or HTTPS URL.', error);
  }

  if (configuredStartUrl.protocol !== 'http:' && configuredStartUrl.protocol !== 'https:') {
    throw configurationError('startUrl must use the HTTP or HTTPS protocol.');
  }

  if (
    !Array.isArray(site.allowedHosts) ||
    site.allowedHosts.length === 0 ||
    site.allowedHosts.some(host => typeof host !== 'string' || host.trim().length === 0)
  ) {
    throw configurationError('allowedHosts must contain at least one non-empty host.');
  }

  if (!site.allowedHosts.includes(configuredStartUrl.hostname)) {
    throw configurationError(
      `Configured start host "${configuredStartUrl.hostname}" is not allowed.`
    );
  }

  validateBudget('maxPages', site.maxPages, 1);

  if (
    input.model !== undefined &&
    (typeof input.model !== 'string' || input.model.trim().length === 0)
  ) {
    throw configurationError('model must be a non-empty string when supplied.');
  }
  validateBudget('maxAgentSteps', site.maxAgentSteps, 0);
  validateBudget('maxExploratoryStepsPerPage', site.maxExploratoryStepsPerPage, 0);

  if (typeof site.allowFormSubmission !== 'boolean') {
    throw configurationError('allowFormSubmission must be a boolean.');
  }

  return {
    site,
    startedAt,
    runId,
    configuredStartUrl
  };
}
