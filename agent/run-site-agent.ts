import {
  applyAgentRunOptions,
  parseAgentRunOptions
} from './config/agent-run-options';
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
      startedAt,
      runId
    });

  const writtenJsonReport =
    await writeJsonReport(
      report
    );

  const writtenMarkdownReport =
    await writeMarkdownReport(
      report
    );

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
      'Site agent run failed:',
      error
    );

    process.exitCode =
      1;
  }
);
