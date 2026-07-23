import { chromium } from '@playwright/test';

import { analyzePageForQa } from './analysis/analyze-page-for-qa';
import { classifyDiagnostics } from './analysis/classify-diagnostics';
import { evaluatePageObservation } from './analysis/evaluate-page';

import type {
  ExploratoryQaFinding
} from './analysis/exploratory-qa-schema';

import { capturePageScreenshot } from './browser/capture-page-screenshot';
import { collectPageDiagnostics } from './browser/collect-page-diagnostics';
import { preparePageForGuardedInteractions } from './browser/execute-guarded-disclosure-action';
import { extractPageContent } from './browser/extract-page-content';

import {
  inspectNavigation,
  type NavigationLink
} from './browser/inspect-navigation';

import { visitApprovedLink } from './browser/visit-approved-link';

import {
  applyAgentRunOptions,
  parseAgentRunOptions
} from './config/agent-run-options';

import { chooseNavigationLink } from './decisions/choose-navigation-link';

import {
  getUnvisitedLinks,
  markUrlVisited,
  normalizeUrlForComparison
} from './exploration/visited-links';

import {
  buildNoveltyCandidateWindow,
  createPageNoveltyState,
  predictPageIdentity,
  registerInspectedPageNovelty,
  registerPredictedPageIdentity
} from './exploration/page-novelty';

import {
  evaluateFindingInvestigationOutcome
} from './investigation/evaluate-finding-investigation-outcome';
import {
  buildKnownFindingPromptContext,
  createKnownFindingState,
  detectStructuredKnownFindingOccurrences,
  reconcilePageFindings,
  registerKnownFindingOccurrence,
  registerNewFinding
} from './investigation/known-findings';
import {
  assignPageCandidateReferences,
  isInvestigablePageCandidate,
  type PageCandidateReference
} from './investigation/page-candidates';

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
import { getSiteConfig } from './sites';

function addLinksToPool(
  linkPool: Map<string, NavigationLink>,
  links: NavigationLink[]
): number {
  let addedCount = 0;

  for (const link of links) {
    const normalizedUrl =
      normalizeUrlForComparison(
        link.url
      );

    if (
      linkPool.has(
        normalizedUrl
      )
    ) {
      continue;
    }

    linkPool.set(
      normalizedUrl,
      link
    );

    addedCount += 1;
  }

  return addedCount;
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

      const visitedUrls =
        new Set<string>();

      markUrlVisited(
        visitedUrls,
        homepageObservation.requestedUrl
      );

      markUrlVisited(
        visitedUrls,
        homepageObservation.finalUrl
      );

      const linkPool =
        new Map<
          string,
          NavigationLink
        >();

      const pageNoveltyState =
        createPageNoveltyState();

      const knownFindingState =
        createKnownFindingState();

      let knownFindingsSuppliedToAnalysisCount =
        0;

      let newCandidateFindingsCount =
        0;

      let redundantInvestigationsSkippedCount =
        0;

      const homepageLinks =
        await inspectNavigation(
          page,
          site.allowedHosts
        );

      addLinksToPool(
        linkPool,
        homepageLinks
      );

      registerPredictedPageIdentity(
        pageNoveltyState,
        predictPageIdentity(
          homepageObservation.finalUrl,
          homepageLinks
        )
      );

      console.log(
        `\nInitial safe navigation candidates found: ${homepageLinks.length}`
      );

      const inspectedPages:
        InspectedPageResult[] = [];

      let agentSteps =
        0;

      let outcome:
        SiteAgentReport['outcome'] |
        null =
          null;

      while (
        inspectedPages.length <
          site.maxPages &&
        agentSteps <
          site.maxAgentSteps
      ) {
        const unvisitedLinks =
          getUnvisitedLinks(
            Array.from(
              linkPool.values()
            ),
            visitedUrls
          );

        const candidateLinks =
          buildNoveltyCandidateWindow(
            unvisitedLinks,
            Array.from(
              linkPool.values()
            ),
            pageNoveltyState,
            20
          );

        console.log(
          `\nNavigation step ${agentSteps + 1}/${site.maxAgentSteps}`
        );

        console.log(
          `Pages inspected: ${inspectedPages.length}/${site.maxPages}`
        );

        console.log(
          `Unvisited safe candidates available: ${unvisitedLinks.length}`
        );

        console.log(
          `Diversified candidates supplied to Gemini: ${candidateLinks.length}`
        );

        if (
          candidateLinks.length ===
          0
        ) {
          outcome = {
            type:
              'finished',

            summary:
              'No unvisited safe navigation links remained.'
          };

          console.log(
            '\nAgent exploration finished:'
          );

          console.log(
            outcome.summary
          );

          break;
        }

        agentSteps += 1;

        const decision =
          await chooseNavigationLink(
            site,
            candidateLinks
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

          break;
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
          `Reason: ${decision.reason}`
        );

        markUrlVisited(
          visitedUrls,
          decision.link.url
        );

        diagnosticsCollector.reset();

        const pageObservation =
          await visitApprovedLink(
            page,
            decision.link,
            site.allowedHosts
          );

        markUrlVisited(
          visitedUrls,
          pageObservation.finalUrl
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
          '\nSelected page visited successfully:'
        );

        console.log(
          JSON.stringify(
            pageObservation,
            null,
            2
          )
        );

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

        const pageNovelty =
          registerInspectedPageNovelty(
            pageNoveltyState,
            decision
              .predictedIdentity,
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

        const deterministicKnownOccurrenceDrafts =
          detectStructuredKnownFindingOccurrences(
            knownFindingState,
            pageContent
          );

        const knownFindingContext =
          buildKnownFindingPromptContext(
            knownFindingState,
            deterministicKnownOccurrenceDrafts.map(
              draft =>
                draft.fingerprint
            )
          );

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

        const reconciledPageFindings =
          reconcilePageFindings(
            knownFindingState,
            rawExploratoryQaAnalysis
              .findings,
            deterministicKnownOccurrenceDrafts
          );

        const exploratoryQaAnalysis = {
          ...rawExploratoryQaAnalysis,

          /*
           * Keep page-local analysis findings limited to genuinely
           * new findings. Known occurrences are recorded separately.
           */
          findings:
            reconciledPageFindings
              .newFindings
        };

        newCandidateFindingsCount +=
          reconciledPageFindings
            .newFindings
            .length;

        const candidateInputs = [
          ...reconciledPageFindings
            .newFindings
            .map(
              finding => ({
                finding,
                knownFingerprint:
                  null as string | null
              })
            ),

          ...reconciledPageFindings
            .reinvestigationFindings
            .map(
              item => ({
                finding:
                  item.finding,

                knownFingerprint:
                  item.fingerprint
              })
            )
        ];

        const pageCandidates =
          assignPageCandidateReferences(
            candidateInputs.map(
              item =>
                item.finding
            )
          );

        const knownFingerprintByCandidateReference =
          new Map<
            PageCandidateReference,
            string
          >();

        pageCandidates.forEach(
          (
            candidate,
            index
          ) => {
            const knownFingerprint =
              candidateInputs[
                index
              ]
                .knownFingerprint;

            if (
              knownFingerprint !==
              null
            ) {
              knownFingerprintByCandidateReference
                .set(
                  candidate.reference,
                  knownFingerprint
                );
            }
          }
        );

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
            inspectedPages.length +
            1;

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

        const findingResultByCandidateReference =
          new Map(
            exploratoryFindingResults.map(
              result => [
                result
                  .candidateReference,
                result
              ]
            )
          );

        const knownFindingOccurrences =
          reconciledPageFindings
            .knownOccurrenceDrafts
            .map(
              draft => {
                const reinvestigationCandidateReference =
                  Array.from(
                    knownFingerprintByCandidateReference
                      .entries()
                  )
                    .find(
                      (
                        [
                          ,
                          fingerprint
                        ]
                      ) =>
                        fingerprint ===
                        draft.fingerprint
                    )
                    ?.[0];

                const verificationOutcome =
                  reinvestigationCandidateReference ===
                    undefined
                    ? null
                    : findingResultByCandidateReference
                        .get(
                          reinvestigationCandidateReference
                        )
                        ?.outcome ??
                      null;

                return registerKnownFindingOccurrence(
                  knownFindingState,
                  {
                    fingerprint:
                      draft.fingerprint,

                    finding:
                      draft.finding,

                    pageUrl:
                      pageObservation.finalUrl,

                    pageTitle:
                      pageObservation.title,

                    screenshotPath,

                    occurrenceEvidence:
                      draft
                        .occurrenceEvidence,

                    evidenceTarget:
                      draft
                        .evidenceTarget,

                    matchingBases:
                      draft
                        .matchingBases,

                    modelKnownFindingReference:
                      draft
                        .modelKnownFindingReference,

                    modelReferenceMatched:
                      draft
                        .modelReferenceMatched,

                    redundantInvestigationSkipped:
                      draft
                        .redundantInvestigationSkipped,

                    verificationOutcome
                  }
                );
              }
            );

        for (
          let findingIndex = 0;
          findingIndex <
            reconciledPageFindings
              .newFindings
              .length;
          findingIndex +=
            1
        ) {
          const result =
            exploratoryFindingResults[
              findingIndex
            ];

          if (
            result ===
            undefined
          ) {
            throw new Error(
              'A new exploratory finding is missing its page-local investigation result.'
            );
          }

          registerNewFinding(
            knownFindingState,
            {
              finding:
                result.finding,

              pageUrl:
                pageObservation
                  .finalUrl,

              pageTitle:
                pageObservation
                  .title,

              screenshotPath,

              verificationOutcome:
                result.outcome
            }
          );
        }

        inspectedPages.push({
          selection: {
            link:
              decision.link,

            reason:
              decision.reason
          },

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
        });

        const discoveredLinks =
          await inspectNavigation(
            page,
            site.allowedHosts
          );

        const newlyAddedLinks =
          addLinksToPool(
            linkPool,
            discoveredLinks
          );

        console.log(
          `\nAdditional safe links discovered on this page: ${newlyAddedLinks}`
        );

        console.log(
          `Total unique safe links in pool: ${linkPool.size}`
        );
      }

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

      const siteWideExploratoryFindings =
        buildSiteWideExploratoryFindings(
          inspectedPages.map(
            pageResult => ({
              pageUrl:
                pageResult
                  .observation
                  .finalUrl,

              pageTitle:
                pageResult
                  .observation
                  .title,

              screenshotPath:
                pageResult
                  .screenshotPath,

              findings:
                pageResult
                  .exploratoryQaAnalysis
                  .findings,

              knownFindingOccurrences:
                pageResult
                  .knownFindingOccurrences
            })
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

        siteWideExploratoryFindings,

        summary: {
          pagesInspected:
            inspectedPages.length,

          findingsCount:
            allFindings.length,

          highestSeverity:
            getHighestSeverity(
              allFindings
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
