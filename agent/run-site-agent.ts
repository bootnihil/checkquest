import { chromium } from '@playwright/test';
import { classifyDiagnostics } from './analysis/classify-diagnostics';
import { evaluatePageObservation } from './analysis/evaluate-page';
import { collectPageDiagnostics } from './browser/collect-page-diagnostics';
import {
  inspectNavigation,
  type NavigationLink
} from './browser/inspect-navigation';
import { visitApprovedLink } from './browser/visit-approved-link';
import { chooseNavigationLink } from './decisions/choose-navigation-link';
import {
  getUnvisitedLinks,
  markUrlVisited,
  normalizeUrlForComparison
} from './exploration/visited-links';
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
    const normalizedUrl = normalizeUrlForComparison(
      link.url
    );

    if (linkPool.has(normalizedUrl)) {
      continue;
    }

    linkPool.set(normalizedUrl, link);
    addedCount += 1;
  }

  return addedCount;
}

async function main(): Promise<void> {
  const startedAt = new Date();
  const runId = createRunId(startedAt);

  const siteId = process.argv[2] ?? 'aidoc';
  const site = getSiteConfig(siteId);

  const configuredStartUrl = new URL(site.startUrl);

  if (!site.allowedHosts.includes(configuredStartUrl.hostname)) {
    throw new Error(
      `Configured start host "${configuredStartUrl.hostname}" is not allowed.`
    );
  }

  console.log(`Run ID: ${runId}`);
  console.log(`Selected site: ${site.name}`);
  console.log(`Start URL: ${site.startUrl}`);
  console.log(`Maximum pages: ${site.maxPages}`);
  console.log(`Maximum agent steps: ${site.maxAgentSteps}`);

  const browser = await chromium.launch({
    headless: true
  });

  try {
    const page = await browser.newPage();

    const diagnosticsCollector =
      collectPageDiagnostics(page);

    try {
      const homepageResponse = await page.goto(
        site.startUrl,
        {
          waitUntil: 'domcontentloaded',
          timeout: 30_000
        }
      );

      const homepageFinalUrl = new URL(page.url());

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
        requestedUrl: site.startUrl,
        finalUrl: homepageFinalUrl.toString(),
        title: await page.title(),
        httpStatus:
          homepageResponse?.status() ?? null
      };

      console.log('\nHomepage opened:');
      console.log(
        `HTTP status: ${homepageObservation.httpStatus ?? 'unknown'}`
      );
      console.log(
        `Final URL: ${homepageObservation.finalUrl}`
      );
      console.log(
        `Title: ${homepageObservation.title}`
      );

      const visitedUrls = new Set<string>();

      markUrlVisited(
        visitedUrls,
        homepageObservation.requestedUrl
      );

      markUrlVisited(
        visitedUrls,
        homepageObservation.finalUrl
      );

      const linkPool = new Map<
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

      let agentSteps = 0;

      let outcome:
        SiteAgentReport['outcome'] | null = null;

      while (
        inspectedPages.length < site.maxPages &&
        agentSteps < site.maxAgentSteps
      ) {
        const unvisitedLinks =
          getUnvisitedLinks(
            Array.from(linkPool.values()),
            visitedUrls
          );

        const candidateLinks =
          unvisitedLinks.slice(0, 20);

        console.log(
          `\nExploration step ${agentSteps + 1}/${site.maxAgentSteps}`
        );
        console.log(
          `Pages inspected: ${inspectedPages.length}/${site.maxPages}`
        );
        console.log(
          `Unvisited safe candidates available: ${unvisitedLinks.length}`
        );

        if (candidateLinks.length === 0) {
          outcome = {
            type: 'finished',
            summary:
              'No unvisited safe navigation links remained.'
          };

          console.log(
            '\nAgent exploration finished:'
          );
          console.log(outcome.summary);

          break;
        }

        agentSteps += 1;

        const decision =
          await chooseNavigationLink(
            site,
            candidateLinks
          );

        if (decision.type === 'finish') {
          outcome = {
            type: 'finished',
            summary: decision.summary
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

        /*
         * Some resource failures and console messages
         * arrive shortly after the main document loads.
         * Give the page a brief, bounded collection window.
         */
        await page.waitForTimeout(1_000);

        const diagnostics =
          diagnosticsCollector.snapshot();

        const classifiedDiagnostics =
          classifyDiagnostics(diagnostics);

        const actionableRequestCount =
          classifiedDiagnostics.failedRequests.filter(
            (item) =>
              item.disposition === 'actionable'
          ).length;

        const ignoredNoiseCount =
          classifiedDiagnostics.failedRequests.filter(
            (item) =>
              item.disposition === 'ignored-noise'
          ).length;

        const needsReviewCount =
          classifiedDiagnostics.failedRequests.filter(
            (item) =>
              item.disposition === 'needs-review'
          ).length;

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

        if (findings.length === 0) {
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

        inspectedPages.push({
          selection: {
            link: decision.link,
            reason: decision.reason
          },
          observation: pageObservation,
          diagnostics,
          classifiedDiagnostics,
          findings
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

      if (outcome === null) {
        if (
          inspectedPages.length >=
          site.maxPages
        ) {
          outcome = {
            type: 'completed',
            summary:
              `Reached the configured page limit of ${site.maxPages}.`
          };
        } else if (
          agentSteps >=
          site.maxAgentSteps
        ) {
          outcome = {
            type: 'completed',
            summary:
              `Reached the configured agent-step limit of ${site.maxAgentSteps}.`
          };
        } else {
          outcome = {
            type: 'completed',
            summary:
              'Exploration completed successfully.'
          };
        }
      }

      const allFindings =
        inspectedPages.flatMap(
          (pageResult) =>
            pageResult.findings
        );

      const allClassifiedFailedRequests =
        inspectedPages.flatMap(
          (pageResult) =>
            pageResult.classifiedDiagnostics.failedRequests
        );

      const actionableDiagnosticsCount =
        allClassifiedFailedRequests.filter(
          (item) =>
            item.disposition === 'actionable'
        ).length;

      const diagnosticsNeedingReviewCount =
        allClassifiedFailedRequests.filter(
          (item) =>
            item.disposition === 'needs-review'
        ).length;

      const ignoredDiagnosticNoiseCount =
        allClassifiedFailedRequests.filter(
          (item) =>
            item.disposition === 'ignored-noise'
        ).length;

      const report: SiteAgentReport = {
        runId,
        startedAt:
          startedAt.toISOString(),
        finishedAt:
          new Date().toISOString(),
        site: {
          id: site.id,
          name: site.name,
          startUrl: site.startUrl
        },
        homepage:
          homepageObservation,
        outcome,
        inspectedPages,
        summary: {
          pagesInspected:
            inspectedPages.length,
          findingsCount:
            allFindings.length,
          highestSeverity:
            getHighestSeverity(
              allFindings
            ),
          actionableDiagnosticsCount,
          diagnosticsNeedingReviewCount,
          ignoredDiagnosticNoiseCount
        }
      };

      const writtenJsonReport =
        await writeJsonReport(report);

      const writtenMarkdownReport =
        await writeMarkdownReport(report);

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

main().catch((error: unknown) => {
  console.error(
    'Site agent run failed:',
    error
  );

  process.exitCode = 1;
});
