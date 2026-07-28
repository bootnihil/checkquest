import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import {
  runPageOperationWithCancellation
} from './run-page-operation-with-cancellation';

export interface CapturedScreenshot {
  filePath: string;
}

function formatPageNumber(
  pageNumber: number
): string {
  return String(pageNumber).padStart(2, '0');
}

export async function capturePageScreenshot(
  page: Page,
  runId: string,
  pageNumber: number,
  signal?:
    AbortSignal
): Promise<CapturedScreenshot> {
  const evidenceDirectory = join(
    'agent-results',
    runId,
    'evidence'
  );

  const filePath = join(
    evidenceDirectory,
    `page-${formatPageNumber(pageNumber)}.png`
  );

  await mkdir(
    evidenceDirectory,
    {
      recursive: true
    }
  );

  await runPageOperationWithCancellation(
    page,
    () =>
      page.screenshot({
        path:
          filePath,
        fullPage:
          true
      }),
    {
      signal,
      runId,
      phase:
        'page-screenshot'
    }
  );

  return {
    filePath
  };
}
