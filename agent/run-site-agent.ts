import { chromium } from '@playwright/test';

import { analyzePageForQa } from './analysis/analyze-page-for-qa';
import { classifyDiagnostics } from './analysis/classify-diagnostics';
import { evaluatePageObservation } from './analysis/evaluate-page';

import type {
  ExploratoryQaFinding
} from './analysis/exploratory-qa-schema';

import { capturePageScreenshot } from './browser/capture-page-screenshot';
import { collectPageDiagnostics } from './browser/collect-page-diagnostics';
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

  /*
   * Parse and validate all command-line input before opening
   * a browser or making any Gemini request.
   *
   * Examples:
   *
   *   npm run agent:explore -- https://example.com/
   *
   *   npm run agent:explore -- https://example.com/ \
   *     --pages 5 \
   *     --steps-per-page 4
   */
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

  /*
   * Apply per-run exploration limits without mutating the
   * configured or temporary base site definition.
   */
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
      await browser.newPage();

    const diagnosticsCollector =
      collectPageDiagnostics(
        page
      );

    try {
      /*
       * Open the configured starting page.
       */
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

      /*
       * Track pages already visited so the agent does not
       * continually revisit the same navigation targets.
       */
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

      /*
       * The link pool grows as new pages are inspected.
       */
      const linkPool =
        new Map<
          string,
          NavigationLink
        >();

      const homepageLinks =
        await inspectNavigation(
          page,
          site.allowedHosts
        );

      addLinksToPool(
        linkPool,
        homepageLinks
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

      /*
       * Multi-page exploration loop.
       *
       * The navigation agent chooses which safe page to visit next.
       *
       * Once a page is opened, the separate exploratory planner is
       * allowed to investigate that page within its own bounded
       * per-page action budget.
       */
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
          unvisitedLinks.slice(
            0,
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

        /*
         * Gemini chooses one safe internal navigation target.
         */
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

        /*
         * The deterministic browser layer performs the approved
         * navigation and verifies the destination remains inside
         * the configured host boundary.
         */
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

        /*
         * Some resource failures and console messages arrive shortly
         * after the main document has loaded.
         */
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

        /*
         * Deterministic page-health evaluation.
         */
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

        /*
         * Extract the current user-facing page state in a generic,
         * structured representation that Gemini can reason about.
         */
        const pageContent =
          await extractPageContent(
            page
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

        /*
         * Password-bearing pages are still observable, but we do not
         * autonomously interact with them.
         */
        const containsPasswordField =
          pageContent.textFields.some(
            field =>
              field.inputType ===
              'password'
          );

        /*
         * Gemini performs evidence-grounded exploratory QA analysis.
         *
         * These findings are candidate issues, not confirmed defects.
         */
        const exploratoryQaAnalysis =
          await analyzePageForQa({
            observation:
              pageObservation,

            content:
              pageContent,

            classifiedDiagnostics,

            ruleBasedFindings:
              findings
          });

        console.log(
          '\nExploratory QA analysis:'
        );

        console.log(
          `Candidate findings: ${exploratoryQaAnalysis.findings.length}`
        );

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

        /*
         * Run the bounded autonomous investigation.
         *
         * The planner sees:
         * - the current live browser state;
         * - the candidate findings discovered above;
         * - its own previous investigation history.
         *
         * It may choose safe supported actions or stop voluntarily.
         */
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
          0
        ) {
          console.log(
            '\nStarting autonomous page investigation...'
          );

          console.log(
            `Maximum investigation steps: ${site.maxExploratoryStepsPerPage}`
          );

          console.log(
            `Candidate findings supplied to planner: ${exploratoryQaAnalysis.findings.length}`
          );

          exploratoryInvestigation =
            await runExploratoryLoop(
              page,
              pageObservation.finalUrl,
              site.maxExploratoryStepsPerPage,
              exploratoryQaAnalysis.findings
            );

          /*
           * Defense-in-depth host verification.
           *
           * None of the currently permitted exploratory actions can
           * intentionally navigate away, but we still verify the browser
           * remained inside the configured host boundary.
           */
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
            `Completed steps: ${exploratoryInvestigation.completedSteps}/${exploratoryInvestigation.maxSteps}`
          );

          console.log(
            `Stop reason: ${exploratoryInvestigation.stopReason}`
          );
        }

        /*
         * Capture evidence after autonomous investigation so the saved
         * screenshot represents the resulting browser state.
         */
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

        /*
         * Preserve everything we learned about the page:
         *
         * - deterministic findings;
         * - AI candidate findings;
         * - autonomous planner decisions and actions;
         * - browser evidence.
         */
        inspectedPages.push({
          selection: {
            link:
              decision.link,

            reason:
              decision.reason
          },

          observation:
            pageObservation,

          diagnostics,

          classifiedDiagnostics,

          screenshotPath,

          findings,

          exploratoryQaAnalysis,

          exploratoryInvestigation
        });

        /*
         * Reinspect navigation after the page investigation.
         *
         * This allows newly available safe links to enter the pool for
         * subsequent website-level exploration.
         */
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

      /*
       * Determine why the site-level exploration stopped.
       */
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

      /*
       * Aggregate run-level report statistics.
       */
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

      /*
       * Build a deterministic site-wide view of exploratory
       * findings while retaining all original page-level data.
       */
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
                  .findings
            })
          )
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
            allExploratoryQaFindings.length,

          siteWideExploratoryFindingsCount:
            siteWideExploratoryFindings.length,

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
