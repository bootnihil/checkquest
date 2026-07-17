import type {
  ConsoleMessage,
  Page,
  Request
} from '@playwright/test';

const MAX_CONSOLE_ERRORS = 50;
const MAX_FAILED_REQUESTS = 100;

export interface ConsoleErrorObservation {
  text: string;
  sourceUrl: string | null;
  lineNumber: number | null;
  columnNumber: number | null;
}

export interface FailedRequestObservation {
  url: string;
  method: string;
  resourceType: string;
  failureText: string;
}

export interface PageDiagnostics {
  consoleErrors: ConsoleErrorObservation[];
  failedRequests: FailedRequestObservation[];
}

export interface PageDiagnosticsCollector {
  reset(): void;
  snapshot(): PageDiagnostics;
  dispose(): void;
}

function normalizeText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1_000);
}

function isDuplicateFailedResourceMessage(
  consoleError: ConsoleErrorObservation,
  failedRequests: FailedRequestObservation[]
): boolean {
  if (
    consoleError.sourceUrl === null ||
    !consoleError.text.startsWith(
      'Failed to load resource:'
    )
  ) {
    return false;
  }

  return failedRequests.some(
    (failedRequest) =>
      failedRequest.url === consoleError.sourceUrl
  );
}

export function collectPageDiagnostics(
  page: Page
): PageDiagnosticsCollector {
  let consoleErrors: ConsoleErrorObservation[] = [];
  let failedRequests: FailedRequestObservation[] = [];

  const consoleErrorKeys = new Set<string>();
  const failedRequestKeys = new Set<string>();

  const handleConsoleMessage = (
    message: ConsoleMessage
  ): void => {
    if (message.type() !== 'error') {
      return;
    }

    if (consoleErrors.length >= MAX_CONSOLE_ERRORS) {
      return;
    }

    const location = message.location();

    const observation: ConsoleErrorObservation = {
      text: normalizeText(message.text()),
      sourceUrl: location.url || null,
      lineNumber: location.lineNumber ?? null,
      columnNumber: location.columnNumber ?? null
    };

    const key = JSON.stringify(observation);

    if (consoleErrorKeys.has(key)) {
      return;
    }

    consoleErrorKeys.add(key);
    consoleErrors.push(observation);
  };

  const handleFailedRequest = (
    request: Request
  ): void => {
    if (failedRequests.length >= MAX_FAILED_REQUESTS) {
      return;
    }

    const observation: FailedRequestObservation = {
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      failureText:
        request.failure()?.errorText ??
        'Unknown request failure'
    };

    const key = JSON.stringify(observation);

    if (failedRequestKeys.has(key)) {
      return;
    }

    failedRequestKeys.add(key);
    failedRequests.push(observation);
  };

  page.on('console', handleConsoleMessage);
  page.on('requestfailed', handleFailedRequest);

  return {
    reset(): void {
      consoleErrors = [];
      failedRequests = [];

      consoleErrorKeys.clear();
      failedRequestKeys.clear();
    },

    snapshot(): PageDiagnostics {
      const filteredConsoleErrors =
        consoleErrors.filter(
          (consoleError) =>
            !isDuplicateFailedResourceMessage(
              consoleError,
              failedRequests
            )
        );

      return {
        consoleErrors: [...filteredConsoleErrors],
        failedRequests: [...failedRequests]
      };
    },

    dispose(): void {
      page.off('console', handleConsoleMessage);
      page.off('requestfailed', handleFailedRequest);
    }
  };
}
