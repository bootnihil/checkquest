import {
  spawnSync
} from 'node:child_process';

const deterministicChecks = [
  'agent:run-options-check',
  'agent:site-config-check',
  'agent:run-site-api-check',
  'agent:error-handling-check',
  'agent:gemini-hardening-check',
  'agent:run-event-check',
  'agent:evaluation-check',
  'agent:visited-links-check',
  'agent:diagnostics-classification-check',
  'agent:route-value-check',
  'agent:navigation-policy-check',
  'agent:exploratory-qa-schema-check',
  'agent:action-schema-check',
  'agent:planner-schema-check',
  'agent:planner-prompt-check',
  'agent:finding-investigation-outcome-check',
  'agent:known-findings-check',
  'agent:site-wide-findings-check',
  'agent:site-wide-report-check',
  'agent:unified-findings-check',
  'agent:finding-reconciliation-check',
  'agent:unified-lifecycle-check',
  'agent:run-finding-lifecycle-check',
  'agent:run-finding-lifecycle-integrity-check',
  'agent:passive-security-check',
  'agent:passive-security-report-check'
] as const;

function runCheck(
  check: string,
  index: number,
  total: number
): boolean {
  console.log(
    `\n[${index}/${total}] ${check}`
  );

  const npmCli =
    process.env
      .npm_execpath;

  if (!npmCli) {
    console.error(
      'Unable to locate the npm CLI through npm_execpath.'
    );

    return false;
  }

  const result =
    spawnSync(
      process.execPath,
      [
        npmCli,
        'run',
        check
      ],
      {
        stdio:
          'inherit'
      }
    );

  if (result.error) {
    console.error(
      `Unable to run ${check}.`,
      result.error
    );

    return false;
  }

  if (result.status !== 0) {
    console.error(
      `${check} failed with exit code ${result.status ?? 'unknown'}.`
    );

    return false;
  }

  return true;
}

function main(): void {
  const requestedChecks =
    process.argv.slice(2);

  const checks:
    readonly string[] =
    requestedChecks.length > 0
      ? requestedChecks
      : deterministicChecks;

  for (
    let index = 0;
    index < checks.length;
    index += 1
  ) {
    const check =
      checks[index];

    if (
      check === undefined ||
      !runCheck(
        check,
        index + 1,
        checks.length
      )
    ) {
      process.exitCode =
        1;

      return;
    }
  }

  console.log(
    `\nAll ${checks.length} deterministic regression checks passed.`
  );
}

main();
