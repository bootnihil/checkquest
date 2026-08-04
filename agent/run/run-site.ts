import { chromium } from '@playwright/test';

import { requireGeminiApiKey } from '../ai/resolve-gemini-api-key';
import { collectPageDiagnostics } from '../browser/collect-page-diagnostics';
import { gotoWithCancellation } from '../browser/goto-with-cancellation';
import { preparePageForGuardedInteractions } from '../browser/guarded-interaction-safety-boundary';
import type { SiteConfig } from '../config/site-config';
import type { chooseNavigationLink } from '../decisions/choose-navigation-link';
import { CheckQuestError } from '../errors/checkquest-error';
import { completeRequiredCleanup } from '../errors/required-cleanup';
import { createSafeDisplayUrl } from '../errors/safe-display-url';
import {
  createRunCancelledError,
  normalizeRunCancellation,
  throwIfRunCancelled
} from '../errors/run-cancellation';
import { runSiteExploration } from '../exploration/run-site-exploration';
import type { InspectPageDependencies } from '../inspection/inspect-page';
import type { planNextAction } from '../planning/plan-next-action';
import { buildSiteAgentReport } from '../reporting/build-site-agent-report';
import type { SiteAgentReport } from '../reporting/report-types';
import { buildReconciledRunSummaryProjection } from '../reporting/run-summary-projection';
import { validateRunSiteInput, type ValidatedRunSiteInput } from './validate-run-site-input';
import {
  createModelRequestRunEventObserver,
  createRunFailureEvent,
  createRunEventEmitter,
  type RunEventEmitter,
  type RunEventObserver
} from './run-event';

export interface RunSiteInput {
  site: SiteConfig;
  credentials?: RunSiteCredentials;
  startedAt?: Date;
  runId?: string;
  onEvent?: RunEventObserver;
  model?: string;
  signal?: AbortSignal;
  dependencies?: RunSiteDependencies;
}

export interface RunSiteCredentials {
  geminiApiKey?: string;
}

export interface RunSiteDependencies {
  analyzePageForQa?: NonNullable<InspectPageDependencies['analyzePageForQa']>;
  planNextAction?: typeof planNextAction;
  chooseNavigationLink?: typeof chooseNavigationLink;
}

export async function runSite(input: RunSiteInput): Promise<SiteAgentReport> {
  let validatedInput: ValidatedRunSiteInput;

  try {
    validatedInput = validateRunSiteInput(input);
  } catch (error: unknown) {
    /*
     * Validation can reject an unsafe caller-supplied run ID, so pre-run
     * failures use a fixed safe identity rather than reflecting that input.
     */
    createRunEventEmitter('unavailable', input.onEvent)(createRunFailureEvent(error));

    throw error;
  }

  const { site, runId } = validatedInput;
  const emit = createRunEventEmitter(runId, input.onEvent);

  try {
    throwIfRunCancelled(input.signal, runId, 'run-start');
  } catch (error: unknown) {
    emit(createRunFailureEvent(error));
    throw error;
  }

  emit({
    type: 'run-started',
    message: 'CheckQuest run started.',
    startUrl: createSafeDisplayUrl(site.startUrl),
    pageBudget: site.maxPages,
    navigationBudget: site.maxAgentSteps
  });

  try {
    const report = await executeRunSite(input, validatedInput, emit);

    throwIfRunCancelled(input.signal, runId, 'run-completion');

    const runSummary = buildReconciledRunSummaryProjection(report);

    emit({
      type: 'run-completed',
      message: 'CheckQuest run completed.',
      outcome: report.outcome.type,
      inspectedPageCount: runSummary.inspectedPageCount,
      findingCount: runSummary.primaryFindingCount,
      confirmedFindingCount: runSummary.confirmedFindingCount,
      reviewFindingCount: runSummary.reviewFindingCount,
      technicalObservationCount: runSummary.technicalObservationCount,
      occurrenceCount: report.summary.findingOccurrencesCount
    });

    return report;
  } catch (error: unknown) {
    let normalizedError: unknown = error;

    if (error instanceof CheckQuestError && error.code === 'CANCELLED') {
      normalizedError = normalizeRunCancellation(error, undefined, runId, 'run-execution');
    } else if (
      error instanceof CheckQuestError &&
      error.code === 'CLEANUP' &&
      input.signal?.aborted
    ) {
      const cancellationError = createRunCancelledError(runId, 'browser-close');

      cancellationError.secondaryCleanupError = error;
      normalizedError = cancellationError;
    }

    emit(createRunFailureEvent(normalizedError));

    throw normalizedError;
  }
}

async function executeRunSite(
  input: RunSiteInput,
  validatedInput: ValidatedRunSiteInput,
  emit: RunEventEmitter
): Promise<SiteAgentReport> {
  const { site, startedAt, runId } = validatedInput;
  const onModelRequestEvent = createModelRequestRunEventObserver(emit);

  throwIfRunCancelled(input.signal, runId, 'run-preflight');

  const usesDefaultAnalysis = input.dependencies?.analyzePageForQa === undefined;

  const mayUseDefaultPlanner =
    site.maxExploratoryStepsPerPage > 0 && input.dependencies?.planNextAction === undefined;

  const mayUseDefaultNavigation =
    site.maxPages > 1 &&
    site.maxAgentSteps > 0 &&
    input.dependencies?.chooseNavigationLink === undefined;

  if (usesDefaultAnalysis || mayUseDefaultPlanner || mayUseDefaultNavigation) {
    /*
     * Fail before Chromium work when this run can reach a production
     * Gemini collaborator. Fully injected Stage 8C collaborators remain
     * Gemini-free.
     */
    requireGeminiApiKey(input.credentials?.geminiApiKey);
  }

  let browser: Awaited<ReturnType<typeof chromium.launch>>;

  try {
    browser = await chromium.launch({
      headless: true
    });
  } catch (error: unknown) {
    const cancellationError = normalizeRunCancellation(
      error,
      input.signal,
      runId,
      'browser-launch'
    );

    if (cancellationError !== error) {
      throw cancellationError;
    }

    throw new CheckQuestError(
      'BROWSER',
      'Unable to launch Chromium. Install the project browser with "npm run setup:browser" and retry.',
      {
        phase: 'browser-launch',
        runId,
        cause: error
      }
    );
  }

  let browserPrimaryError: Error | undefined;

  try {
    let page: Awaited<ReturnType<typeof browser.newPage>>;

    try {
      page = await browser.newPage({
        serviceWorkers: 'block'
      });

      await preparePageForGuardedInteractions(page);
    } catch (error: unknown) {
      const cancellationError = normalizeRunCancellation(
        error,
        input.signal,
        runId,
        'browser-setup'
      );

      if (cancellationError !== error) {
        throw cancellationError;
      }

      throw new CheckQuestError('BROWSER', 'Chromium page setup failed.', {
        phase: 'browser-setup',
        runId,
        cause: error
      });
    }

    const diagnosticsCollector = collectPageDiagnostics(page);

    let diagnosticsPrimaryError: Error | undefined;

    try {
      let homepageResponse: Awaited<ReturnType<typeof page.goto>>;

      try {
        throwIfRunCancelled(input.signal, runId, 'start-page-navigation');

        homepageResponse = await gotoWithCancellation(
          page,
          site.startUrl,
          {
            waitUntil: 'domcontentloaded',

            timeout: 30_000
          },
          {
            signal: input.signal,
            runId,
            phase: 'start-page-navigation'
          }
        );
      } catch (error: unknown) {
        throw new CheckQuestError('NAVIGATION', 'Unable to open the configured start page.', {
          phase: 'start-page-navigation',
          runId,
          pageNumber: 1,
          requestedUrl: createSafeDisplayUrl(site.startUrl),
          cause: error
        });
      }

      const homepageFinalUrl = new URL(page.url());

      throwIfRunCancelled(input.signal, runId, 'start-page-navigation');

      if (!site.allowedHosts.includes(homepageFinalUrl.hostname)) {
        throw new CheckQuestError(
          'NAVIGATION',
          'The configured start page redirected to a disallowed host.',
          {
            phase: 'start-page-navigation',
            runId,
            pageNumber: 1,
            requestedUrl: createSafeDisplayUrl(site.startUrl),
            finalUrl: createSafeDisplayUrl(homepageFinalUrl.toString())
          }
        );
      }

      const homepageObservation = {
        requestedUrl: site.startUrl,

        finalUrl: homepageFinalUrl.toString(),

        title: await page.title(),

        httpStatus: homepageResponse?.status() ?? null
      };

      const exploration = await runSiteExploration({
        page,
        site,
        runId,
        homepage: homepageObservation,
        homepageResponse,
        diagnosticsCollector,
        dependencies: input.dependencies,
        geminiApiKey: input.credentials?.geminiApiKey,
        model: input.model,
        signal: input.signal,
        onModelRequestEvent,
        emit
      });

      throwIfRunCancelled(input.signal, runId, 'report-construction');

      try {
        return buildSiteAgentReport({
          runId,
          startedAt,
          finishedAt: new Date(),
          site,
          homepage: homepageObservation,
          outcome: exploration.outcome,
          inspectedPages: exploration.inspectedPages,
          canonicalFindings: exploration.canonicalFindings,
          passiveSecurity: exploration.passiveSecurity,
          findingMetrics: exploration.findingMetrics
        });
      } catch (error: unknown) {
        throw new CheckQuestError('REPORTING', 'Unable to construct the successful run report.', {
          phase: 'report-construction',
          runId,
          cause: error
        });
      }
    } catch (error: unknown) {
      const cancellationError = normalizeRunCancellation(
        error,
        input.signal,
        runId,
        'site-execution'
      );
      const normalizedError =
        cancellationError instanceof Error
          ? cancellationError
          : new CheckQuestError('INTERNAL', 'Page inspection failed with an invalid error value.', {
              phase: 'page-inspection',
              runId,
              cause: error
            });

      diagnosticsPrimaryError = normalizedError;
      throw normalizedError;
    } finally {
      await completeRequiredCleanup(
        diagnosticsPrimaryError,
        [() => diagnosticsCollector.dispose()],
        {
          phase: 'diagnostics-disposal',
          runId
        }
      );
    }
  } catch (error: unknown) {
    const normalizedError =
      error instanceof Error
        ? error
        : new CheckQuestError('INTERNAL', 'Site execution failed with an invalid error value.', {
            phase: 'site-execution',
            runId,
            cause: error
          });

    browserPrimaryError = normalizedError;
    throw normalizedError;
  } finally {
    await completeRequiredCleanup(browserPrimaryError, [() => browser.close()], {
      phase: 'browser-close',
      runId
    });
  }
}
