import { chromium } from '@playwright/test';

import { extractPageContent } from './browser/extract-page-content';

async function main(): Promise<void> {
  const browser = await chromium.launch({
    headless: true
  });

  const page = await browser.newPage();

  try {
    await page.setContent(`
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <title>Synthetic Product Page</title>
        </head>

        <body>
          <nav>
            <a href="https://example.com/">Home</a>
            <a href="https://example.com/products">Products</a>
          </nav>

          <main>
            <h1>Clinical AI Platform</h1>

            <p>
              Our platform helps clinical teams coordinate workflows
              across multiple specialties.
            </p>

            <h2>Built for Enterprise Healthcare</h2>

            <p>
              Deploy AI at scale while maintaining governance and
              operational visibility.
            </p>

            <h2>Contact Us</h2>

            <label for="email">Work Email</label>
            <input
              id="email"
              name="email"
              type="email"
              placeholder="Enter your work email"
              required
            />

            <label for="country">Country</label>
            <select id="country" name="country">
              <option value="">Please Select</option>
              <option value="Ecuador">Ecuador</option>
              <option value="Egypt">Egypt</option>
              <option value="Zimbabwe">Zimbabwe</option>
              <option value="Equador">Equador</option>
            </select>

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

    /*
     * Put the field into a deliberately invalid local state.
     *
     * This does not submit anything. It simply gives the extractor a
     * realistic browser-validation state to observe.
     */
    const emailField = page.locator('#email');

    await emailField.fill('not-an-email');
    await emailField.blur();

    const content = await extractPageContent(page);

    console.log('Extracted page content:');
    console.log(JSON.stringify(content, null, 2));

    if (content.title !== 'Synthetic Product Page') {
      throw new Error(`Unexpected title: "${content.title}".`);
    }

    if (content.headings.length !== 3) {
      throw new Error(`Expected 3 headings, found ${content.headings.length}.`);
    }

    if (content.links.length !== 3) {
      throw new Error(`Expected 3 links, found ${content.links.length}.`);
    }

    if (content.buttons.length !== 1) {
      throw new Error(`Expected 1 button, found ${content.buttons.length}.`);
    }

    if (content.textFields.length !== 1) {
      throw new Error(`Expected 1 text field, found ${content.textFields.length}.`);
    }

    const email = content.textFields[0];

    if (email.label !== 'Work Email') {
      throw new Error(`Expected email label "Work Email", received "${email.label}".`);
    }

    if (email.name !== 'email') {
      throw new Error(`Expected email name "email", received "${email.name}".`);
    }

    if (email.id !== 'email') {
      throw new Error(`Expected email id "email", received "${email.id}".`);
    }

    if (email.placeholder !== 'Enter your work email') {
      throw new Error(`Unexpected email placeholder: "${email.placeholder}".`);
    }

    if (email.inputType !== 'email') {
      throw new Error(`Expected input type "email", received "${email.inputType}".`);
    }

    if (!email.required) {
      throw new Error('Expected email field to be required.');
    }

    if (email.disabled) {
      throw new Error('Expected email field to be enabled.');
    }

    if (email.readOnly) {
      throw new Error('Expected email field to be editable.');
    }

    if (email.value !== 'not-an-email') {
      throw new Error(`Expected local email value "not-an-email", received "${email.value}".`);
    }

    if (email.valid) {
      throw new Error('Expected malformed email value to be browser-invalid.');
    }

    if (email.validationMessage === null) {
      throw new Error('Expected browser-native validation message for malformed email.');
    }

    if (content.selects.length !== 1) {
      throw new Error(`Expected 1 select control, found ${content.selects.length}.`);
    }

    const country = content.selects[0];

    if (country.label !== 'Country') {
      throw new Error(`Expected country label "Country", received "${country.label}".`);
    }

    const hasEcuador = country.options.some(option => option.text === 'Ecuador');

    const hasEquador = country.options.some(option => option.text === 'Equador');

    if (!hasEcuador) {
      throw new Error('Expected Country options to contain "Ecuador".');
    }

    if (!hasEquador) {
      throw new Error('Expected Country options to contain "Equador".');
    }

    console.log('\nSummary:');
    console.log(`Title: ${content.title}`);
    console.log(`Headings: ${content.headings.length}`);
    console.log(`Links: ${content.links.length}`);
    console.log(`Buttons: ${content.buttons.length}`);
    console.log(`Text fields: ${content.textFields.length}`);
    console.log(`Email label: ${email.label}`);
    console.log(`Email type: ${email.inputType}`);
    console.log(`Email value: ${email.value}`);
    console.log(`Email valid: ${email.valid}`);
    console.log(`Email validation message: ${email.validationMessage}`);
    console.log(`Select controls: ${content.selects.length}`);
    console.log(`Country label: ${country.label}`);
    console.log(`Country options: ${country.options.length}`);
    console.log(`Has Ecuador: ${hasEcuador}`);
    console.log(`Has Equador: ${hasEquador}`);

    console.log('\nAll structured page content extraction checks passed.');
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error('Page content extraction check failed:', error);

  process.exitCode = 1;
});
