import {
  agentRunOptionLimits,
  applyAgentRunOptions,
  parseAgentRunOptions
} from './config/agent-run-options';

import type {
  SiteConfig
} from './config/site-config';

function expectError(
  label: string,
  callback: () => unknown,
  expectedMessagePart: string
): void {
  try {
    callback();
  } catch (
    error: unknown
  ) {
    const message =
      error instanceof Error
        ? error.message
        : String(
            error
          );

    if (
      !message.includes(
        expectedMessagePart
      )
    ) {
      throw new Error(
        `${label}: expected an error containing "${expectedMessagePart}", received "${message}".`
      );
    }

    return;
  }

  throw new Error(
    `${label}: expected an error, but no error was thrown.`
  );
}

function main(): void {
  const baseSite:
    SiteConfig = {
    id:
      'synthetic',

    name:
      'Synthetic site',

    startUrl:
      'https://example.com/',

    allowedHosts: [
      'example.com'
    ],

    maxPages:
      3,

    maxAgentSteps:
      4,

    maxExploratoryStepsPerPage:
      3,

    allowFormSubmission:
      false
  };

  const defaults =
    parseAgentRunOptions([]);

  if (
    defaults.siteIdOrUrl !==
      'aidoc' ||
    defaults.pages !==
      null ||
    defaults.exploratoryStepsPerPage !==
      null
  ) {
    throw new Error(
      'Default CLI options were not parsed correctly.'
    );
  }

  const parsed =
    parseAgentRunOptions([
      'https://example.com/',
      '--pages',
      '7',
      '--steps-per-page',
      '4'
    ]);

  if (
    parsed.siteIdOrUrl !==
      'https://example.com/'
  ) {
    throw new Error(
      'The positional site URL was not parsed correctly.'
    );
  }

  if (
    parsed.pages !==
    7
  ) {
    throw new Error(
      'The --pages value was not parsed correctly.'
    );
  }

  if (
    parsed.exploratoryStepsPerPage !==
    4
  ) {
    throw new Error(
      'The --steps-per-page value was not parsed correctly.'
    );
  }

  const overriddenSite =
    applyAgentRunOptions(
      baseSite,
      parsed
    );

  if (
    overriddenSite.maxPages !==
    7
  ) {
    throw new Error(
      'The page override was not applied correctly.'
    );
  }

  if (
    overriddenSite.maxAgentSteps !==
    7
  ) {
    throw new Error(
      'The navigation budget was not raised to support the requested page limit.'
    );
  }

  if (
    overriddenSite
      .maxExploratoryStepsPerPage !==
    4
  ) {
    throw new Error(
      'The exploratory step override was not applied correctly.'
    );
  }

  if (
    baseSite.maxPages !==
      3 ||
    baseSite.maxAgentSteps !==
      4 ||
    baseSite
      .maxExploratoryStepsPerPage !==
      3
  ) {
    throw new Error(
      'The base site configuration was mutated.'
    );
  }

  const analysisOnly =
    applyAgentRunOptions(
      baseSite,
      parseAgentRunOptions([
        'synthetic',
        '--steps-per-page',
        '0'
      ])
    );

  if (
    analysisOnly
      .maxExploratoryStepsPerPage !==
    0
  ) {
    throw new Error(
      'A zero-step analysis-only run was not accepted.'
    );
  }

  expectError(
    'Missing pages value',
    () =>
      parseAgentRunOptions([
        'aidoc',
        '--pages'
      ]),
    'Missing value after --pages'
  );

  expectError(
    'Decimal pages value',
    () =>
      parseAgentRunOptions([
        'aidoc',
        '--pages',
        '3.5'
      ]),
    'Expected a whole number'
  );

  expectError(
    'Pages below minimum',
    () =>
      parseAgentRunOptions([
        'aidoc',
        '--pages',
        String(
          agentRunOptionLimits
            .pages
            .minimum -
          1
        )
      ]),
    'must be from'
  );

  expectError(
    'Pages above maximum',
    () =>
      parseAgentRunOptions([
        'aidoc',
        '--pages',
        String(
          agentRunOptionLimits
            .pages
            .maximum +
          1
        )
      ]),
    'must be from'
  );

  expectError(
    'Exploratory steps above maximum',
    () =>
      parseAgentRunOptions([
        'aidoc',
        '--steps-per-page',
        String(
          agentRunOptionLimits
            .exploratoryStepsPerPage
            .maximum +
          1
        )
      ]),
    'must be from'
  );

  expectError(
    'Duplicate pages option',
    () =>
      parseAgentRunOptions([
        'aidoc',
        '--pages',
        '3',
        '--pages',
        '4'
      ]),
    'may be supplied only once'
  );

  expectError(
    'Unknown option',
    () =>
      parseAgentRunOptions([
        'aidoc',
        '--banana',
        '5'
      ]),
    'Unknown command-line option'
  );

  expectError(
    'Extra positional argument',
    () =>
      parseAgentRunOptions([
        'aidoc',
        'https://example.com/'
      ]),
    'Unexpected positional argument'
  );

  console.log(
    'Agent run option parsing and overrides passed.'
  );

  console.log(
    JSON.stringify(
      {
        parsed,
        overriddenSite,
        analysisOnly
      },
      null,
      2
    )
  );
}

main();
