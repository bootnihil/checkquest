import { chromium } from '@playwright/test';

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();

    await page.goto('https://www.aidoc.com/', {
      waitUntil: 'domcontentloaded'
    });

    console.log(`Page title: ${await page.title()}`);
    console.log(`Final URL: ${page.url()}`);
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error('Browser check failed:', error);
  process.exitCode = 1;
});
