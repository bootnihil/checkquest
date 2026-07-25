import assert from 'node:assert/strict';
import {
  spawnSync
} from 'node:child_process';
import {
  createRequire
} from 'node:module';
import {
  fileURLToPath
} from 'node:url';

import {
  formatPublicError
} from './errors/checkquest-error';

interface CliResult {
  status: number | null;
  output: string;
}

const require =
  createRequire(
    import.meta.url
  );

const tsxCliPath =
  require.resolve(
    'tsx/cli'
  );

const runSiteAgentPath =
  fileURLToPath(
    new URL(
      './run-site-agent.ts',
      import.meta.url
    )
  );

function runCli(
  args: string[]
): CliResult {
  const result =
    spawnSync(
      process.execPath,
      [
        tsxCliPath,
        runSiteAgentPath,
        ...args
      ],
      {
        cwd:
          process.cwd(),
        encoding:
          'utf8'
      }
    );

  if (result.error) {
    throw new Error(
      'Unable to execute the CheckQuest CLI regression scenario.',
      {
        cause:
          result.error
      }
    );
  }

  return {
    status:
      result.status,
    output:
      `${result.stdout}${result.stderr}`
  };
}

function assertConfigurationFailure(
  label: string,
  args: string[],
  expectedMessagePart: string,
  forbiddenValues:
    string[] = []
): void {
  const result =
    runCli(
      args
    );

  assert.notEqual(
    result.status,
    0,
    `${label}: expected a non-zero exit code.`
  );
  assert.match(
    result.output,
    /CheckQuest failed: \[CONFIGURATION\]/
  );
  assert.match(
    result.output,
    new RegExp(
      expectedMessagePart,
      'i'
    )
  );
  assert.doesNotMatch(
    result.output,
    /unexpected CheckQuest failure/i
  );

  for (
    const forbiddenValue of
      forbiddenValues
  ) {
    assert.equal(
      result.output.includes(
        forbiddenValue
      ),
      false,
      `${label}: public output exposed a caller-supplied sentinel.`
    );
  }
}

function main(): void {
  assertConfigurationFailure(
    'Unknown option',
    [
      '--unknown-option'
    ],
    'Supported options'
  );

  assertConfigurationFailure(
    'Missing option value',
    [
      'aidoc',
      '--pages'
    ],
    'Missing value'
  );

  const numericSecret =
    'CLI_NUMERIC_SECRET_SENTINEL';

  assertConfigurationFailure(
    'Invalid numeric option value',
    [
      'aidoc',
      '--pages',
      numericSecret
    ],
    'Expected a whole number',
    [
      numericSecret
    ]
  );

  assertConfigurationFailure(
    'Duplicate option',
    [
      'aidoc',
      '--pages',
      '2',
      '--pages',
      '3'
    ],
    'only once'
  );

  const positionalSecret =
    'CLI_POSITIONAL_SECRET_SENTINEL';

  assertConfigurationFailure(
    'Unexpected positional argument',
    [
      'aidoc',
      positionalSecret
    ],
    'only one configured site ID or URL',
    [
      positionalSecret
    ]
  );

  const unknownSiteSecret =
    'CLI_UNKNOWN_SITE_SECRET_SENTINEL';

  assertConfigurationFailure(
    'Unknown configured site',
    [
      unknownSiteSecret
    ],
    'configured site',
    [
      unknownSiteSecret
    ]
  );

  const urlSecret =
    'CLI_URL_SECRET_SENTINEL';

  assertConfigurationFailure(
    'Malformed sensitive runtime URL',
    [
      `https://user:${urlSecret}@[`
    ],
    'complete http:// or https:// URL',
    [
      'user',
      urlSecret
    ]
  );

  const unexpectedSecret =
    'UNEXPECTED_INTERNAL_SECRET_SENTINEL';
  const unexpectedPublicMessage =
    formatPublicError(
      new Error(
        unexpectedSecret
      )
    );

  assert.equal(
    unexpectedPublicMessage,
    'An unexpected CheckQuest failure occurred.'
  );
  assert.equal(
    unexpectedPublicMessage.includes(
      unexpectedSecret
    ),
    false
  );
  assert.equal(
    unexpectedPublicMessage.includes(
      'CONFIGURATION'
    ),
    false
  );

  console.log(
    'CLI configuration classification and public-output privacy checks passed.'
  );
}

main();
