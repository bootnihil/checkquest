import { chromium } from '@playwright/test';
import { access } from 'node:fs/promises';
import { captureSelectOptionEvidence } from './browser/capture-select-option-evidence';

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
          <title>Targeted Evidence Test</title>
        </head>

        <body>
          <h1>Contact Form</h1>

          <label for="country">
            Country
          </label>

          <select
            id="country"
            name="country"
          >
            <option value="">
              Please Select
            </option>

            <option value="Ecuador">
              Ecuador
            </option>

            <option value="Egypt">
              Egypt
            </option>

            <option value="Zimbabwe">
              Zimbabwe
            </option>

            <option value="Equador">
              Equador
            </option>
          </select>
        </body>
      </html>
    `);

    const evidence = await captureSelectOptionEvidence(page, 'targeted-evidence-check', 1, 1, {
      kind: 'select-option',
      controlLabel: 'Country',
      controlName: 'country',
      controlId: 'country',
      optionText: 'Equador'
    });

    await access(evidence.filePath);

    const selectedValue = await page.locator('#country').inputValue();

    console.log('Targeted evidence captured successfully.');

    console.log(`Selected value: ${selectedValue}`);

    console.log(`Locator strategy: ${evidence.locatorStrategy}`);

    console.log(`Screenshot: ${evidence.filePath}`);
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error('Targeted evidence check failed:', error);

  process.exitCode = 1;
});
