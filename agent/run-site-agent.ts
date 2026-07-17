import { chromium } from '@playwright/test';
import { inspectNavigation } from './browser/inspect-navigation';
import { visitApprovedLink } from './browser/visit-approved-link';
import { chooseNavigationLink } from './decisions/choose-navigation-link';
import { getSiteConfig } from './sites';

async function main(): Promise<void> {
  const siteId = process.argv[2] ?? 'aidoc';
  const site = getSiteConfig(siteId);

  const configuredStartUrl = new URL(site.startUrl);

  if (!site.allowedHosts.includes(configuredStartUrl.hostname)) {
    throw new Error(
      `Configured start host "${configuredStartUrl.hostname}" is not allowed.`
    );
  }

  console.log(`Selected site: ${site.name}`);
  console.log(`Start URL: ${site.startUrl}`);

  const browser = await chromium.launch({ headless: true });

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

    console.log('\nHomepage opened:');
    console.log(`HTTP status: ${homepageResponse?.status() ?? 'unknown'}`);
    console.log(`Final URL: ${homepageFinalUrl.toString()}`);
    console.log(`Title: ${await page.title()}`);

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
    console.log(JSON.stringify(pageObservation, null, 2));

    console.log('\nAgent run complete.');
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error('Site agent run failed:', error);
  process.exitCode = 1;
});
