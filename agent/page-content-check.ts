import { chromium } from '@playwright/test';
import { extractPageContent } from './browser/extract-page-content';

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
          <title>Synthetic Product Page</title>
        </head>

        <body>
          <header>
            <a href="https://example.com/">Home</a>
            <a href="https://example.com/products">Products</a>
          </header>

          <main>
            <h1>Clinical AI Platform</h1>

            <p>
              Our platform helps clinical teams coordinate
              workflows across multiple specialties.
            </p>

            <h2>Built for Enterprise Healthcare</h2>

            <p>
              Deploy AI at scale while maintaining governance
              and operational visibility.
            </p>

            <h3>Learn More</h3>

            <a href="https://example.com/platform">
              Explore the platform
            </a>

            <button type="button">
              Request a Demo
            </button>
          </main>
        </body>
      </html>
    `);

    const content =
      await extractPageContent(page);

    console.log('Extracted page content:');
    console.log(
      JSON.stringify(
        content,
        null,
        2
      )
    );

    console.log('\nSummary:');
    console.log(
      `Title: ${content.title}`
    );
    console.log(
      `Headings: ${content.headings.length}`
    );
    console.log(
      `Links: ${content.links.length}`
    );
    console.log(
      `Buttons: ${content.buttons.length}`
    );
    console.log(
      `Body text length: ${content.bodyText.length}`
    );
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(
    'Page content extraction check failed:',
    error
  );

  process.exitCode = 1;
});
