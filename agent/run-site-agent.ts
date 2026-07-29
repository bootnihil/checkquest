import {
  parseAgentRunOptions
} from './config/agent-run-options';
import {
  renderRunEvent
} from './cli/render-run-event';
import {
  formatPublicError
} from './errors/checkquest-error';
import {
  formatDeveloperErrorDiagnostic,
  isDeveloperDiagnosticsEnabled
} from './errors/format-developer-diagnostic';
import {
  resolveRunSiteCredentials
} from './cli/resolve-run-site-credentials';
import {
  startCheckQuest
} from './application/start-checkquest';

async function main(): Promise<void> {
  const runOptions =
    parseAgentRunOptions(
      process.argv.slice(
        2
      )
    );

  const run =
    startCheckQuest({
      target:
        runOptions
          .siteIdOrUrl,
      budgets: {
        ...(runOptions.pages ===
        null
          ? {}
          : {
              pages:
                runOptions.pages
            }),
        ...(runOptions
          .navigationSteps ===
        null
          ? {}
          : {
              navigationSteps:
                runOptions
                  .navigationSteps
            }),
        ...(runOptions
          .exploratoryStepsPerPage ===
        null
          ? {}
          : {
              investigationStepsPerPage:
                runOptions
                  .exploratoryStepsPerPage
            })
      },
      credentials:
        resolveRunSiteCredentials(
          process.env
        ),
      model:
        process.env
          .GEMINI_MODEL,
      onEvent:
        renderRunEvent,
      developerDiagnostics: {
        enabled:
          isDeveloperDiagnosticsEnabled(
            process.env
          )
      }
    });

  const cancelRun =
    (): void => {
      run.cancel();
    };
  process.on(
    'SIGINT',
    cancelRun
  );

  let result:
    Awaited<
      typeof run.result
    >;
  try {
    result =
      await run.result;
  } finally {
    process.removeListener(
      'SIGINT',
      cancelRun
    );
  }

  const {
    report
  } = result;

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
    `\nJSON report saved: ${result.jsonReportPath}`
  );

  console.log(
    `Markdown report saved: ${result.markdownReportPath}`
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

    if (
      isDeveloperDiagnosticsEnabled(
        process.env
      )
    ) {
      console.error(
        formatDeveloperErrorDiagnostic(
          error,
          {
            secrets: [
              process.env
                .GEMINI_API_KEY
            ]
          }
        )
      );
    }

    process.exitCode =
      1;
  }
);
