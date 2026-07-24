import { chromium } from '@playwright/test';

import type {
  ExploratoryQaAnalysis
} from './analysis/exploratory-qa-schema';

import type {
  PageFinding
} from './analysis/evaluate-page';

import {
  classifyDiagnostics
} from './analysis/classify-diagnostics';

import {
  capturePageScreenshot
} from './browser/capture-page-screenshot';

import type {
  PageDiagnostics
} from './browser/collect-page-diagnostics';

import {
  buildSiteWideExploratoryFindings
} from './reporting/build-site-wide-exploratory-findings';
import {
  reconcileFindingObservations
} from './findings/reconcile-finding-observations';

import type {
  SiteAgentReport
} from './reporting/report-types';

import {
  writeJsonReport
} from './reporting/write-json-report';

import {
  writeMarkdownReport
} from './reporting/write-markdown-report';

async function main(): Promise<void> {
  const runId =
    'screenshot-trigger-check';

  const browser =
    await chromium.launch({
      headless:
        true
    });

  try {
    const page =
      await browser.newPage();

    await page.setContent(`
      <!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8">
          <title>Review-Worthy Diagnostics Test</title>
        </head>
        <body>
          <h1>Review-Worthy Diagnostics Test</h1>

          <p>
            This synthetic page verifies that a diagnostic
            marked as needing review triggers screenshot
            evidence and is recorded in the final reports.
          </p>
        </body>
      </html>
    `);

    const diagnostics:
      PageDiagnostics = {
        consoleErrors: [],

        failedRequests: [
          {
            url:
              'https://example.com/images/suspicious-image.jpg',

            method:
              'GET',

            resourceType:
              'image',

            failureText:
              'net::ERR_FAILED'
          }
        ]
      };

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

    const needsReviewCount =
      classifiedDiagnostics
        .failedRequests
        .filter(
          item =>
            item.disposition ===
            'needs-review'
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

    /*
     * This check is focused specifically on diagnostic-triggered
     * screenshot capture, so no rule-based page findings are needed.
     */
    const findings:
      PageFinding[] = [];

    /*
     * The current report format also expects exploratory QA analysis
     * results for every inspected page.
     *
     * This synthetic check does not call Gemini, so we provide a valid
     * empty analysis result instead.
     */
    const exploratoryQaAnalysis:
      ExploratoryQaAnalysis = {
        findings: [],

        summary:
          'No exploratory QA analysis was performed for this synthetic screenshot trigger check.'
      };

    /*
     * No exploratory candidates exist in this synthetic check,
     * therefore there are no finding investigation outcomes.
     */
    const exploratoryFindingResults:
      SiteAgentReport['inspectedPages'][number]['exploratoryFindingResults'] =
        [];

    const shouldCaptureScreenshot =
      findings.length >
        0 ||
      actionableRequestCount >
        0 ||
      needsReviewCount >
        0;

    let screenshotPath:
      string | null = null;

    if (
      shouldCaptureScreenshot
    ) {
      const screenshot =
        await capturePageScreenshot(
          page,
          runId,
          1
        );

      screenshotPath =
        screenshot.filePath;
    }

    /*
     * Build the same site-wide exploratory finding view used
     * by real agent runs.
     *
     * This synthetic check has no exploratory findings, so the
     * resulting collection should be empty.
     */
    const canonicalFindings =
      reconcileFindingObservations({
        pageUrl:
          'https://example.com/review-page',
        pageTitle:
          'Review-Worthy Diagnostics Test',
        ruleFindings:
          findings,
        modelFindings:
          exploratoryQaAnalysis
            .findings,
        screenshotReferences:
          screenshotPath ===
            null
            ? []
            : [
                screenshotPath
              ]
      }).findings;

    const siteWideExploratoryFindings =
      buildSiteWideExploratoryFindings(
        canonicalFindings,
        [
          'https://example.com/review-page'
        ]
      );

    const startedAt =
      new Date();

    const report:
      SiteAgentReport = {
        reportSchemaVersion:
          '2',

        runId,

        startedAt:
          startedAt.toISOString(),

        finishedAt:
          new Date().toISOString(),

        site: {
          id:
            'synthetic',

          name:
            'Synthetic screenshot trigger test',

          startUrl:
            'https://example.com/'
        },

        homepage: {
          requestedUrl:
            'https://example.com/',

          finalUrl:
            'https://example.com/',

          title:
            'Synthetic Homepage',

          httpStatus:
            200
        },

        outcome: {
          type:
            'completed',

          summary:
            'Completed controlled screenshot trigger integration test.'
        },

        inspectedPages: [
          {
            selection: {
              type:
                'agent-navigation',
              link: {
                text:
                  'Synthetic review page',

                url:
                  'https://example.com/review-page'
              },

              reason:
                'Controlled integration test page.'
            },

            observation: {
              requestedUrl:
                'https://example.com/review-page',

              finalUrl:
                'https://example.com/review-page',

              title:
                'Review-Worthy Diagnostics Test',

              httpStatus:
                200,

              headings: [
                'Review-Worthy Diagnostics Test'
              ]
            },

            pageNovelty: {
              predictedIdentity: {
                areaKey:
                  'review-page',

                routeFamilyKey:
                  '/review-page'
              },

              observedTemplateKey:
                'observed-v1:synthetic-review'
            },

            diagnostics,

            classifiedDiagnostics,

            screenshotPath,

            findings,

            exploratoryQaAnalysis,

            exploratoryInvestigation:
              null,

            exploratoryFindingResults,

            knownFindingOccurrences: []
          }
        ],

        findings:
          canonicalFindings,

        siteWideExploratoryFindings,

        summary: {
          pagesInspected:
            1,

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
            findings.length,

          highestSeverity:
            'none',

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
            0,

          redundantInvestigationsSkippedCount:
            0,

          highestExploratoryQaSeverity:
            'none',

          actionableDiagnosticsCount:
            actionableRequestCount,

          diagnosticsNeedingReviewCount:
            needsReviewCount,

          ignoredDiagnosticNoiseCount:
            ignoredNoiseCount
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
      'Integration test complete.'
    );

    console.log(
      `Actionable diagnostics: ${actionableRequestCount}`
    );

    console.log(
      `Diagnostics needing review: ${needsReviewCount}`
    );

    console.log(
      `Ignored diagnostic noise: ${ignoredNoiseCount}`
    );

    console.log(
      `Screenshot: ${screenshotPath ?? 'not captured'}`
    );

    console.log(
      `JSON report: ${jsonReport.filePath}`
    );

    console.log(
      `Markdown report: ${markdownReport.filePath}`
    );
  } finally {
    await browser.close();
  }
}

main().catch(
  (error: unknown) => {
    console.error(
      'Screenshot trigger check failed:',
      error
    );

    process.exitCode =
      1;
  }
);
