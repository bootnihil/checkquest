import {
  resolve
} from 'node:path';

import type {
  SiteAgentReport
} from '../reporting/report-types';
import {
  persistSiteAgentReport
} from '../reporting/persist-site-agent-report';
import {
  createRunId
} from '../reporting/report-utils';
import {
  runSite,
  type RunSiteCredentials,
  type RunSiteDependencies
} from '../run/run-site';
import {
  createRunEventEmitter,
  createRunFailureEvent,
  deliverRunEvent,
  type RunEvent,
  type RunEventObserver
} from '../run/run-event';
import {
  getSiteConfig
} from '../sites';
import {
  throwIfRunCancelled
} from '../errors/run-cancellation';
import {
  sanitizeApplicationError,
  sanitizeApplicationValue
} from './sanitize-application-boundary';

export interface CheckQuestRunBudgets {
  pages?:
    number;
  navigationSteps?:
    number;
  investigationStepsPerPage?:
    number;
}

export interface StartCheckQuestInput {
  target:
    string;
  budgets?:
    CheckQuestRunBudgets;
  credentials?:
    RunSiteCredentials;
  model?:
    string;
  onEvent?:
    RunEventObserver;

  /*
   * This remains the existing narrow collaborator seam used by local,
   * Gemini-free integration tests. Product shells do not need it.
   */
  dependencies?:
    RunSiteDependencies;
}

export interface CheckQuestRunResult {
  report:
    SiteAgentReport;
  reportDirectoryPath:
    string;
  jsonReportPath:
    string;
  markdownReportPath:
    string;
}

export interface CheckQuestRun {
  result:
    Promise<
      CheckQuestRunResult
    >;
  cancel:
    () => void;
}

function emitCompletedEvent(
  event:
    Extract<
      RunEvent,
      {
        type:
          'run-completed';
      }
    >,
  observer:
    RunEventObserver | undefined
): void {
  createRunEventEmitter(
    event.runId,
    observer
  )({
    type:
      event.type,
    message:
      event.message,
    outcome:
      event.outcome,
    inspectedPageCount:
      event.inspectedPageCount,
    findingCount:
      event.findingCount,
    occurrenceCount:
      event.occurrenceCount
  });
}

async function executeCheckQuestRun(
  input:
    StartCheckQuestInput,
  signal:
    AbortSignal,
  commitCompletion:
    () => void
): Promise<CheckQuestRunResult> {
  const startedAt =
    new Date();
  const runId =
    createRunId(
      startedAt
    );
  const emit =
    createRunEventEmitter(
      runId,
      input.onEvent
    );
  let failureEventObserved =
    false;
  let completedEvent:
    Extract<
      RunEvent,
      {
        type:
          'run-completed';
      }
    > |
    undefined;
  const geminiApiKey =
    input.credentials
      ?.geminiApiKey;

  try {
    throwIfRunCancelled(
      signal,
      runId,
      'application-run-start'
    );

    const baseSite =
      getSiteConfig(
        input.target
      );
    const maxPages =
      input.budgets
        ?.pages ??
      baseSite.maxPages;
    const site = {
      ...baseSite,
      maxPages:
        maxPages,
      maxAgentSteps:
        input.budgets
          ?.navigationSteps ??
        Math.max(
          baseSite
            .maxAgentSteps,
          maxPages
        ),
      maxExploratoryStepsPerPage:
        input.budgets
          ?.investigationStepsPerPage ??
        baseSite
          .maxExploratoryStepsPerPage
    };

    const report =
      await runSite({
        site,
        credentials:
          input.credentials,
        model:
          input.model,
        signal,
        startedAt,
        runId,
        dependencies:
          input.dependencies,
        onEvent:
          event => {
            const sanitizedEvent =
              sanitizeApplicationValue(
                event,
                geminiApiKey
              );

            if (
              sanitizedEvent.type ===
                'run-completed'
            ) {
              completedEvent =
                sanitizedEvent;
              return;
            }

            if (
              sanitizedEvent.type ===
                'run-failed'
            ) {
              failureEventObserved =
                true;
            }

            deliverRunEvent(
              input.onEvent,
              sanitizedEvent
            );
          }
      });

    const sanitizedReport =
      sanitizeApplicationValue(
        report,
        geminiApiKey
      );

    throwIfRunCancelled(
      signal,
      runId,
      'report-persistence'
    );

    const persistedReport =
      await persistSiteAgentReport(
        sanitizedReport
      );

    throwIfRunCancelled(
      signal,
      runId,
      'application-run-completion'
    );

    commitCompletion();

    if (
      completedEvent !==
        undefined
    ) {
      emitCompletedEvent(
        completedEvent,
        input.onEvent
      );
    }

    return {
      report:
        sanitizedReport,
      reportDirectoryPath:
        resolve(
          persistedReport
            .directoryPath
        ),
      jsonReportPath:
        resolve(
          persistedReport
            .jsonReportPath
        ),
      markdownReportPath:
        resolve(
          persistedReport
            .markdownReportPath
        )
    };
  } catch (
    error:
      unknown
  ) {
    const sanitizedError =
      sanitizeApplicationError(
        error,
        runId,
        geminiApiKey
      );

    if (
      !failureEventObserved
    ) {
      emit(
        createRunFailureEvent(
          sanitizedError
        )
      );
    }

    throw sanitizedError;
  }
}

export function startCheckQuest(
  input:
    StartCheckQuestInput
): CheckQuestRun {
  const abortController =
    new AbortController();
  let lifecycle:
    | 'active'
    | 'completion-committed'
    | 'settled' =
      'active';
  const result =
    Promise.resolve()
      .then(
        () =>
          executeCheckQuestRun(
            input,
            abortController.signal,
            () => {
              lifecycle =
                'completion-committed';
            }
          )
      )
      .finally(
        () => {
          lifecycle =
            'settled';
        }
      );

  return {
    result,
    cancel:
      () => {
        if (
          lifecycle ===
            'active'
        ) {
          abortController.abort();
        }
      }
  };
}
