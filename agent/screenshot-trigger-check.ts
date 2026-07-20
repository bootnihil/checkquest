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
      headless: true
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

    const shouldCaptureScreenshot =
      findings.length > 0 ||
      actionableRequestCount > 0 ||
      needsReviewCount > 0;

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

    const startedAt =
      new Date();

    const report:
      SiteAgentReport = {
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

            diagnostics,

            classifiedDiagnostics,

            screenshotPath,

            findings,

            exploratoryQaAnalysis
          }
        ],

        summary: {
          pagesInspected:
            1,

          findingsCount:
            findings.length,

          highestSeverity:
            'none',

          exploratoryQaFindingsCount:
            exploratoryQaAnalysis
              .findings
              .length,

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

    process.exitCode = 1;
  }
);
