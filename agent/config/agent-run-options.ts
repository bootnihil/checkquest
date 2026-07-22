import type {
  SiteConfig
} from './site-config';

export interface AgentRunOptions {
  siteIdOrUrl: string;

  pages:
    number | null;

  exploratoryStepsPerPage:
    number | null;
}

export const agentRunOptionLimits = {
  pages: {
    minimum:
      1,

    maximum:
      20
  },

  exploratoryStepsPerPage: {
    minimum:
      0,

    maximum:
      10
  }
} as const;

function parseBoundedInteger(
  flagName: string,
  rawValue: string | undefined,
  minimum: number,
  maximum: number
): number {
  if (
    rawValue ===
    undefined
  ) {
    throw new Error(
      `Missing value after ${flagName}.`
    );
  }

  /*
   * Number("3.5") is valid JavaScript but not a valid
   * exploration budget, so the original text must represent
   * a complete integer.
   */
  if (
    !/^-?\d+$/.test(
      rawValue
    )
  ) {
    throw new Error(
      `Invalid value "${rawValue}" for ${flagName}. Expected a whole number from ${minimum} to ${maximum}.`
    );
  }

  const parsedValue =
    Number(
      rawValue
    );

  if (
    !Number.isSafeInteger(
      parsedValue
    )
  ) {
    throw new Error(
      `Invalid value "${rawValue}" for ${flagName}. Expected a safe whole number.`
    );
  }

  if (
    parsedValue <
      minimum ||
    parsedValue >
      maximum
  ) {
    throw new Error(
      `Value for ${flagName} must be from ${minimum} to ${maximum}. Received ${parsedValue}.`
    );
  }

  return parsedValue;
}

export function parseAgentRunOptions(
  args: string[]
): AgentRunOptions {
  let siteIdOrUrl:
    string | null =
      null;

  let pages:
    number | null =
      null;

  let exploratoryStepsPerPage:
    number | null =
      null;

  for (
    let argumentIndex = 0;
    argumentIndex <
      args.length;
    argumentIndex += 1
  ) {
    const argument =
      args[
        argumentIndex
      ];

    if (
      argument ===
      '--pages'
    ) {
      if (
        pages !==
        null
      ) {
        throw new Error(
          'The --pages option may be supplied only once.'
        );
      }

      pages =
        parseBoundedInteger(
          '--pages',
          args[
            argumentIndex + 1
          ],
          agentRunOptionLimits
            .pages
            .minimum,
          agentRunOptionLimits
            .pages
            .maximum
        );

      argumentIndex +=
        1;

      continue;
    }

    if (
      argument ===
      '--steps-per-page'
    ) {
      if (
        exploratoryStepsPerPage !==
        null
      ) {
        throw new Error(
          'The --steps-per-page option may be supplied only once.'
        );
      }

      exploratoryStepsPerPage =
        parseBoundedInteger(
          '--steps-per-page',
          args[
            argumentIndex + 1
          ],
          agentRunOptionLimits
            .exploratoryStepsPerPage
            .minimum,
          agentRunOptionLimits
            .exploratoryStepsPerPage
            .maximum
        );

      argumentIndex +=
        1;

      continue;
    }

    if (
      argument.startsWith(
        '--'
      )
    ) {
      throw new Error(
        `Unknown command-line option "${argument}". Supported options are --pages and --steps-per-page.`
      );
    }

    if (
      siteIdOrUrl !==
      null
    ) {
      throw new Error(
        `Unexpected positional argument "${argument}". Supply only one configured site ID or URL.`
      );
    }

    siteIdOrUrl =
      argument;
  }

  return {
    /*
     * Preserve the existing behavior when no target is supplied.
     */
    siteIdOrUrl:
      siteIdOrUrl ??
      'aidoc',

    pages,

    exploratoryStepsPerPage
  };
}

export function applyAgentRunOptions(
  baseSite:
    SiteConfig,
  options:
    AgentRunOptions
): SiteConfig {
  const maxPages =
    options.pages ??
    baseSite.maxPages;

  return {
    ...baseSite,

    maxPages,

    /*
     * Each inspected page normally requires one site-level
     * navigation decision.
     *
     * Raising the page limit must therefore also raise the
     * navigation budget when the original budget is smaller.
     */
    maxAgentSteps:
      Math.max(
        baseSite.maxAgentSteps,
        maxPages
      ),

    maxExploratoryStepsPerPage:
      options
        .exploratoryStepsPerPage ??
      baseSite
        .maxExploratoryStepsPerPage
  };
}
