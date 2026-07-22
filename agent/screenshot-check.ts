import { chromium } from '@playwright/test';
import { access } from 'node:fs/promises';
import { capturePageScreenshot } from './browser/capture-page-screenshot';

async function main(): Promise<void> {
  const browser = await chromium.launch({
    headless: true
  });

  try {
    const page = await browser.newPage();

    await page.setContent(`
      <!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8">
          <title>Screenshot Evidence Test</title>
        </head>
        <body>
          <h1>Screenshot Evidence Test</h1>
          <p>
            This page exists only to verify that
            CheckQuest can save screenshot evidence.
          </p>
        </body>
      </html>
    `);

    const runId = 'screenshot-check';

    const screenshot =
      await capturePageScreenshot(
        page,
        runId,
        1
      );

    await access(screenshot.filePath);

    console.log('Screenshot captured successfully.');
    console.log(
      `File: ${screenshot.filePath}`
    );
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(
    'Screenshot check failed:',
    error
  );

  process.exitCode = 1;
});
