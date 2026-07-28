import assert from 'node:assert/strict';

import type {
  Page
} from '@playwright/test';

import {
  runGeminiRequest
} from './ai/run-gemini-request';
import {
  gotoWithCancellation
} from './browser/goto-with-cancellation';
import {
  runPageOperationWithCancellation
} from './browser/run-page-operation-with-cancellation';
import {
  CheckQuestError
} from './errors/checkquest-error';
import {
  waitForRunDelay
} from './errors/run-cancellation';

async function main():
  Promise<void> {
  const navigationAbortController =
    new AbortController();
  let rejectNavigation:
    (
      reason:
        unknown
    ) => void =
      () => undefined;
  let closeCount =
    0;
  const page = {
    goto:
      () =>
        new Promise(
          (
            _resolve,
            reject
          ) => {
            rejectNavigation =
              reject;
          }
        ),
    close:
      async () => {
        closeCount +=
          1;
        rejectNavigation(
          new Error(
            'Synthetic navigation interrupted by page closure.'
          )
        );
      }
  } as unknown as
    Pick<
      Page,
      | 'close'
      | 'goto'
    >;
  const navigation =
    gotoWithCancellation(
      page,
      'https://example.com/',
      {
        waitUntil:
          'domcontentloaded',
        timeout:
          30_000
      },
      {
        signal:
          navigationAbortController
            .signal,
        runId:
          'cancellation-check',
        phase:
          'start-page-navigation'
      }
    );

  navigationAbortController
    .abort();
  navigationAbortController
    .abort();

  await assert.rejects(
    navigation,
    error =>
      error instanceof
        CheckQuestError &&
      error.code ===
        'CANCELLED' &&
      error.phase ===
        'start-page-navigation'
  );
  assert.equal(
    closeCount,
    1
  );

  const screenshotAbortController =
    new AbortController();
  let rejectScreenshot:
    (
      reason:
        unknown
    ) => void =
      () => undefined;
  let screenshotPageCloseCount =
    0;
  const screenshotPage = {
    close:
      async () => {
        screenshotPageCloseCount +=
          1;
        rejectScreenshot(
          new Error(
            'Synthetic screenshot interrupted by page closure.'
          )
        );
      }
  } as unknown as
    Pick<
      Page,
      'close'
    >;
  const screenshot =
    runPageOperationWithCancellation(
      screenshotPage,
      () =>
        new Promise<Buffer>(
          (
            _resolve,
            reject
          ) => {
            rejectScreenshot =
              reject;
          }
        ),
      {
        signal:
          screenshotAbortController
            .signal,
        runId:
          'cancellation-check',
        phase:
          'page-screenshot'
      }
    );

  screenshotAbortController
    .abort();
  screenshotAbortController
    .abort();

  await assert.rejects(
    screenshot,
    error =>
      error instanceof
        CheckQuestError &&
      error.code ===
        'CANCELLED' &&
      error.phase ===
        'page-screenshot'
  );
  assert.equal(
    screenshotPageCloseCount,
    1
  );

  const delayAbortController =
    new AbortController();
  const delay =
    waitForRunDelay(
      60_000,
      delayAbortController
        .signal,
      'cancellation-check',
      'page-observation-settle'
    );

  delayAbortController.abort();

  await assert.rejects(
    delay,
    error =>
      error instanceof
        CheckQuestError &&
      error.code ===
        'CANCELLED'
  );

  const geminiAbortController =
    new AbortController();
  let receivedSignal:
    AbortSignal | undefined;
  const modelRequest =
    runGeminiRequest(
      'cancellation check',
      options => {
        receivedSignal =
          options.abortSignal;

        return new Promise(
          (
            _resolve,
            reject
          ) => {
            options.abortSignal
              ?.addEventListener(
                'abort',
                () => {
                  reject(
                    new Error(
                      'Synthetic Gemini request aborted.'
                    )
                  );
                },
                {
                  once:
                    true
                }
              );
          }
        );
      },
      {
        signal:
          geminiAbortController
            .signal
      }
    );

  assert.equal(
    receivedSignal,
    geminiAbortController
      .signal
  );

  geminiAbortController.abort();

  await assert.rejects(
    modelRequest,
    error =>
      error instanceof
        CheckQuestError &&
      error.code ===
        'CANCELLED' &&
      error.phase ===
        'gemini-request'
  );

  console.log(
    'Cancellation propagation checks passed.'
  );
}

void main();
