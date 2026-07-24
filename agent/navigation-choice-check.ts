import { chromium } from '@playwright/test';
import { inspectNavigation } from './browser/inspect-navigation';
import { chooseNavigationLink } from './decisions/choose-navigation-link';
import {
  createPageNoveltyState
} from './exploration/page-novelty';
import {
  buildNavigationPolicyWindow,
  createNavigationBudgetContext,
  createNavigationFrontier,
  registerDiscoveredNavigationLinks
} from './exploration/navigation-policy';
import {
  createNavigationUrlState
} from './exploration/visited-links';
import { getSiteConfig } from './sites';

async function main(): Promise<void> {
  const siteId = process.argv[2] ?? 'aidoc';
  const site = getSiteConfig(siteId);

  console.log(`Selected site: ${site.name}`);

  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();

    await page.goto(site.startUrl, {
      waitUntil: 'domcontentloaded'
    });

    const navigationLinks = await inspectNavigation(
      page,
      site.allowedHosts
    );

    console.log(
      `Safe navigation candidates found: ${navigationLinks.length}`
    );

    const frontier =
      createNavigationFrontier();

    registerDiscoveredNavigationLinks(
      frontier,
      navigationLinks,
      page.url(),
      0
    );

    const budget =
      createNavigationBudgetContext(
        site.maxPages,
        1,
        site.maxAgentSteps,
        0
      );

    const policyWindow =
      buildNavigationPolicyWindow({
        frontier,
        urlState:
          createNavigationUrlState(),
        pageNoveltyState:
          createPageNoveltyState(),
        budget
      });

    const decision = await chooseNavigationLink(
      site,
      policyWindow.candidates,
      budget
    );

    if (decision.type === 'finish') {
      console.log('\nAgent decision: FINISH');
      console.log(`Summary: ${decision.summary}`);
      return;
    }

    console.log('\nAgent selected a navigation link:');
    console.log(`Text: ${decision.link.text}`);
    console.log(`URL: ${decision.link.url}`);
    console.log(`Reason: ${decision.reason}`);
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error('Navigation choice check failed:', error);
  process.exitCode = 1;
});
