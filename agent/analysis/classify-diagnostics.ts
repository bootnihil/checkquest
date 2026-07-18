import type {
  FailedRequestObservation,
  PageDiagnostics
} from '../browser/collect-page-diagnostics';

export type DiagnosticDisposition =
  | 'actionable'
  | 'ignored-noise'
  | 'needs-review';

export interface ClassifiedFailedRequest {
  request: FailedRequestObservation;
  disposition: DiagnosticDisposition;
  reason: string;
}

export interface ClassifiedDiagnostics {
  consoleErrors: PageDiagnostics['consoleErrors'];
  failedRequests: ClassifiedFailedRequest[];
}

function isKnownTelemetryNoise(
  request: FailedRequestObservation
): boolean {
  const url = request.url.toLowerCase();

  return (
    url.includes('/cdn-cgi/rum') ||
    url.includes('doubleclick.net') ||
    url.includes('youtube.com/youtubei/v1/log_event') ||
    url.includes('youtube.com/api/stats/')
  );
}

export function classifyDiagnostics(
  diagnostics: PageDiagnostics
): ClassifiedDiagnostics {
  const failedRequests =
    diagnostics.failedRequests.map((request) => {
      if (isKnownTelemetryNoise(request)) {
        return {
          request,
          disposition: 'ignored-noise' as const,
          reason:
            'Known telemetry, analytics, advertising, or embedded-media tracking request.'
        };
      }

      if (
        request.resourceType === 'document' ||
        request.resourceType === 'script' ||
        request.resourceType === 'stylesheet'
      ) {
        return {
          request,
          disposition: 'actionable' as const,
          reason:
            'A failed document, script, or stylesheet request may directly affect page functionality or presentation.'
        };
      }

      return {
        request,
        disposition: 'needs-review' as const,
        reason:
          'The request failed but requires additional context before it can be treated as a user-facing issue.'
      };
    });

  return {
    consoleErrors: diagnostics.consoleErrors,
    failedRequests
  };
}
