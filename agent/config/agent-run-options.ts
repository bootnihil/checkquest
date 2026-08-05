import { CheckQuestError } from '../errors/checkquest-error';

function createCliArgumentError(message: string): CheckQuestError {
  return new CheckQuestError('CONFIGURATION', message, {
    phase: 'cli-argument-parsing'
  });
}

export interface AgentRunOptions {
  siteIdOrUrl: string;

  pages: number | null;

  navigationSteps: number | null;

  exploratoryStepsPerPage: number | null;
}

export const agentRunOptionLimits = {
  pages: {
    minimum: 1,

    maximum: 20
  },

  navigationSteps: {
    minimum: 1,

    maximum: 50
  },

  exploratoryStepsPerPage: {
    minimum: 0,

    maximum: 10
  }
} as const;

function parseBoundedInteger(
  flagName: string,
  rawValue: string | undefined,
  minimum: number,
  maximum: number
): number {
  if (rawValue === undefined) {
    throw createCliArgumentError(`Missing value after ${flagName}.`);
  }

  /*
   * Number("3.5") is valid JavaScript but not a valid
   * exploration budget, so the original text must represent
   * a complete integer.
   */
  if (!/^-?\d+$/.test(rawValue)) {
    throw createCliArgumentError(
      `Invalid value for ${flagName}. Expected a whole number from ${minimum} to ${maximum}.`
    );
  }

  const parsedValue = Number(rawValue);

  if (!Number.isSafeInteger(parsedValue)) {
    throw createCliArgumentError(`Invalid value for ${flagName}. Expected a safe whole number.`);
  }

  if (parsedValue < minimum || parsedValue > maximum) {
    throw createCliArgumentError(`Value for ${flagName} must be from ${minimum} to ${maximum}.`);
  }

  return parsedValue;
}

export function parseAgentRunOptions(args: string[]): AgentRunOptions {
  let siteIdOrUrl: string | null = null;

  let pages: number | null = null;

  let navigationSteps: number | null = null;

  let exploratoryStepsPerPage: number | null = null;

  for (let argumentIndex = 0; argumentIndex < args.length; argumentIndex += 1) {
    const argument = args[argumentIndex];

    if (argument === '--pages') {
      if (pages !== null) {
        throw createCliArgumentError('The --pages option may be supplied only once.');
      }

      pages = parseBoundedInteger(
        '--pages',
        args[argumentIndex + 1],
        agentRunOptionLimits.pages.minimum,
        agentRunOptionLimits.pages.maximum
      );

      argumentIndex += 1;

      continue;
    }

    if (argument === '--navigation-steps') {
      if (navigationSteps !== null) {
        throw createCliArgumentError('The --navigation-steps option may be supplied only once.');
      }

      navigationSteps = parseBoundedInteger(
        '--navigation-steps',
        args[argumentIndex + 1],
        agentRunOptionLimits.navigationSteps.minimum,
        agentRunOptionLimits.navigationSteps.maximum
      );

      argumentIndex += 1;

      continue;
    }

    if (argument === '--steps-per-page') {
      if (exploratoryStepsPerPage !== null) {
        throw createCliArgumentError('The --steps-per-page option may be supplied only once.');
      }

      exploratoryStepsPerPage = parseBoundedInteger(
        '--steps-per-page',
        args[argumentIndex + 1],
        agentRunOptionLimits.exploratoryStepsPerPage.minimum,
        agentRunOptionLimits.exploratoryStepsPerPage.maximum
      );

      argumentIndex += 1;

      continue;
    }

    if (argument.startsWith('--')) {
      throw createCliArgumentError(
        'Unknown command-line option. Supported options are --pages, --navigation-steps, and --steps-per-page.'
      );
    }

    if (siteIdOrUrl !== null) {
      throw createCliArgumentError(
        'Unexpected positional argument. Supply only one configured site ID or URL.'
      );
    }

    siteIdOrUrl = argument;
  }

  return {
    /*
     * Preserve the existing behavior when no target is supplied.
     */
    siteIdOrUrl: siteIdOrUrl ?? 'aidoc',

    pages,

    navigationSteps,

    exploratoryStepsPerPage
  };
}
