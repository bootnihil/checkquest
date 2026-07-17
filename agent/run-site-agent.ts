import { chromium } from '@playwright/test';
import { evaluatePageObservation } from './analysis/evaluate-page';
import { inspectNavigation } from './browser/inspect-navigation';
import { visitApprovedLink } from './browser/visit-approved-link';
import { chooseNavigationLink } from './decisions/choose-navigation-link';
import {
  createRunId,
  getHighestSeverity
} from './reporting/report-utils';
import type { SiteAgentReport } from './reporting/report-types';
import { writeJsonReport } from './reporting/write-json-report';
import { writeMarkdownReport } from './reporting/write-markdown-report';
import { getSiteConfig } from './sites';

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

  const browser = await chromium.launch({
    headless: true
  });

  try {
    const page = await browser.newPage();

    const homepageResponse = await page.goto(site.startUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000
    });

    const homepageFinalUrl = new URL(page.url());

    if (!site.allowedHosts.includes(homepageFinalUrl.hostname)) {
      throw new Error(
        `Homepage redirected to disallowed host "${homepageFinalUrl.hostname}".`
      );
    }

    const homepageObservation = {
      requestedUrl: site.startUrl,
      finalUrl: homepageFinalUrl.toString(),
      title: await page.title(),
      httpStatus: homepageResponse?.status() ?? null
    };

    console.log('\nHomepage opened:');
    console.log(
      `HTTP status: ${homepageObservation.httpStatus ?? 'unknown'}`
    );
    console.log(`Final URL: ${homepageObservation.finalUrl}`);
    console.log(`Title: ${homepageObservation.title}`);

    const navigationLinks = await inspectNavigation(
      page,
      site.allowedHosts
    );

    console.log(
      `\nSafe navigation candidates found: ${navigationLinks.length}`
    );

    const decision = await chooseNavigationLink(
      site,
      navigationLinks
    );

    if (decision.type === 'finish') {
      console.log('\nAgent decision: FINISH');
      console.log(`Summary: ${decision.summary}`);

      const report: SiteAgentReport = {
        runId,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        site: {
          id: site.id,
          name: site.name,
          startUrl: site.startUrl
        },
        homepage: homepageObservation,
        selection: null,
        inspectedPages: [],
        summary: {
          pagesInspected: 0,
          findingsCount: 0,
          highestSeverity: 'none'
        }
      };

      const writtenJsonReport = await writeJsonReport(report);
      const writtenMarkdownReport = await writeMarkdownReport(report);

      console.log(
        `\nJSON report saved: ${writtenJsonReport.filePath}`
      );
      console.log(
        `Markdown report saved: ${writtenMarkdownReport.filePath}`
      );

      console.log('\nAgent run complete.');
      return;
    }

    console.log('\nAgent selected a navigation target:');
    console.log(`Text: ${decision.link.text}`);
    console.log(`URL: ${decision.link.url}`);
    console.log(`Reason: ${decision.reason}`);

    const pageObservation = await visitApprovedLink(
      page,
      decision.link,
      site.allowedHosts
    );

    console.log('\nSelected page visited successfully:');
    console.log(
      JSON.stringify(pageObservation, null, 2)
    );

    const findings = evaluatePageObservation(
      pageObservation
    );

    if (findings.length === 0) {
      console.log(
        '\nDeterministic evaluation: no obvious issues found.'
      );
    } else {
      console.log(
        `\nDeterministic evaluation: ${findings.length} potential issue(s) found.`
      );
      console.log(
        JSON.stringify(findings, null, 2)
      );
    }

    const report: SiteAgentReport = {
      runId,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      site: {
        id: site.id,
        name: site.name,
        startUrl: site.startUrl
      },
      homepage: homepageObservation,
      selection: {
        link: decision.link,
        reason: decision.reason
      },
      inspectedPages: [
        {
          observation: pageObservation,
          findings
        }
      ],
      summary: {
        pagesInspected: 1,
        findingsCount: findings.length,
        highestSeverity: getHighestSeverity(findings)
      }
    };

    const writtenJsonReport = await writeJsonReport(report);
    const writtenMarkdownReport = await writeMarkdownReport(report);

    console.log(
      `\nJSON report saved: ${writtenJsonReport.filePath}`
    );
    console.log(
      `Markdown report saved: ${writtenMarkdownReport.filePath}`
    );

    console.log('\nAgent run complete.');
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error('Site agent run failed:', error);
  process.exitCode = 1;
});
