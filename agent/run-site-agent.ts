import {
  applyAgentRunOptions,
  parseAgentRunOptions
} from './config/agent-run-options';
import {
  renderRunEvent
} from './cli/render-run-event';
import {
  CheckQuestError,
  formatPublicError
} from './errors/checkquest-error';
import {
  resolveRunSiteCredentials
} from './cli/resolve-run-site-credentials';
import {
  createRunId
} from './reporting/report-utils';
import {
  writeJsonReport
} from './reporting/write-json-report';
import {
  writeMarkdownReport
} from './reporting/write-markdown-report';
import {
  runSite
} from './run/run-site';
import {
  getSiteConfig
} from './sites';

async function main(): Promise<void> {
  const startedAt =
    new Date();

  const runId =
    createRunId(
      startedAt
    );

  const runOptions =
    parseAgentRunOptions(
      process.argv.slice(
        2
      )
    );

  const baseSite =
    getSiteConfig(
      runOptions.siteIdOrUrl
    );

  const site =
    applyAgentRunOptions(
      baseSite,
      runOptions
    );

  const report =
    await runSite({
      site,
      credentials:
        resolveRunSiteCredentials(
          process.env
        ),
      startedAt,
      runId,
      onEvent:
        renderRunEvent
    });

  let writtenJsonReport:
    Awaited<
      ReturnType<
        typeof writeJsonReport
      >
    >;

  let writtenMarkdownReport:
    Awaited<
      ReturnType<
        typeof writeMarkdownReport
      >
    >;

  try {
    writtenJsonReport =
      await writeJsonReport(
        report
      );

    writtenMarkdownReport =
      await writeMarkdownReport(
        report
      );
  } catch (
    error:
      unknown
  ) {
    throw new CheckQuestError(
      'REPORTING',
      'The run completed, but its report files could not be persisted.',
      {
        phase:
          'report-persistence',
        runId,
        cause:
          error
      }
    );
  }

  console.log(
    '\nExploration outcome:'
  );

  console.log(
    `Type: ${report.outcome.type}`
  );

  console.log(
    `Summary: ${report.outcome.summary}`
  );

  console.log(
    `\nJSON report saved: ${writtenJsonReport.filePath}`
  );

  console.log(
    `Markdown report saved: ${writtenMarkdownReport.filePath}`
  );

  console.log(
    '\nAgent run complete.'
  );
}

main().catch(
  (error: unknown) => {
    console.error(
      `CheckQuest failed: ${formatPublicError(
        error
      )}`
    );

    process.exitCode =
      1;
  }
);
