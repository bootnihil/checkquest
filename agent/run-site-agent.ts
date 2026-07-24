import { chromium } from '@playwright/test';

import { analyzePageForQa } from './analysis/analyze-page-for-qa';
import { classifyDiagnostics } from './analysis/classify-diagnostics';
import { evaluatePageObservation } from './analysis/evaluate-page';

import type {
  ExploratoryQaFinding
} from './analysis/exploratory-qa-schema';

import { capturePageScreenshot } from './browser/capture-page-screenshot';
import { collectPageDiagnostics } from './browser/collect-page-diagnostics';
import { preparePageForGuardedInteractions } from './browser/guarded-interaction-safety-boundary';
import { extractPageContent } from './browser/extract-page-content';

import {
  inspectNavigation
} from './browser/inspect-navigation';

import {
  visitApprovedLinkWithPassiveSecurity
} from './browser/visit-approved-link';

import {
  applyAgentRunOptions,
  parseAgentRunOptions
} from './config/agent-run-options';

import { chooseNavigationLink } from './decisions/choose-navigation-link';

import {
  createNavigationUrlState,
  markFinalUrlInspected,
  markNavigationUrlAttempted,
  recordNavigationResolution
} from './exploration/visited-links';

import {
  createPageNoveltyState,
  predictPageIdentity,
  registerInspectedPageNovelty
} from './exploration/page-novelty';
import {
  buildNavigationPolicyWindow,
  consumeNavigationDecision,
  createNavigationBudgetContext,
  createNavigationFrontier,
  getNavigationFrontierEntries,
  registerDiscoveredNavigationLinks
} from './exploration/navigation-policy';
import {
  runPageInspectionSequence
} from './exploration/run-page-inspection-sequence';

import {
  evaluateFindingInvestigationOutcome
} from './investigation/evaluate-finding-investigation-outcome';
import {
  isInvestigablePageCandidate
} from './investigation/page-candidates';
import {
  commitRunPageFindings,
  createRunFindingLifecycle,
  getRunFindings,
  prepareKnownFindingAnalysis,
  reconcileRunPageFindings
} from './findings/run-finding-lifecycle';

import { runExploratoryLoop } from './planning/run-exploratory-loop';

import {
  buildSiteWideExploratoryFindings
} from './reporting/build-site-wide-exploratory-findings';

import {
  createRunId,
  getHighestSeverity
} from './reporting/report-utils';

import type {
  InspectedPageResult,
  SiteAgentReport
} from './reporting/report-types';

import { writeJsonReport } from './reporting/write-json-report';
import { writeMarkdownReport } from './reporting/write-markdown-report';
import {
  captureMainDocumentSecurity
} from './security/capture-main-document-security';
import type {
  PassivePageSecuritySnapshot
} from './security/passive-security-model';
import {
  createPassiveSecurityRegistry,
  getPassiveSecurityReport,
  registerPassiveSecuritySnapshot
} from './security/passive-security-registry';
import { getSiteConfig } from './sites';

interface OpenPageInspectionInput {
  selection:
    InspectedPageResult['selection'];

  observation:
    InspectedPageResult['observation'];

  passiveSecuritySnapshot:
    PassivePageSecuritySnapshot;

  traversalDepth:
    number;
}

function getHighestExploratoryQaSeverity(
  findings: ExploratoryQaFinding[]
):
  | 'high'
  | 'medium'
  | 'low'
  | 'none' {
  if (
    findings.some(
      finding =>
        finding.severity ===
        'high'
    )
  ) {
    return 'high';
  }

  if (
    findings.some(
      finding =>
        finding.severity ===
        'medium'
    )
  ) {
    return 'medium';
  }

  if (
    findings.some(
      finding =>
        finding.severity ===
        'low'
    )
  ) {
    return 'low';
  }

  return 'none';
}

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

      let knownFindingsSuppliedToAnalysisCount =
        0;

      let newCandidateFindingsCount =
        0;

      let redundantInvestigationsSkippedCount =
        0;

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

      const inspectedPages =
        await runPageInspectionSequence<
          OpenPageInspectionInput,
          InspectedPageResult
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
            ) => {
              const {
                observation:
                  pageObservation,
                passiveSecuritySnapshot,
                selection,
                traversalDepth
              } = currentPage;

              registerPassiveSecuritySnapshot(
                passiveSecurityRegistry,
                passiveSecuritySnapshot
              );

              console.log(
                selection.type ===
                  'start-url'
                  ? '\nInspecting configured start page as page 1.'
                  : '\nSelected page visited successfully:'
              );

              console.log(
                JSON.stringify(
                  pageObservation,
                  null,
                  2
                )
              );

        await page.waitForTimeout(
          1_000
        );

        const diagnostics =
          diagnosticsCollector.snapshot();

        const classifiedDiagnostics =
          classifyDiagnostics(
            diagnostics
          );

        const actionableRequestCount =
          classifiedDiagnostics
            .failedRequests
            .filter(
              item =>
                item.disposition ===
                'actionable'
            )
            .length;

        const ignoredNoiseCount =
          classifiedDiagnostics
            .failedRequests
            .filter(
              item =>
                item.disposition ===
                'ignored-noise'
            )
            .length;

        const needsReviewCount =
          classifiedDiagnostics
            .failedRequests
            .filter(
              item =>
                item.disposition ===
                'needs-review'
            )
            .length;

        console.log(
          '\nBrowser diagnostics collected:'
        );

        console.log(
          `Console errors: ${diagnostics.consoleErrors.length}`
        );

        console.log(
          `Failed network requests: ${diagnostics.failedRequests.length}`
        );

        console.log(
          '\nDiagnostic classification:'
        );

        console.log(
          `Actionable failed requests: ${actionableRequestCount}`
        );

        console.log(
          `Needs review: ${needsReviewCount}`
        );

        console.log(
          `Ignored noise: ${ignoredNoiseCount}`
        );

        const findings =
          evaluatePageObservation(
            pageObservation
          );

        if (
          findings.length ===
          0
        ) {
          console.log(
            '\nDeterministic evaluation: no rule-based page health issues found.'
          );
        } else {
          console.log(
            `\nDeterministic evaluation: ${findings.length} potential issue(s) found.`
          );

          console.log(
            JSON.stringify(
              findings,
              null,
              2
            )
          );
        }

        const pageContent =
          await extractPageContent(
            page
          );

        const discoveredLinks =
          await inspectNavigation(
            page,
            site.allowedHosts
          );

        const effectivePredictedIdentity =
          predictPageIdentity(
            pageObservation
              .finalUrl,
            [
              ...getNavigationFrontierEntries(
                navigationFrontier
              ).map(
                entry =>
                  entry.link
              ),
              ...discoveredLinks
            ]
          );

        if (
          selection.type ===
            'start-url' &&
          selection
            .navigationAudit
        ) {
          selection
            .navigationAudit
            .predictedAreaKey =
              effectivePredictedIdentity
                .areaKey;

          selection
            .navigationAudit
            .predictedRouteFamilyKey =
              effectivePredictedIdentity
                .routeFamilyKey;
        }

        const pageNovelty =
          registerInspectedPageNovelty(
            pageNoveltyState,
            effectivePredictedIdentity,
            pageContent
          );

        console.log(
          '\nStructured page content extracted:'
        );

        console.log(
          `Headings: ${pageContent.headings.length}`
        );

        console.log(
          `Links: ${pageContent.links.length}`
        );

        console.log(
          `Buttons: ${pageContent.buttons.length}`
        );

        console.log(
          `Text fields: ${pageContent.textFields.length}`
        );

        console.log(
          `Select controls: ${pageContent.selects.length}`
        );

        console.log(
          `Body text characters: ${pageContent.bodyText.length}`
        );

        console.log(
          `Predicted area: ${pageNovelty.predictedIdentity.areaKey}`
        );

        console.log(
          `Predicted route family: ${pageNovelty.predictedIdentity.routeFamilyKey}`
        );

        console.log(
          `Observed template: ${pageNovelty.observedTemplateKey}`
        );

        const containsPasswordField =
          pageContent.textFields.some(
            field =>
              field.inputType ===
              'password'
          );

        const knownFindingPreparation =
          prepareKnownFindingAnalysis(
            findingLifecycle,
            pageContent
          );

        const {
          knownFindingContext
        } = knownFindingPreparation;

        knownFindingsSuppliedToAnalysisCount +=
          knownFindingContext.length;

        console.log(
          `Known findings supplied to analysis: ${knownFindingContext.length}`
        );

        const rawExploratoryQaAnalysis =
          await analyzePageForQa({
            observation:
              pageObservation,

            content:
              pageContent,

            classifiedDiagnostics,

            ruleBasedFindings:
              findings,

            knownFindings:
              knownFindingContext
          });

        const pageFindingLifecycle =
          reconcileRunPageFindings(
            findingLifecycle,
            {
              pageUrl:
                pageObservation.finalUrl,
              pageTitle:
                pageObservation.title,
              ruleFindings:
                findings,
              rawExploratoryQaAnalysis,
              knownFindingPreparation
            }
          );

        const {
          exploratoryQaAnalysis,
          reconciledPageFindings,
          pageCandidates
        } = pageFindingLifecycle;

        newCandidateFindingsCount +=
          reconciledPageFindings
            .newFindings
            .length;

        console.log(
          '\nExploratory QA analysis:'
        );

        console.log(
          `New candidate findings: ${reconciledPageFindings.newFindings.length}`
        );

        console.log(
          `Known finding occurrences: ${reconciledPageFindings.knownOccurrenceDrafts.length}`
        );

        const pageRedundantInvestigationsSkipped =
          reconciledPageFindings
            .knownOccurrenceDrafts
            .filter(
              draft =>
                draft
                  .redundantInvestigationSkipped
            )
            .length;

        redundantInvestigationsSkippedCount +=
          pageRedundantInvestigationsSkipped;

        console.log(
          `Redundant investigations skipped: ${pageRedundantInvestigationsSkipped}`
        );

        for (
          const draft of
            reconciledPageFindings
              .knownOccurrenceDrafts
        ) {
          if (
            draft
              .redundantInvestigationSkipped
          ) {
            console.log(
              `- ${draft.knownFindingReference}: known verified occurrence recorded; redundant investigation skipped.`
            );
          }
        }

        console.log(
          `Summary: ${exploratoryQaAnalysis.summary}`
        );

        for (
          const exploratoryFinding of
            exploratoryQaAnalysis.findings
        ) {
          console.log(
            `- [${exploratoryFinding.severity}/${exploratoryFinding.confidence}] ${exploratoryFinding.title}`
          );
        }

        let exploratoryInvestigation:
          InspectedPageResult['exploratoryInvestigation'] =
            null;

        if (
          containsPasswordField
        ) {
          console.log(
            '\nAutonomous investigation skipped: password field detected.'
          );
        } else if (
          site.maxExploratoryStepsPerPage >
            0 &&
          pageCandidates.length >
            0
        ) {
          console.log(
            '\nStarting autonomous page investigation...'
          );

          console.log(
            `Maximum investigation steps: ${site.maxExploratoryStepsPerPage}`
          );

          console.log(
            `Investigable candidates supplied to planner: ${pageCandidates.filter(isInvestigablePageCandidate).length}`
          );

          exploratoryInvestigation =
            await runExploratoryLoop(
              page,
              pageObservation.finalUrl,
              site.maxExploratoryStepsPerPage,
              pageCandidates
            );

          const postInvestigationUrl =
            new URL(
              page.url()
            );

          if (
            !site.allowedHosts.includes(
              postInvestigationUrl.hostname
            )
          ) {
            throw new Error(
              `Autonomous investigation escaped to disallowed host "${postInvestigationUrl.hostname}".`
            );
          }

          console.log(
            '\nAutonomous page investigation completed:'
          );

          console.log(
            `Planner decisions: ${exploratoryInvestigation.plannerDecisionCount}/${exploratoryInvestigation.maxPlannerDecisions}`
          );

          console.log(
            `Executed candidate-investigation actions: ${exploratoryInvestigation.executedInvestigationActionCount}`
          );

          console.log(
            `Stop reason: ${exploratoryInvestigation.stopReason}`
          );
        }

        /*
         * Convert candidate findings plus collected investigation
         * evidence into deterministic finding outcomes.
         *
         * This is deliberately separate from Gemini reasoning.
         * The same structured result can later be consumed by the
         * CLI, Windows UI, SaaS UI, JSON, or Markdown.
         */
        const exploratoryFindingResults =
          pageCandidates.map(
            candidate => ({
              candidateReference:
                candidate.reference,

              finding:
                candidate.finding,

              outcome:
                evaluateFindingInvestigationOutcome(
                  candidate,
                  exploratoryInvestigation,
                )
            })
          );

        if (
          exploratoryFindingResults.length >
          0
        ) {
          console.log(
            '\nExploratory finding outcomes:'
          );

          for (
            const result of
              exploratoryFindingResults
          ) {
            console.log(
              `- [${result.outcome.status.toUpperCase()}] ${result.finding.title}`
            );

            console.log(
              `  ${result.outcome.summary}`
            );
          }
        }

        const investigationPerformedAction =
          exploratoryInvestigation
            ?.steps
            .some(
              step =>
                step.decision.action.kind !==
                  'stop' &&
                step.executionResult.status ===
                  'executed'
            ) ??
          false;

        const shouldCaptureScreenshot =
          findings.length >
            0 ||
          actionableRequestCount >
            0 ||
          needsReviewCount >
            0 ||
          exploratoryQaAnalysis
            .findings
            .length >
            0 ||
          reconciledPageFindings
            .knownOccurrenceDrafts
            .length >
            0 ||
          investigationPerformedAction;

        let screenshotPath:
          string | null =
            null;

        if (
          shouldCaptureScreenshot
        ) {
          const pageNumber =
            pageIndex + 1;

          const screenshot =
            await capturePageScreenshot(
              page,
              runId,
              pageNumber
            );

          screenshotPath =
            screenshot.filePath;

          console.log(
            '\nScreenshot evidence captured:'
          );

          console.log(
            screenshotPath
          );
        } else {
          console.log(
            '\nScreenshot evidence: not required for this page.'
          );
        }

        const knownFindingOccurrences =
          commitRunPageFindings(
            findingLifecycle,
            {
              page:
                pageFindingLifecycle,
              pageUrl:
                pageObservation.finalUrl,
              pageTitle:
                pageObservation.title,
              screenshotPath,
              exploratoryFindingResults
            }
          );

        const newlyAddedLinks =
          registerDiscoveredNavigationLinks(
            navigationFrontier,
            discoveredLinks,
            pageObservation
              .finalUrl,
            traversalDepth
          );

        console.log(
          selection.type ===
            'start-url'
            ? `\nInitial safe navigation candidates found: ${discoveredLinks.length}`
            : `\nAdditional safe links discovered on this page: ${newlyAddedLinks}`
        );

        console.log(
          `Total unique safe links in frontier: ${navigationFrontier.entries.size}`
        );

        markFinalUrlInspected(
          navigationUrlState,
          pageObservation
            .finalUrl
        );

              return {
                selection,

                observation:
                  pageObservation,

                pageNovelty,

                diagnostics,

                classifiedDiagnostics,

                screenshotPath,

                findings,

                exploratoryQaAnalysis,

                exploratoryInvestigation,

                exploratoryFindingResults,

                knownFindingOccurrences
              };
            }
        });

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

      const allFindings =
        inspectedPages.flatMap(
          pageResult =>
            pageResult.findings
        );

      const allExploratoryQaFindings =
        inspectedPages.flatMap(
          pageResult =>
            pageResult
              .exploratoryQaAnalysis
              .findings
        );

      const canonicalFindings =
        getRunFindings(
          findingLifecycle
        );

      const siteWideExploratoryFindings =
        buildSiteWideExploratoryFindings(
          canonicalFindings,
          inspectedPages.map(
            pageResult =>
              pageResult
                .observation
                .finalUrl
          )
        );

      const allKnownFindingOccurrences =
        inspectedPages.flatMap(
          pageResult =>
            pageResult
              .knownFindingOccurrences
        );

      const allClassifiedFailedRequests =
        inspectedPages.flatMap(
          pageResult =>
            pageResult
              .classifiedDiagnostics
              .failedRequests
        );

      const actionableDiagnosticsCount =
        allClassifiedFailedRequests
          .filter(
            item =>
              item.disposition ===
              'actionable'
          )
          .length;

      const diagnosticsNeedingReviewCount =
        allClassifiedFailedRequests
          .filter(
            item =>
              item.disposition ===
              'needs-review'
          )
          .length;

      const ignoredDiagnosticNoiseCount =
        allClassifiedFailedRequests
          .filter(
            item =>
              item.disposition ===
              'ignored-noise'
          )
          .length;

      const report:
        SiteAgentReport = {
        reportSchemaVersion:
          '3',

        runId,

        startedAt:
          startedAt.toISOString(),

        finishedAt:
          new Date().toISOString(),

        site: {
          id:
            site.id,

          name:
            site.name,

          startUrl:
            site.startUrl
        },

        homepage:
          homepageObservation,

        outcome,

        inspectedPages,

        findings:
          canonicalFindings,

        siteWideExploratoryFindings,

        passiveSecurity:
          getPassiveSecurityReport(
            passiveSecurityRegistry
          ),

        summary: {
          pagesInspected:
            inspectedPages.length,

          logicalFindingsCount:
            canonicalFindings.length,

          findingOccurrencesCount:
            canonicalFindings.reduce(
              (
                total,
                finding
              ) =>
                total +
                finding
                  .occurrences
                  .length,
              0
            ),

          findingsCount:
            allFindings.length,

          highestSeverity:
            getHighestSeverity(
              canonicalFindings
            ),

          exploratoryQaFindingsCount:
            siteWideExploratoryFindings
              .reduce(
                (
                  total,
                  finding
                ) =>
                  total +
                  finding.occurrenceCount,
                0
              ),

          siteWideExploratoryFindingsCount:
            siteWideExploratoryFindings.length,

          knownFindingOccurrencesCount:
            allKnownFindingOccurrences.length,

          knownFindingsSuppliedToAnalysisCount,

          newCandidateFindingsCount,

          redundantInvestigationsSkippedCount,

          highestExploratoryQaSeverity:
            getHighestExploratoryQaSeverity(
              allExploratoryQaFindings
            ),

          actionableDiagnosticsCount,

          diagnosticsNeedingReviewCount,

          ignoredDiagnosticNoiseCount
        }
      };

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
        `Type: ${outcome.type}`
      );

      console.log(
        `Summary: ${outcome.summary}`
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
    } finally {
      diagnosticsCollector.dispose();
    }
  } finally {
    await browser.close();
  }
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
