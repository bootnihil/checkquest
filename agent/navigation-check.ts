import { chromium } from '@playwright/test';
import { inspectNavigation } from './browser/inspect-navigation';
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

    const currentHost = new URL(page.url()).hostname;

    if (!site.allowedHosts.includes(currentHost)) {
      throw new Error(`Browser reached disallowed host "${currentHost}".`);
    }

    const navigationLinks = await inspectNavigation(page, site.allowedHosts);

    console.log(`Navigation links found: ${navigationLinks.length}`);
    console.log(JSON.stringify(navigationLinks, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error('Navigation check failed:', error);
  process.exitCode = 1;
});
