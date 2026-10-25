import type { JSHandle, Page, Request, Response, Route } from '@playwright/test';

import { CheckQuestError } from '../errors/checkquest-error';
import { completeRequiredCleanup } from '../errors/required-cleanup';
import { normalizeRunCancellation, throwIfRunCancelled } from '../errors/run-cancellation';
import { gotoWithCancellation, type PageNavigationCancellation } from './goto-with-cancellation';

export interface InspectionDocument {
  assertCurrent: () => Promise<void>;
  dispose: () => Promise<void>;
}

export async function openInspectionDocument(
  page: Page,
  url: string,
  options: Parameters<Page['goto']>[1],
  cancellation: PageNavigationCancellation
): Promise<{ response: Response | null; document: InspectionDocument }> {
  let latestRequest: Request | undefined;
  let invalidated = false;
  let documentHandle: JSHandle<Document> | undefined;
  let disposed = false;
  const onRequest = (request: Request): void => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
      latestRequest = request;
    }
  };
  const invalidateDocument = (): void => {
    invalidated = true;
  };
  const routeHandler = async (route: Route): Promise<void> => {
    const request = route.request();
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
      invalidated = true;
      await route.abort('blockedbyclient');
    } else {
      await route.fallback();
    }
  };
  const dispose = async (): Promise<void> => {
    if (disposed) {
      return;
    }
    await completeRequiredCleanup(
      undefined,
      [
        () => {
          page.off('request', onRequest);
          page.off('domcontentloaded', invalidateDocument);
        },
        () => page.unroute('**/*', routeHandler),
        () => documentHandle?.dispose()
      ],
      { phase: 'inspection-document-cleanup', runId: cancellation.runId }
    );
    disposed = true;
  };
  page.on('request', onRequest);
  try {
    const response = await gotoWithCancellation(page, url, options, cancellation);
    const expectedRequest = response?.request();
    // Arm after the expected redirect chain, before reading any observation fields.
    page.on('domcontentloaded', invalidateDocument);
    await page.route('**/*', routeHandler);
    documentHandle = await page.evaluateHandle(() => document);
    const pinnedDocument = documentHandle;
    const assertCurrent = async (): Promise<void> => {
      try {
        throwIfRunCancelled(cancellation.signal, cancellation.runId, 'inspection-document');
        if (
          invalidated ||
          latestRequest !== expectedRequest ||
          !(await pinnedDocument.evaluate(node => node === document))
        ) {
          throw new Error('The main-frame document changed during inspection.');
        }
        // A request/event may have arrived while the identity check was in flight.
        if (invalidated || latestRequest !== expectedRequest) {
          throw new Error('The main-frame document changed during inspection.');
        }
        throwIfRunCancelled(cancellation.signal, cancellation.runId, 'inspection-document');
      } catch (error) {
        throw normalizeRunCancellation(
          new CheckQuestError('BROWSER', 'The inspected document is no longer current.', {
            phase: 'inspection-document',
            runId: cancellation.runId,
            cause: error
          }),
          cancellation.signal,
          cancellation.runId,
          'inspection-document'
        );
      }
    };
    await assertCurrent();
    return { response, document: { assertCurrent, dispose } };
  } catch (error) {
    const primaryError =
      error instanceof Error ? error : new Error('Document setup failed.', { cause: error });
    await completeRequiredCleanup(primaryError, [dispose], {
      phase: 'inspection-document-cleanup',
      runId: cancellation.runId
    });
    throw primaryError;
  }
}
