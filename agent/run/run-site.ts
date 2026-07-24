import {
  chromium
} from '@playwright/test';

import {
  collectPageDiagnostics
} from '../browser/collect-page-diagnostics';
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
  type InspectPageResult,
  type OpenPageInspectionInput
} from '../inspection/inspect-page';
import {
  buildSiteAgentReport,
  type SiteRunFindingMetrics
} from '../reporting/build-site-agent-report';
import {
  createRunId
} from '../reporting/report-utils';
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

export interface RunSiteInput {
  site: SiteConfig;
  startedAt?: Date;
  runId?: string;
}

export async function runSite(
  input:
    RunSiteInput
): Promise<SiteAgentReport> {
  const startedAt =
    input.startedAt ??
    new Date();

  const runId =
    input.runId ??
    createRunId(
      startedAt
    );

  const {
    site
  } = input;

  const configuredStartUrl =
    new URL(
      site.startUrl
    );

  if (
    !site.allowedHosts.includes(
      configuredStartUrl.hostname
    )
  ) {
    throw new Error(
      `Configured start host "${configuredStartUrl.hostname}" is not allowed.`
    );
  }

  console.log(
    `Run ID: ${runId}`
  );

  console.log(
    `Selected site: ${site.name}`
  );

  console.log(
    `Start URL: ${site.startUrl}`
  );

  console.log(
    `Maximum pages: ${site.maxPages}`
  );

  console.log(
    `Maximum navigation steps: ${site.maxAgentSteps}`
  );

  console.log(
    `Maximum exploratory steps per page: ${site.maxExploratoryStepsPerPage}`
  );

  console.log(
    `Form submission allowed: ${site.allowFormSubmission}`
  );

  const browser =
    await chromium.launch({
      headless: true
    });

  try {
    const page =
      await browser.newPage({
        serviceWorkers:
          'block'
      });

    await preparePageForGuardedInteractions(
      page
    );

    const diagnosticsCollector =
      collectPageDiagnostics(
        page
      );

    try {
      const homepageResponse =
        await page.goto(
          site.startUrl,
          {
            waitUntil:
              'domcontentloaded',

            timeout:
              30_000
          }
        );

      const homepageFinalUrl =
        new URL(
          page.url()
        );

      if (
        !site.allowedHosts.includes(
          homepageFinalUrl.hostname
        )
      ) {
        throw new Error(
          `Homepage redirected to disallowed host "${homepageFinalUrl.hostname}".`
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

      console.log(
        '\nHomepage opened:'
      );

      console.log(
        `HTTP status: ${homepageObservation.httpStatus ?? 'unknown'}`
      );

      console.log(
        `Final URL: ${homepageObservation.finalUrl}`
      );

      console.log(
        `Title: ${homepageObservation.title}`
      );

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

                console.log(
                  `\nNavigation step ${agentSteps + 1}/${site.maxAgentSteps}`
                );

                console.log(
                  `Pages inspected: ${completedPages.length}/${site.maxPages}`
                );

                console.log(
                  `Safe frontier entries discovered: ${navigationFrontier.entries.size}`
                );

                console.log(
                  `Stage 6.2 policy band: ${policyWindow.policyBand ?? 'none'}`
                );

                console.log(
                  `Area-diversified candidates supplied to Gemini: ${policyWindow.candidates.length}`
                );

                console.log(
                  `Eligible route values: neutral=${policyWindow.eligibleValueClassCounts.neutral}, weak-low-value=${policyWindow.eligibleValueClassCounts['weak-low-value']}, strong-low-value=${policyWindow.eligibleValueClassCounts['strong-low-value']}`
                );

                console.log(
                  `Remaining page slots: ${navigationBudget.remainingPageSlots}`
                );

                console.log(
                  `Remaining navigation-decision slots: ${navigationBudget.remainingNavigationDecisionSlots}`
                );

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

                  console.log(
                    '\nAgent exploration finished:'
                  );

                  console.log(
                    outcome.summary
                  );

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
                  await chooseNavigationLink(
                    site,
                    policyWindow.candidates,
                    navigationBudget
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

                  console.log(
                    '\nAgent decision: FINISH'
                  );

                  console.log(
                    `Summary: ${decision.summary}`
                  );

                  return null;
                }

                console.log(
                  '\nAgent selected a navigation target:'
                );

                console.log(
                  `Text: ${decision.link.text}`
                );

                console.log(
                  `URL: ${decision.link.url}`
                );

                console.log(
                  `Traversal depth: ${decision.policyCandidate.minimumDiscoveryDepth}`
                );

                console.log(
                  `Policy band: ${decision.policyCandidate.policyBand}`
                );

                console.log(
                  `Reason: ${decision.reason}`
                );

                markNavigationUrlAttempted(
                  navigationUrlState,
                  decision.link.url
                );

                diagnosticsCollector
                  .reset();

                const {
                  observation:
                    pageObservation,
                  passiveSecuritySnapshot
                } =
                  await visitApprovedLinkWithPassiveSecurity(
                    page,
                    decision.link,
                    site.allowedHosts
                  );

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
                  console.log(
                    '\nNavigation resolved to an already-inspected final URL.'
                  );

                  console.log(
                    `Requested URL: ${navigationResolution.requestedUrl}`
                  );

                  console.log(
                    `Final URL: ${navigationResolution.finalUrl}`
                  );

                  console.log(
                    'No duplicate full inspection or page-novelty registration was performed.'
                  );

                  continue;
                }

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
            ) =>
              inspectPage({
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
                findingLifecycle
              })
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
    } finally {
      diagnosticsCollector.dispose();
    }
  } finally {
    await browser.close();
  }
}
