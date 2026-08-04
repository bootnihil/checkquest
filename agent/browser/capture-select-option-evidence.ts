import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import type { SelectOptionEvidenceTarget } from '../analysis/exploratory-qa-schema';

export interface CapturedSelectOptionEvidence {
  filePath: string;
  optionText: string;
  locatorStrategy: string;
}

function formatNumber(value: number): string {
  return String(value).padStart(2, '0');
}

async function findSelectByAttribute(
  page: Page,
  attributeName: 'id' | 'name',
  expectedValue: string
): Promise<Locator | null> {
  const selects = page.locator('select');

  const matchingIndexes = await selects.evaluateAll(
    (elements, input) => {
      return elements
        .map((element, index) => {
          return {
            index,
            value: element.getAttribute(input.attributeName)
          };
        })
        .filter(item => item.value === input.expectedValue)
        .map(item => item.index);
    },
    {
      attributeName,
      expectedValue
    }
  );

  if (matchingIndexes.length !== 1) {
    return null;
  }

  return selects.nth(matchingIndexes[0]);
}

async function findSelect(
  page: Page,
  target: SelectOptionEvidenceTarget
): Promise<{
  locator: Locator;
  strategy: string;
}> {
  if (target.controlId) {
    const locator = await findSelectByAttribute(page, 'id', target.controlId);

    if (locator) {
      return {
        locator,
        strategy: `id:${target.controlId}`
      };
    }
  }

  if (target.controlName) {
    const locator = await findSelectByAttribute(page, 'name', target.controlName);

    if (locator) {
      return {
        locator,
        strategy: `name:${target.controlName}`
      };
    }
  }

  if (target.controlLabel) {
    const locator = page.getByLabel(target.controlLabel, {
      exact: true
    });

    if ((await locator.count()) === 1) {
      const tagName = await locator.evaluate(element => element.tagName.toLowerCase());

      if (tagName === 'select') {
        return {
          locator,
          strategy: `label:${target.controlLabel}`
        };
      }
    }
  }

  throw new Error(
    `Could not uniquely locate the select control for option "${target.optionText}".`
  );
}

export async function captureSelectOptionEvidence(
  page: Page,
  runId: string,
  pageNumber: number,
  findingNumber: number,
  target: SelectOptionEvidenceTarget
): Promise<CapturedSelectOptionEvidence> {
  const { locator: select, strategy } = await findSelect(page, target);

  const optionTexts = await select.locator('option').allTextContents();

  const exactMatches = optionTexts.filter(
    text => text.replace(/\s+/g, ' ').trim() === target.optionText
  );

  if (exactMatches.length === 0) {
    throw new Error(
      `The targeted option "${target.optionText}" was not found in the selected control.`
    );
  }

  /*
   * Selecting an option changes only local browser
   * state. It does not submit the form or send it.
   */
  await select.selectOption({
    label: target.optionText
  });

  await select.scrollIntoViewIfNeeded();

  const evidenceDirectory = join('agent-results', runId, 'evidence');

  const filePath = join(
    evidenceDirectory,
    `page-${formatNumber(pageNumber)}-finding-${formatNumber(findingNumber)}.png`
  );

  await mkdir(evidenceDirectory, {
    recursive: true
  });

  /*
   * Capture the select after the offending option
   * has been selected.
   */
  await select.screenshot({
    path: filePath
  });

  return {
    filePath,
    optionText: target.optionText,
    locatorStrategy: strategy
  };
}
