import { chromium } from '@playwright/test';
import { inspectNavigation } from '../../agent/browser/inspect-navigation';
import { visitApprovedLink } from '../../agent/browser/visit-approved-link';
import { getSiteConfig } from '../../agent/sites';

async function main(): Promise<void> {
  const siteId = process.argv[2] ?? 'aidoc';
  const requestedIndex = Number.parseInt(process.argv[3] ?? '1', 10);

  if (!Number.isInteger(requestedIndex) || requestedIndex < 0) {
    throw new Error(`Link index must be a non-negative integer. Received: "${process.argv[3]}".`);
  }

  const site = getSiteConfig(siteId);

  console.log(`Selected site: ${site.name}`);

  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();

    await page.goto(site.startUrl, {
      waitUntil: 'domcontentloaded'
    });

    const navigationLinks = await inspectNavigation(page, site.allowedHosts);

    const selectedLink = navigationLinks[requestedIndex];

    if (!selectedLink) {
      throw new Error(
        `Link index ${requestedIndex} is unavailable. Found ${navigationLinks.length} safe links.`
      );
    }

    console.log('\nApproved link selected:');
    console.log(`Index: ${requestedIndex}`);
    console.log(`Text: ${selectedLink.text}`);
    console.log(`URL: ${selectedLink.url}`);

    const observation = await visitApprovedLink(page, selectedLink, site.allowedHosts);

    console.log('\nVisited page observation:');
    console.log(JSON.stringify(observation, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error('Navigation visit check failed:', error);
  process.exitCode = 1;
});
