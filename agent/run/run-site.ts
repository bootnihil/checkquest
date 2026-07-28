import {
  chromium
} from '@playwright/test';

import {
  requireGeminiApiKey
} from '../ai/resolve-gemini-api-key';
import {
  collectPageDiagnostics
} from '../browser/collect-page-diagnostics';
import {
  gotoWithCancellation
} from '../browser/goto-with-cancellation';
import {
  preparePageForGuardedInteractions
} from '../browser/guarded-interaction-safety-boundary';
import {
  visitApprovedLinkWithPassiveSecurity
} from '../browser/visit-approved-link';
import type {
  SiteConfig
} from '../config/site-config';
import {
  CheckQuestError
} from '../errors/checkquest-error';
import {
  completeRequiredCleanup
} from '../errors/required-cleanup';
import {
  createSafeDisplayUrl
} from '../errors/safe-display-url';
import {
  createRunCancelledError,
  normalizeRunCancellation,
  throwIfRunCancelled
} from '../errors/run-cancellation';
import {
  chooseNavigationLink
} from '../decisions/choose-navigation-link';
import {
  createNavigationUrlState,
  markNavigationUrlAttempted,
  recordNavigationResolution
} from '../exploration/visited-links';
import {
  createPageNoveltyState,
  predictPageIdentity
} from '../exploration/page-novelty';
import {
  buildNavigationPolicyWindow,
  consumeNavigationDecision,
  createNavigationBudgetContext,
  createNavigationFrontier
} from '../exploration/navigation-policy';
import {
  runPageInspectionSequence
} from '../exploration/run-page-inspection-sequence';
import {
  createRunFindingLifecycle,
  getRunFindings
} from '../findings/run-finding-lifecycle';
import {
  inspectPage,
  type InspectPageDependencies,
  type InspectPageResult,
  type OpenPageInspectionInput
} from '../inspection/inspect-page';
import type {
  planNextAction
} from '../planning/plan-next-action';
import {
  buildSiteAgentReport,
  type SiteRunFindingMetrics
} from '../reporting/build-site-agent-report';
import type {
  InspectedPageResult,
  SiteAgentReport
} from '../reporting/report-types';
import {
  captureMainDocumentSecurity
} from '../security/capture-main-document-security';
import {
  createPassiveSecurityRegistry,
  getPassiveSecurityReport
} from '../security/passive-security-registry';
import {
  validateRunSiteInput,
  type ValidatedRunSiteInput
} from './validate-run-site-input';
import {
  createModelRequestRunEventObserver,
  createRunFailureEvent,
  createRunEventEmitter,
  type RunEventEmitter,
  type RunEventObserver
} from './run-event';

export interface RunSiteInput {
  site: SiteConfig;
  credentials?:
    RunSiteCredentials;
  startedAt?: Date;
  runId?: string;
  onEvent?:
    RunEventObserver;
  model?:
    string;
  signal?:
    AbortSignal;
  dependencies?:
    RunSiteDependencies;
}

export interface RunSiteCredentials {
  geminiApiKey?:
    string;
}

export interface RunSiteDependencies {
  analyzePageForQa?:
    NonNullable<
      InspectPageDependencies[
        'analyzePageForQa'
      ]
    >;
  planNextAction?:
    typeof planNextAction;
  chooseNavigationLink?:
    typeof chooseNavigationLink;
}

export async function runSite(
  input:
    RunSiteInput
): Promise<SiteAgentReport> {
  let validatedInput:
    ValidatedRunSiteInput;

  try {
    validatedInput =
      validateRunSiteInput(
        input
      );
  } catch (
    error:
      unknown
  ) {
    /*
     * Validation can reject an unsafe caller-supplied run ID, so pre-run
     * failures use a fixed safe identity rather than reflecting that input.
     */
    createRunEventEmitter(
      'unavailable',
      input.onEvent
    )(
      createRunFailureEvent(
        error
      )
    );

    throw error;
  }

  const {
    site,
    runId
  } = validatedInput;
  const emit =
    createRunEventEmitter(
      runId,
      input.onEvent
    );

  try {
    throwIfRunCancelled(
      input.signal,
      runId,
      'run-start'
    );
  } catch (
    error:
      unknown
  ) {
    emit(
      createRunFailureEvent(
        error
      )
    );
    throw error;
  }

  emit({
    type:
      'run-started',
    message:
      'CheckQuest run started.',
    startUrl:
      createSafeDisplayUrl(
        site.startUrl
      ),
    pageBudget:
      site.maxPages,
    navigationBudget:
      site.maxAgentSteps
  });

  try {
    const report =
      await executeRunSite(
        input,
        validatedInput,
        emit
      );

    throwIfRunCancelled(
      input.signal,
      runId,
      'run-completion'
    );

    emit({
      type:
        'run-completed',
      message:
        'CheckQuest run completed.',
      outcome:
        report.outcome.type,
      inspectedPageCount:
        report.summary
          .pagesInspected,
      findingCount:
        report.summary
          .logicalFindingsCount,
      occurrenceCount:
        report.summary
          .findingOccurrencesCount
    });

    return report;
  } catch (
    error:
      unknown
  ) {
    let normalizedError:
      unknown =
        error;

    if (
      error instanceof
        CheckQuestError &&
      error.code ===
        'CANCELLED'
    ) {
      normalizedError =
        normalizeRunCancellation(
          error,
          undefined,
          runId,
          'run-execution'
        );
    } else if (
      error instanceof
        CheckQuestError &&
      error.code ===
        'CLEANUP' &&
      input.signal
        ?.aborted
    ) {
      const cancellationError =
        createRunCancelledError(
          runId,
          'browser-close'
        );

      cancellationError
        .secondaryCleanupError =
          error;
      normalizedError =
        cancellationError;
    }

    emit(
      createRunFailureEvent(
        normalizedError
      )
    );

    throw normalizedError;
  }
}

async function executeRunSite(
  input:
    RunSiteInput,
  validatedInput:
    ValidatedRunSiteInput,
  emit:
    RunEventEmitter
): Promise<SiteAgentReport> {
  const {
    site,
    startedAt,
    runId
  } = validatedInput;
  const onModelRequestEvent =
    createModelRequestRunEventObserver(
      emit
    );

  throwIfRunCancelled(
    input.signal,
    runId,
    'run-preflight'
  );

  const usesDefaultAnalysis =
    input.dependencies
      ?.analyzePageForQa ===
    undefined;

  const mayUseDefaultPlanner =
    site
      .maxExploratoryStepsPerPage >
      0 &&
    input.dependencies
      ?.planNextAction ===
      undefined;

  const mayUseDefaultNavigation =
    site.maxPages >
      1 &&
    site.maxAgentSteps >
      0 &&
    input.dependencies
      ?.chooseNavigationLink ===
      undefined;

  if (
    usesDefaultAnalysis ||
    mayUseDefaultPlanner ||
    mayUseDefaultNavigation
  ) {
    /*
     * Fail before Chromium work when this run can reach a production
     * Gemini collaborator. Fully injected Stage 8C collaborators remain
     * Gemini-free.
     */
    requireGeminiApiKey(
      input.credentials
        ?.geminiApiKey
    );
  }

  let browser:
    Awaited<
      ReturnType<
        typeof chromium.launch
      >
    >;

  try {
    browser =
      await chromium.launch({
        headless:
          true
      });
  } catch (
    error:
      unknown
  ) {
    const cancellationError =
      normalizeRunCancellation(
        error,
        input.signal,
        runId,
        'browser-launch'
      );

    if (
      cancellationError !==
        error
    ) {
      throw cancellationError;
    }

    throw new CheckQuestError(
      'BROWSER',
      'Unable to launch Chromium. Install the project browser with "npm run setup:browser" and retry.',
      {
        phase:
          'browser-launch',
        runId,
        cause:
          error
      }
    );
  }

  let browserPrimaryError:
    Error | undefined;

  try {
    let page:
      Awaited<
        ReturnType<
          typeof browser.newPage
        >
      >;

    try {
      page =
        await browser.newPage({
          serviceWorkers:
            'block'
        });

      await preparePageForGuardedInteractions(
        page
      );
    } catch (
      error:
        unknown
    ) {
      const cancellationError =
        normalizeRunCancellation(
          error,
          input.signal,
          runId,
          'browser-setup'
        );

      if (
        cancellationError !==
          error
      ) {
        throw cancellationError;
      }

      throw new CheckQuestError(
        'BROWSER',
        'Chromium page setup failed.',
        {
          phase:
            'browser-setup',
          runId,
          cause:
            error
        }
      );
    }

    const diagnosticsCollector =
      collectPageDiagnostics(
        page
      );

    let diagnosticsPrimaryError:
      Error | undefined;

    try {
      let homepageResponse:
        Awaited<
          ReturnType<
            typeof page.goto
          >
        >;

      try {
        throwIfRunCancelled(
          input.signal,
          runId,
          'start-page-navigation'
        );

        homepageResponse =
          await gotoWithCancellation(
            page,
            site.startUrl,
            {
              waitUntil:
                'domcontentloaded',

              timeout:
                30_000
            },
            {
              signal:
                input.signal,
              runId,
              phase:
                'start-page-navigation'
            }
          );
      } catch (
        error:
          unknown
      ) {
        throw new CheckQuestError(
          'NAVIGATION',
          'Unable to open the configured start page.',
          {
            phase:
              'start-page-navigation',
            runId,
            pageNumber:
              1,
            requestedUrl:
              createSafeDisplayUrl(
                site.startUrl
              ),
            cause:
              error
          }
        );
      }

      const homepageFinalUrl =
        new URL(
          page.url()
        );

      throwIfRunCancelled(
        input.signal,
        runId,
        'start-page-navigation'
      );

      if (
        !site.allowedHosts.includes(
          homepageFinalUrl.hostname
        )
      ) {
        throw new CheckQuestError(
          'NAVIGATION',
          'The configured start page redirected to a disallowed host.',
          {
            phase:
              'start-page-navigation',
            runId,
            pageNumber:
              1,
            requestedUrl:
              createSafeDisplayUrl(
                site.startUrl
              ),
            finalUrl:
              createSafeDisplayUrl(
                homepageFinalUrl
                  .toString()
              )
          }
        );
      }

      const homepageObservation = {
        requestedUrl:
          site.startUrl,

        finalUrl:
          homepageFinalUrl.toString(),

        title:
          await page.title(),

        httpStatus:
          homepageResponse?.status() ??
          null
      };

      const navigationUrlState =
        createNavigationUrlState();

      markNavigationUrlAttempted(
        navigationUrlState,
        homepageObservation.requestedUrl
      );

      recordNavigationResolution(
        navigationUrlState,
        homepageObservation.requestedUrl,
        homepageObservation.finalUrl
      );

      const navigationFrontier =
        createNavigationFrontier();

      const pageNoveltyState =
        createPageNoveltyState();

      const passiveSecurityRegistry =
        createPassiveSecurityRegistry();

      const findingLifecycle =
        createRunFindingLifecycle();

      let agentSteps =
        0;

      let outcome:
        SiteAgentReport['outcome'] |
        null =
          null;

      const startPageObservation:
        InspectedPageResult['observation'] = {
        ...homepageObservation,

        headings:
          (
            await page
              .locator('h1, h2')
              .allTextContents()
          )
            .map(
              heading =>
                heading
                  .replace(
                    /\s+/g,
                    ' '
                  )
                  .trim()
            )
            .filter(
              heading =>
                heading.length > 0
            )
            .slice(0, 10)
      };

      const startPagePassiveSecuritySnapshot =
        await captureMainDocumentSecurity({
          response:
            homepageResponse,
          requestedUrl:
            homepageObservation
              .requestedUrl,
          finalUrl:
            homepageObservation
              .finalUrl,
          pageTitle:
            homepageObservation
              .title
        });

      const pageExecutions =
        await runPageInspectionSequence<
          OpenPageInspectionInput,
          InspectPageResult
        >({
          startPage: {
            selection: {
              type:
                'start-url',
              url:
                site.startUrl,
              navigationAudit: {
                traversalDepth:

                  0,
                requestedUrl:
                  site.startUrl,
                policyBand:
                  'start-page',
                valueClass:
                  null,
                valueReasons:
                  [],
                eligibleValueClassCounts:
                  null,
                deferredValueReasonCounts:
                  {},
                predictedAreaKey:
                  predictPageIdentity(
                    homepageObservation
                      .finalUrl
                  ).areaKey,
                predictedRouteFamilyKey:
                  predictPageIdentity(
                    homepageObservation
                      .finalUrl
                  ).routeFamilyKey,
                firstDiscoveredFromUrl:
                  null,
                minimumDepthDiscoveredFromUrl:
                  null,
                budgetAtDecision:
                  null
              }
            },

            observation:
              startPageObservation,

            passiveSecuritySnapshot:
              startPagePassiveSecuritySnapshot,

            traversalDepth:
              0
          },

          maxPages:
            site.maxPages,

          getNextPage:
            async completedPages => {
              while (
                true
              ) {
                throwIfRunCancelled(
                  input.signal,
                  runId,
                  'navigation-selection'
                );

                const navigationBudget =
                  createNavigationBudgetContext(
                    site.maxPages,
                    completedPages.length,
                    site.maxAgentSteps,
                    agentSteps
                  );

                if (
                  navigationBudget
                    .remainingPageSlots ===
                    0 ||
                  navigationBudget
                    .remainingNavigationDecisionSlots ===
                    0
                ) {
                  return null;
                }

                const policyWindow =
                  buildNavigationPolicyWindow({
                    frontier:
                      navigationFrontier,
                    urlState:
                      navigationUrlState,
                    pageNoveltyState,
                    budget:
                      navigationBudget
                  });

                if (
                  policyWindow
                    .candidates
                    .length ===
                    0
                ) {
                  outcome = {
                    type:
                      'finished',

                    summary:
                      'No unattempted safe navigation links remained.'
                  };

                  return null;
                }

                /*
                 * Preserve the historical budget definition exactly:
                 * every Gemini navigation decision consumes one agent step,
                 * including FINISH and redirect aliases.
                 */
                agentSteps =
                  consumeNavigationDecision(
                    site.maxAgentSteps,
                    agentSteps
                  );

                const decision =
                  await (
                    input
                      .dependencies
                      ?.chooseNavigationLink ??
                    chooseNavigationLink
                  )(
                    site,
                    policyWindow.candidates,
                    navigationBudget,
                    {
                      geminiApiKey:
                        input
                          .credentials
                          ?.geminiApiKey,
                      model:
                        input.model,
                      signal:
                        input.signal,
                      onEvent:
                        onModelRequestEvent
                    }
                  );

                throwIfRunCancelled(
                  input.signal,
                  runId,
                  'navigation-selection'
                );

                if (
                  decision.type ===
                  'finish'
                ) {
                  outcome = {
                    type:
                      'finished',

                    summary:
                      decision.summary
                  };

                  return null;
                }

                markNavigationUrlAttempted(
                  navigationUrlState,
                  decision.link.url
                );

                diagnosticsCollector
                  .reset();

                emit({
                  type:
                    'navigation-started',
                  message:
                    `Navigation ${agentSteps} started.`,
                  navigationStep:
                    agentSteps,
                  navigationBudget:
                    site.maxAgentSteps,
                  pageNumber:
                    completedPages.length +
                    1,
                  requestedUrl:
                    createSafeDisplayUrl(
                      decision
                        .link
                        .url
                    )
                });

                const {
                  observation:
                    pageObservation,
                  passiveSecuritySnapshot
                } =
                  await (
                    async () => {
                      try {
                        return await visitApprovedLinkWithPassiveSecurity(
                          page,
                          decision.link,
                          site.allowedHosts,
                          input.signal
                        );
                      } catch (
                        error:
                          unknown
                      ) {
                        throw new CheckQuestError(
                          'NAVIGATION',
                          'Unable to open the selected navigation target.',
                          {
                            phase:
                              'agent-navigation',
                            runId,
                            pageNumber:
                              completedPages.length +
                              1,
                            navigationStep:
                              agentSteps,
                            requestedUrl:
                              createSafeDisplayUrl(
                                decision
                                  .link
                                  .url
                              ),
                            cause:
                              error
                          }
                        );
                      }
                    }
                  )();

                const navigationResolution =
                  recordNavigationResolution(
                    navigationUrlState,
                    decision.link.url,
                    pageObservation
                      .finalUrl
                  );

                if (
                  navigationResolution
                    .finalUrlAlreadyInspected
                ) {
                  emit({
                    type:
                      'navigation-completed',
                    message:
                      `Navigation ${agentSteps} resolved to an already-inspected page.`,
                    navigationStep:
                      agentSteps,
                    navigationBudget:
                      site.maxAgentSteps,
                    pageNumber:
                      completedPages
                        .length +
                      1,
                    requestedUrl:
                      createSafeDisplayUrl(
                        navigationResolution
                          .requestedUrl
                      ),
                    finalUrl:
                      createSafeDisplayUrl(
                        navigationResolution
                          .finalUrl
                      ),
                    outcome:
                      'duplicate-final-url'
                  });

                  continue;
                }

                emit({
                  type:
                    'navigation-completed',
                  message:
                    `Navigation ${agentSteps} completed.`,
                  navigationStep:
                    agentSteps,
                  navigationBudget:
                    site.maxAgentSteps,
                  pageNumber:
                    completedPages.length +
                    1,
                  requestedUrl:
                    createSafeDisplayUrl(
                      navigationResolution
                        .requestedUrl
                    ),
                  finalUrl:
                    createSafeDisplayUrl(
                      navigationResolution
                        .finalUrl
                    ),
                  outcome:
                    'ready-for-inspection'
                });

                return {
                  selection: {
                    type:
                      'agent-navigation',
                    link:
                      decision.link,
                    reason:
                      decision.reason,
                    navigationAudit: {
                      traversalDepth:
                        decision
                          .policyCandidate
                          .minimumDiscoveryDepth,
                      requestedUrl:
                        decision.link.url,
                      policyBand:
                        decision
                          .policyCandidate
                          .policyBand,
                      valueClass:
                        decision
                          .policyCandidate
                          .valueClass,
                      valueReasons:
                        decision
                          .policyCandidate
                          .valueReasons,
                      eligibleValueClassCounts:
                        policyWindow
                          .eligibleValueClassCounts,
                      deferredValueReasonCounts:
                        policyWindow
                          .deferredValueReasonCounts,
                      predictedAreaKey:
                        decision
                          .predictedIdentity
                          .areaKey,
                      predictedRouteFamilyKey:
                        decision
                          .predictedIdentity
                          .routeFamilyKey,
                      firstDiscoveredFromUrl:
                        decision
                          .policyCandidate
                          .firstDiscoveredFromUrl,
                      minimumDepthDiscoveredFromUrl:
                        decision
                          .policyCandidate
                          .minimumDepthDiscoveredFromUrl,
                      budgetAtDecision:
                        navigationBudget
                    }
                  },

                  observation:
                    pageObservation,

                  passiveSecuritySnapshot,

                  traversalDepth:
                    decision
                      .policyCandidate
                      .minimumDiscoveryDepth
                };
              }
            },

          inspectPage:
            async (
              currentPage,
              pageIndex
            ) => {
              const pageNumber =
                pageIndex +
                1;

              throwIfRunCancelled(
                input.signal,
                runId,
                'page-inspection'
              );

              emit({
                type:
                  'inspection-started',
                message:
                  `Page ${pageNumber} inspection started.`,
                pageNumber,
                url:
                  createSafeDisplayUrl(
                    currentPage
                      .observation
                      .finalUrl
                  )
              });

              const result =
                await inspectPage({
                  page,
                  site,
                  runId,
                  pageIndex,
                  currentPage,
                  diagnosticsCollector,
                  navigationFrontier,
                  navigationUrlState,
                  pageNoveltyState,
                  passiveSecurityRegistry,
                  findingLifecycle,
                  dependencies: {
                    analyzePageForQa:
                      input
                        .dependencies
                        ?.analyzePageForQa,
                    planNextAction:
                      input
                        .dependencies
                        ?.planNextAction,
                    geminiApiKey:
                      input
                        .credentials
                        ?.geminiApiKey,
                    model:
                      input.model,
                    signal:
                      input.signal,
                    onModelRequestEvent
                  }
                });

              throwIfRunCancelled(
                input.signal,
                runId,
                'page-inspection'
              );

              const {
                pageResult
              } = result;

              if (
                pageResult
                  .exploratoryInvestigation !==
                null
              ) {
                for (
                  const findingResult of
                    pageResult
                      .exploratoryFindingResults
                ) {
                  emit({
                    type:
                      'investigation-completed',
                    message:
                      `Candidate ${findingResult.candidateReference} investigation completed.`,
                    pageNumber,
                    candidateReference:
                      findingResult
                        .candidateReference,
                    status:
                      findingResult
                        .outcome
                        .status,
                    stepsUsed:
                      pageResult
                        .exploratoryInvestigation
                        .plannerDecisionCount
                  });
                }
              }

              emit({
                type:
                  'inspection-completed',
                message:
                  `Page ${pageNumber} inspection completed.`,
                pageNumber,
                url:
                  createSafeDisplayUrl(
                    pageResult
                      .observation
                      .finalUrl
                  ),
                findingCount:
                  pageResult
                    .findings
                    .length +
                  pageResult
                    .exploratoryFindingResults
                    .length +
                  pageResult
                    .knownFindingOccurrences
                    .length,
                diagnosticCount:
                  pageResult
                    .diagnostics
                    .consoleErrors
                    .length +
                  pageResult
                    .diagnostics
                    .failedRequests
                    .length
              });

              return result;
            }
        });

      const inspectedPages =
        pageExecutions.map(
          execution =>
            execution.pageResult
        );

      const findingMetrics =
        pageExecutions.reduce<
          SiteRunFindingMetrics
        >(
          (
            totals,
            execution
          ) => ({
            knownFindingsSuppliedToAnalysisCount:
              totals
                .knownFindingsSuppliedToAnalysisCount +
              execution
                .findingMetrics
                .knownFindingsSuppliedToAnalysisCount,
            newCandidateFindingsCount:
              totals
                .newCandidateFindingsCount +
              execution
                .findingMetrics
                .newCandidateFindingsCount,
            redundantInvestigationsSkippedCount:
              totals
                .redundantInvestigationsSkippedCount +
              execution
                .findingMetrics
                .redundantInvestigationsSkippedCount
          }),
          {
            knownFindingsSuppliedToAnalysisCount:
              0,
            newCandidateFindingsCount:
              0,
            redundantInvestigationsSkippedCount:
              0
          }
        );

      if (
        outcome ===
        null
      ) {
        if (
          inspectedPages.length >=
          site.maxPages
        ) {
          outcome = {
            type:
              'completed',

            summary:
              `Reached the configured page limit of ${site.maxPages}.`
          };
        } else if (
          agentSteps >=
          site.maxAgentSteps
        ) {
          outcome = {
            type:
              'completed',

            summary:
              `Reached the configured navigation-step limit of ${site.maxAgentSteps}.`
          };
        } else {
          outcome = {
            type:
              'completed',

            summary:
              'Exploration completed successfully.'
          };
        }
      }

      const canonicalFindings =
        getRunFindings(
          findingLifecycle
        );

      throwIfRunCancelled(
        input.signal,
        runId,
        'report-construction'
      );

      try {
        return buildSiteAgentReport({
          runId,
          startedAt,
          finishedAt:
            new Date(),
          site,
          homepage:
            homepageObservation,
          outcome,
          inspectedPages,
          canonicalFindings,
          passiveSecurity:
            getPassiveSecurityReport(
              passiveSecurityRegistry
            ),
          findingMetrics
        });
      } catch (
        error:
          unknown
      ) {
        throw new CheckQuestError(
          'REPORTING',
          'Unable to construct the successful run report.',
          {
            phase:
              'report-construction',
            runId,
            cause:
              error
          }
        );
      }
  } catch (
    error:
      unknown
  ) {
    const cancellationError =
      normalizeRunCancellation(
        error,
        input.signal,
        runId,
        'site-execution'
      );
    const normalizedError =
      cancellationError instanceof
        Error
          ? cancellationError
          : new CheckQuestError(
              'INTERNAL',
              'Page inspection failed with an invalid error value.',
              {
                phase:
                  'page-inspection',
                runId,
                cause:
                  error
              }
            );

      diagnosticsPrimaryError =
        normalizedError;
      throw normalizedError;
    } finally {
      await completeRequiredCleanup(
        diagnosticsPrimaryError,
        [
          () =>
            diagnosticsCollector
              .dispose()
        ],
        {
          phase:
            'diagnostics-disposal',
          runId
        }
      );
    }
  } catch (
    error:
      unknown
  ) {
    const normalizedError =
      error instanceof
        Error
        ? error
        : new CheckQuestError(
            'INTERNAL',
            'Site execution failed with an invalid error value.',
            {
              phase:
                'site-execution',
              runId,
              cause:
                error
            }
          );

    browserPrimaryError =
      normalizedError;
    throw normalizedError;
  } finally {
    await completeRequiredCleanup(
      browserPrimaryError,
      [
        () =>
          browser.close()
      ],
      {
        phase:
          'browser-close',
        runId
      }
    );
  }
}
