import { chromium } from '@playwright/test';
import { collectPageDiagnostics } from './browser/collect-page-diagnostics';

async function main(): Promise<void> {
  const browser = await chromium.launch({
    headless: true
  });

  try {
    const page = await browser.newPage();

    const diagnostics = collectPageDiagnostics(page);

    const blockedAssetUrl =
      'https://example.com/synthetic-failed-image.png';

    await page.route(
      blockedAssetUrl,
      async (route) => {
        await route.abort('failed');
      }
    );

    const failedRequestPromise = page.waitForEvent(
      'requestfailed',
      {
        predicate: (request) =>
          request.url() === blockedAssetUrl
      }
    );

    await page.setContent(`
      <!doctype html>
      <html lang="en">
        <head>
          <title>Diagnostics Test Page</title>
        </head>
        <body>
          <h1>Diagnostics Test</h1>
          <img
            src="${blockedAssetUrl}"
            alt="Synthetic failed resource"
          >
        </body>
      </html>
    `);

    await failedRequestPromise;

    await page.evaluate(() => {
      console.error(
        'Synthetic console error for diagnostics testing'
      );
    });

    const firstSnapshot = diagnostics.snapshot();

    console.log('Collected diagnostics:');
    console.log(
      JSON.stringify(firstSnapshot, null, 2)
    );

    console.log('\nCollected counts:');
    console.log(
      `Console errors: ${firstSnapshot.consoleErrors.length}`
    );
    console.log(
      `Failed requests: ${firstSnapshot.failedRequests.length}`
    );

    diagnostics.reset();

    const resetSnapshot = diagnostics.snapshot();

    console.log('\nAfter reset:');
    console.log(
      `Console errors: ${resetSnapshot.consoleErrors.length}`
    );
    console.log(
      `Failed requests: ${resetSnapshot.failedRequests.length}`
    );

    diagnostics.dispose();
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(
    'Page diagnostics check failed:',
    error
  );

  process.exitCode = 1;
});
