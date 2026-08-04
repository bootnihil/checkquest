import { chromium, type Page } from '@playwright/test';

import type { AgentAction } from '../../agent/actions/agent-action-schema';
import { executeAgentAction } from '../../agent/browser/execute-agent-action';

async function expectRejected(name: string, operation: () => Promise<unknown>): Promise<void> {
  try {
    await operation();
    throw new Error(`${name}: expected the action to be rejected.`);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === `${name}: expected the action to be rejected.`
    ) {
      throw error;
    }

    console.log(`✓ REJECTED: ${name}`);

    if (error instanceof Error) {
      console.log(`  ${error.message}`);
    }
  }
}

async function execute(page: Page, name: string, action: AgentAction): Promise<void> {
  const result = await executeAgentAction(page, action);

  console.log(`✓ EXECUTED: ${name}`);
  console.log(`  ${result.detail}`);
}

async function main(): Promise<void> {
  console.log('Checking deterministic agent action executor...\n');

  const browser = await chromium.launch({
    headless: true
  });

  const page = await browser.newPage({
    viewport: {
      width: 1280,
      height: 720
    }
  });

  try {
    await page.setContent(`
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <title>Agent Action Executor Check</title>
        </head>

        <body>
          <main>
            <h1>Safe Interaction Test Page</h1>

            <label for="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              placeholder="Enter your email"
            />

            <label for="country">Country</label>
            <select id="country" name="country">
              <option value="">Please Select</option>
              <option value="ecuador">Ecuador</option>
              <option value="egypt">Egypt</option>
            </select>

            <label for="terms">
              <input
                id="terms"
                name="terms"
                type="checkbox"
              />
              Accept terms
            </label>

            <div style="height: 4000px;">
              Scrollable page content
            </div>
          </main>
        </body>
      </html>
    `);

    await execute(page, 'Fill text field', {
      kind: 'fill-text-field',
      target: {
        label: 'Email',
        name: 'email',
        id: 'email',
        placeholder: 'Enter your email'
      },
      value: 'not-an-email'
    });

    const filledValue = await page.locator('#email').inputValue();

    if (filledValue !== 'not-an-email') {
      throw new Error(`Fill check failed. Expected "not-an-email", received "${filledValue}".`);
    }

    await page.locator('#email').focus();

    await execute(page, 'Blur field', {
      kind: 'blur-field',
      target: {
        label: 'Email',
        name: 'email',
        id: 'email',
        placeholder: 'Enter your email'
      }
    });

    const activeElementId = await page.evaluate(() => document.activeElement?.id ?? null);

    if (activeElementId === 'email') {
      throw new Error('Blur check failed: Email field still has focus.');
    }

    await execute(page, 'Clear text field', {
      kind: 'clear-field',
      target: {
        label: 'Email',
        name: 'email',
        id: 'email',
        placeholder: 'Enter your email'
      }
    });

    const clearedValue = await page.locator('#email').inputValue();

    if (clearedValue !== '') {
      throw new Error(`Clear check failed. Expected empty value, received "${clearedValue}".`);
    }

    await execute(page, 'Select option', {
      kind: 'select-option',
      target: {
        label: 'Country',
        name: 'country',
        id: 'country',
        placeholder: null
      },
      optionText: 'Ecuador'
    });

    const selectedCountry = await page.locator('#country').inputValue();

    if (selectedCountry !== 'ecuador') {
      throw new Error(`Select check failed. Expected "ecuador", received "${selectedCountry}".`);
    }

    await page.evaluate(() => window.scrollTo(0, 0));

    await execute(page, 'Scroll down', {
      kind: 'scroll',
      direction: 'down',
      viewportCount: 2
    });

    const scrollY = await page.evaluate(() => window.scrollY);

    if (scrollY <= 0) {
      throw new Error(`Scroll check failed. Expected scrollY greater than 0, received ${scrollY}.`);
    }

    await execute(page, 'Stop exploration', {
      kind: 'stop',
      reason: 'Synthetic executor check completed.'
    });

    await expectRejected('Fill unsupported checkbox control', async () => {
      await executeAgentAction(page, {
        kind: 'fill-text-field',
        target: {
          label: 'Accept terms',
          name: 'terms',
          id: 'terms',
          placeholder: null
        },
        value: 'unsafe'
      });
    });

    await expectRejected('Select nonexistent option', async () => {
      await executeAgentAction(page, {
        kind: 'select-option',
        target: {
          label: 'Country',
          name: 'country',
          id: 'country',
          placeholder: null
        },
        optionText: 'Atlantis'
      });
    });

    console.log('\nAll deterministic agent action executor checks passed.');
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error('\nAgent action executor check failed.');

  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exitCode = 1;
});
