import type {
  RunEvent
} from '../run/run-event';

/**
 * Human terminal presentation for the reusable run event stream.
 */
export function renderRunEvent(
  event:
    RunEvent
): void {
  switch (
    event.type
  ) {
    case 'run-started':
      console.log(
        `Run ${event.runId} started: ${event.startUrl}`
      );
      return;

    case 'inspection-started':
      console.log(
        `Inspecting page ${event.pageNumber}: ${event.url}`
      );
      return;

    case 'inspection-completed':
      console.log(
        `Page ${event.pageNumber} inspected (${event.findingCount} findings, ${event.diagnosticCount} diagnostics).`
      );
      return;

    case 'navigation-started':
      console.log(
        `Navigation ${event.navigationStep}/${event.navigationBudget}: ${event.requestedUrl}`
      );
      return;

    case 'navigation-completed':
      if (
        event.outcome ===
        'duplicate-final-url'
      ) {
        console.log(
          `Navigation resolved to an already-inspected page: ${event.finalUrl}`
        );
      }
      return;

    case 'model-request-started':
      console.log(
        `Model: ${event.operation} (attempt ${event.attempt}/${event.maxAttempts}).`
      );
      return;

    case 'model-request-retrying':
      console.warn(
        `Model request retrying in approximately ${Math.ceil(
          event.retryDelayMs /
          1_000
        )} seconds${
          event.statusCode ===
          null
            ? ''
            : ` (status ${event.statusCode})`
        }.`
      );
      return;

    case 'model-request-completed':
      return;

    case 'investigation-completed':
      console.log(
        `Candidate ${event.candidateReference}: ${event.status} after ${event.stepsUsed} planner step(s).`
      );
      return;

    case 'run-completed':
      console.log(
        `Run completed: ${event.inspectedPageCount} page(s), ${event.findingCount} finding(s), ${event.occurrenceCount} occurrence(s).`
      );
      return;

    case 'run-failed':
      /*
       * The CLI catch boundary owns the categorized final error so a failed
       * run is printed exactly once.
       */
      return;
  }
}
