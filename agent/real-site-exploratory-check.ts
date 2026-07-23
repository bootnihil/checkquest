import { chromium } from '@playwright/test';

import { analyzePageForQa } from './analysis/analyze-page-for-qa';
import { classifyDiagnostics } from './analysis/classify-diagnostics';
import { evaluatePageObservation } from './analysis/evaluate-page';

import type {
  ExploratoryQaFinding
} from './analysis/exploratory-qa-schema';

import { capturePageScreenshot } from './browser/capture-page-screenshot';
import { captureSelectOptionEvidence } from './browser/capture-select-option-evidence';
import { collectPageDiagnostics } from './browser/collect-page-diagnostics';
import { extractPageContent } from './browser/extract-page-content';
import { inspectNavigation } from './browser/inspect-navigation';
import { visitApprovedLink } from './browser/visit-approved-link';

import {
  createObservedTemplateKey,
  predictPageIdentity
} from './exploration/page-novelty';

import {
  evaluateFindingInvestigationOutcome
} from './investigation/evaluate-finding-investigation-outcome';
import {
  assignPageCandidateReferences
} from './investigation/page-candidates';

import {
  buildSiteWideExploratoryFindings
} from './reporting/build-site-wide-exploratory-findings';

import {
  createRunId,
  getHighestSeverity
} from './reporting/report-utils';

import type {
  SiteAgentReport
} from './reporting/report-types';

import { writeJsonReport } from './reporting/write-json-report';
import { writeMarkdownReport } from './reporting/write-markdown-report';
import { getSiteConfig } from './sites';

function getHighestExploratoryQaSeverity(
  findings: ExploratoryQaFinding[]
): 'high' | 'medium' | 'low' | 'none' {
  if (
    findings.some(
      finding =>
        finding.severity === 'high'
    )
  ) {
    return 'high';
  }

  if (
    findings.some(
      finding =>
        finding.severity === 'medium'
    )
  ) {
    return 'medium';
  }

  if (
    findings.some(
      finding =>
        finding.severity === 'low'
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

  const siteId =
    process.argv[2] ??
    'aidoc';

  const site =
    getSiteConfig(
      siteId
    );

  console.log(
    `Run ID: ${runId}`
  );

  console.log(
    `Selected site: ${site.name}`
  );

  console.log(
    `Start URL: ${site.startUrl}`
  );

  const browser =
    await chromium.launch({
      headless:
        true
    });

  try {
    const page =
      await browser.newPage();

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

      const homepageUrl =
        new URL(
          page.url()
        );

      if (
        !site.allowedHosts.includes(
          homepageUrl.hostname
        )
      ) {
        throw new Error(
          `Homepage redirected to disallowed host "${homepageUrl.hostname}".`
        );
      }

      const homepageObservation = {
        requestedUrl:
          site.startUrl,

        finalUrl:
          homepageUrl.toString(),

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
        `Title: ${homepageObservation.title}`
      );

      const navigationLinks =
        await inspectNavigation(
          page,
          site.allowedHosts
        );

      const targetLink =
        navigationLinks.find(
          link =>
            link.url !==
              site.startUrl &&
            link.url !==
              homepageObservation.finalUrl
        );

      if (!targetLink) {
        throw new Error(
          'No safe non-homepage navigation target was found.'
        );
      }

      console.log(
        '\nDeterministically selected test page:'
      );

      console.log(
        `Text: ${targetLink.text}`
      );

      console.log(
        `URL: ${targetLink.url}`
      );

      diagnosticsCollector.reset();

      const pageObservation =
        await visitApprovedLink(
          page,
          targetLink,
          site.allowedHosts
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

      const findings =
        evaluatePageObservation(
          pageObservation
        );

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
        `Select controls: ${pageContent.selects.length}`
      );

      console.log(
        `Body text characters: ${pageContent.bodyText.length}`
      );

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

      const pageCandidates =
        assignPageCandidateReferences(
          exploratoryQaAnalysis.findings
        );

      console.log(
        '\nExploratory QA analysis:'
      );

      console.log(
        JSON.stringify(
          exploratoryQaAnalysis,
          null,
          2
        )
      );

      const actionableDiagnosticsCount =
        classifiedDiagnostics
          .failedRequests
          .filter(
            item =>
              item.disposition ===
              'actionable'
          )
          .length;

      const diagnosticsNeedingReviewCount =
        classifiedDiagnostics
          .failedRequests
          .filter(
            item =>
              item.disposition ===
              'needs-review'
          )
          .length;

      const ignoredDiagnosticNoiseCount =
        classifiedDiagnostics
          .failedRequests
          .filter(
            item =>
              item.disposition ===
              'ignored-noise'
          )
          .length;

      /*
       * Prefer focused, machine-targeted evidence when
       * Gemini identifies a UI element we know how to
       * locate safely.
       *
       * For now, our only supported target is:
       *   select-option
       *
       * This controlled integration check records one
       * screenshot path in the report, so we capture the
       * first usable targeted finding.
       */
      let screenshotPath:
        string | null = null;

      for (
        let findingIndex = 0;
        findingIndex <
          exploratoryQaAnalysis
            .findings
            .length;
        findingIndex += 1
      ) {
        const exploratoryFinding =
          exploratoryQaAnalysis
            .findings[
              findingIndex
            ];

        const evidenceTarget =
          exploratoryFinding
            .evidenceTarget;

        if (
          evidenceTarget ===
          null
        ) {
          continue;
        }

        if (
          evidenceTarget.kind ===
          'select-option'
        ) {
          console.log(
            '\nAttempting targeted evidence capture:'
          );

          console.log(
            `Finding: ${exploratoryFinding.title}`
          );

          console.log(
            `Control label: ${evidenceTarget.controlLabel ?? 'unknown'}`
          );

          console.log(
            `Control name: ${evidenceTarget.controlName ?? 'unknown'}`
          );

          console.log(
            `Control id: ${evidenceTarget.controlId ?? 'unknown'}`
          );

          console.log(
            `Option text: ${evidenceTarget.optionText}`
          );

          try {
            const targetedEvidence =
              await captureSelectOptionEvidence(
                page,
                runId,
                1,
                findingIndex + 1,
                evidenceTarget
              );

            screenshotPath =
              targetedEvidence.filePath;

            console.log(
              '\nTargeted screenshot evidence captured:'
            );

            console.log(
              `Screenshot: ${targetedEvidence.filePath}`
            );

            console.log(
              `Selected option: ${targetedEvidence.optionText}`
            );

            console.log(
              `Locator strategy: ${targetedEvidence.locatorStrategy}`
            );

            break;
          } catch (
            error: unknown
          ) {
            console.warn(
              '\nTargeted evidence capture failed. Falling back if necessary.'
            );

            console.warn(
              error
            );
          }
        }
      }

      const shouldCaptureFallbackScreenshot =
        screenshotPath ===
          null &&
        (
          findings.length >
            0 ||
          actionableDiagnosticsCount >
            0 ||
          diagnosticsNeedingReviewCount >
            0 ||
          exploratoryQaAnalysis
            .findings
            .length >
            0
        );

      if (
        shouldCaptureFallbackScreenshot
      ) {
        const screenshot =
          await capturePageScreenshot(
            page,
            runId,
            1
          );

        screenshotPath =
          screenshot.filePath;

        console.log(
          '\nFallback full-page screenshot captured:'
        );

        console.log(
          screenshotPath
        );
      }

      if (
        screenshotPath ===
        null
      ) {
        console.log(
          '\nScreenshot evidence: not required.'
        );
      }

      /*
       * This controlled integration check does not run the
       * autonomous exploratory planner/action loop.
       *
       * Therefore its exploratory candidates do not have
       * autonomous investigation evidence and must remain
       * explicitly inconclusive.
       *
       * Targeted screenshot capture above is evidence capture,
       * not a substitute for the autonomous investigation
       * result contract.
       */
      const exploratoryInvestigation =
        null;

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
                exploratoryInvestigation
              )
          })
        );

      /*
       * Produce the same run-level deduplicated view used
       * by the full multi-page autonomous agent.
       *
       * This check inspects only one page, but using the same
       * builder keeps the report contract and behavior aligned.
       */
      const siteWideExploratoryFindings =
        buildSiteWideExploratoryFindings([
          {
            pageUrl:
              pageObservation
                .finalUrl,

            pageTitle:
              pageObservation
                .title,

            screenshotPath,

            findings:
              exploratoryQaAnalysis
                .findings
          }
        ]);

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

        outcome: {
          type:
            'completed',

          summary:
            'Completed single-page real-site exploratory QA integration check.'
        },

        inspectedPages: [
          {
            selection: {
              link:
                targetLink,

              reason:
                'Deterministically selected for a controlled single-page integration check.'
            },

            observation:
              pageObservation,

            pageNovelty: {
              predictedIdentity:
                predictPageIdentity(
                  pageObservation
                    .requestedUrl,
                  navigationLinks
                ),

              observedTemplateKey:
                createObservedTemplateKey(
                  pageContent
                )
            },

            diagnostics,

            classifiedDiagnostics,

            screenshotPath,

            findings,

            exploratoryQaAnalysis,

            exploratoryInvestigation,

            exploratoryFindingResults,

            knownFindingOccurrences: []
          }
        ],

        siteWideExploratoryFindings,

        summary: {
          pagesInspected:
            1,

          findingsCount:
            findings.length,

          highestSeverity:
            getHighestSeverity(
              findings
            ),

          exploratoryQaFindingsCount:
            exploratoryQaAnalysis
              .findings
              .length,

          siteWideExploratoryFindingsCount:
            siteWideExploratoryFindings
              .length,

          knownFindingOccurrencesCount:
            0,

          knownFindingsSuppliedToAnalysisCount:
            0,

          newCandidateFindingsCount:
            exploratoryQaAnalysis
              .findings
              .length,

          redundantInvestigationsSkippedCount:
            0,

          highestExploratoryQaSeverity:
            getHighestExploratoryQaSeverity(
              exploratoryQaAnalysis
                .findings
            ),

          actionableDiagnosticsCount,

          diagnosticsNeedingReviewCount,

          ignoredDiagnosticNoiseCount
        }
      };

      const jsonReport =
        await writeJsonReport(
          report
        );

      const markdownReport =
        await writeMarkdownReport(
          report
        );

      console.log(
        '\nFinding investigation outcomes:'
      );

      if (
        exploratoryFindingResults.length ===
        0
      ) {
        console.log(
          'No exploratory candidate findings.'
        );
      } else {
        for (
          const result of
            exploratoryFindingResults
        ) {
          console.log(
            `- [${result.outcome.status.toUpperCase()}] ${result.finding.title}`
          );
        }
      }

      console.log(
        '\nIntegration report saved:'
      );

      console.log(
        `JSON: ${jsonReport.filePath}`
      );

      console.log(
        `Markdown: ${markdownReport.filePath}`
      );

      console.log(
        '\nReal-site exploratory QA integration check complete.'
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
      'Real-site exploratory QA check failed:',
      error
    );

    process.exitCode =
      1;
  }
);
