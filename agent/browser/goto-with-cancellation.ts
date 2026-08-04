import type { Page, Response } from '@playwright/test';

import {
  runPageOperationWithCancellation,
  type PageOperationCancellation
} from './run-page-operation-with-cancellation';

export type PageNavigationCancellation = PageOperationCancellation;

export async function gotoWithCancellation(
  page: Pick<Page, 'close' | 'goto'>,
  url: string,
  options: Parameters<Page['goto']>[1],
  cancellation: PageNavigationCancellation
): Promise<Response | null> {
  return runPageOperationWithCancellation(page, () => page.goto(url, options), cancellation);
}
