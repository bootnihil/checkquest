import type {
  DesktopRunEvent
} from './contracts';

export type DesktopUiPhase =
  | 'ready'
  | 'checking-credentials'
  | 'checking-website'
  | 'starting'
  | 'running'
  | 'inspecting'
  | 'navigating'
  | 'analyzing'
  | 'retrying'
  | 'cancelling'
  | 'cancelled'
  | 'completed'
  | 'failed';

export interface DesktopUiState {
  phase:
    DesktopUiPhase;
  label:
    string;
  detail:
    string;
  runActive:
    boolean;
}

export interface DesktopRunButtonPresentation {
  label:
    'Run CheckQuest' |
    'Checking…' |
    'Running…' |
    'Cancelling…';
  busy:
    boolean;
}

export const initialDesktopUiState:
  DesktopUiState = {
    phase:
      'ready',
    label:
      'Ready',
    detail:
      'Configure a run to begin.',
    runActive:
      false
  };

export function createStartingUiState():
  DesktopUiState {
  return {
    phase:
      'starting',
    label:
      'Starting',
    detail:
      'Validating the run and preparing CheckQuest.',
    runActive:
      true
  };
}

export function createCheckingCredentialsUiState():
  DesktopUiState {
  return {
    phase:
      'checking-credentials',
    label:
      'Checking credentials…',
    detail:
      'Confirming access with Gemini before the run starts.',
    runActive:
      true
  };
}

export function createCheckingWebsiteUiState():
  DesktopUiState {
  return {
    phase:
      'checking-website',
    label:
      'Checking website…',
    detail:
      'Confirming the target can be reached before the run starts.',
    runActive:
      true
  };
}

export function createReadyUiState():
  DesktopUiState {
  return {
    ...initialDesktopUiState
  };
}

export function createCancelledUiState():
  DesktopUiState {
  return {
    phase:
      'cancelled',
    label:
      'Cancelled',
    detail:
      'The run was cancelled.',
    runActive:
      false
  };
}

export function createStartRejectedUiState(
  message:
    string
): DesktopUiState {
  return {
    phase:
      'failed',
    label:
      'Failed',
    detail:
      message,
    runActive:
      false
  };
}

export function createCancellingUiState(
  state:
    DesktopUiState
): DesktopUiState {
  if (
    !state.runActive
  ) {
    return state;
  }

  return {
    phase:
      'cancelling',
    label:
      'Cancelling…',
    detail:
      'Stopping current work and cleaning up…',
    runActive:
      true
  };
}

export function getDesktopUiReadinessMessage(
  state:
    DesktopUiState
): string | null {
  switch (
    state.phase
  ) {
    case 'completed':
    case 'cancelled':
      return 'Ready for another run';

    case 'failed':
      return 'Ready to try again';

    default:
      return null;
  }
}

export function getDesktopRunButtonPresentation(
  state:
    DesktopUiState
): DesktopRunButtonPresentation {
  switch (
    state.phase
  ) {
    case 'checking-credentials':
    case 'checking-website':
    case 'starting':
      return {
        label:
          'Checking…',
        busy:
          true
      };

    case 'running':
    case 'inspecting':
    case 'navigating':
    case 'analyzing':
    case 'retrying':
      return {
        label:
          'Running…',
        busy:
          true
      };

    case 'cancelling':
      return {
        label:
          'Cancelling…',
        busy:
          true
      };

    case 'ready':
    case 'cancelled':
    case 'completed':
    case 'failed':
      return {
        label:
          'Run CheckQuest',
        busy:
          false
      };
  }
}

function preserveCancellation(
  state:
    DesktopUiState,
  event:
    DesktopRunEvent
): boolean {
  return (
    state.phase ===
      'cancelling' &&
    event.type !==
      'run-completed' &&
    event.type !==
      'run-failed'
  );
}

export function formatDesktopCompletionSummary(
  inspectedPageCount:
    number,
  confirmedFindingCount:
    number,
  reviewFindingCount:
    number,
  technicalObservationCount:
    number
): string {
  const findingCount =
    confirmedFindingCount +
    reviewFindingCount;

  return `${inspectedPageCount} ${
    inspectedPageCount ===
      1
      ? 'page'
      : 'pages'
  } inspected · ${findingCount} ${
    findingCount ===
      1
      ? 'finding'
      : 'findings'
  } · ${technicalObservationCount} technical ${
    technicalObservationCount ===
      1
      ? 'observation'
      : 'observations'
  }`;
}

export function reduceDesktopUiState(
  state:
    DesktopUiState,
  event:
    DesktopRunEvent
): DesktopUiState {
  if (
    preserveCancellation(
      state,
      event
    )
  ) {
    return state;
  }

  switch (
    event.type
  ) {
    case 'target-preflight-started':
      return createCheckingWebsiteUiState();

    case 'run-started':
      return {
        phase:
          'running',
        label:
          'Running',
        detail:
          `Up to ${event.pageBudget} pages and ${event.navigationBudget} navigation steps.`,
        runActive:
          true
      };

    case 'inspection-started':
      return {
        phase:
          'inspecting',
        label:
          `Inspecting page ${event.pageNumber}`,
        detail:
          'Collecting bounded page observations.',
        runActive:
          true
      };

    case 'navigation-started':
      return {
        phase:
          'navigating',
        label:
          'Navigating',
        detail:
          `Navigation step ${event.navigationStep} of ${event.navigationBudget}.`,
        runActive:
          true
      };

    case 'model-request-started':
      return {
        phase:
          'analyzing',
        label:
          'Analyzing',
        detail:
          `Model operation: ${event.operation}.`,
        runActive:
          true
      };

    case 'model-request-retrying':
      return {
        phase:
          'retrying',
        label:
          'Retrying model request',
        detail:
          `Attempt ${event.attempt} of ${event.maxAttempts}.`,
        runActive:
          true
      };

    case 'run-completed':
      return {
        phase:
          'completed',
        label:
          'Completed',
        detail:
          formatDesktopCompletionSummary(
            event
              .inspectedPageCount,
            event
              .confirmedFindingCount,
            event
              .reviewFindingCount,
            event
              .technicalObservationCount
          ),
        runActive:
          false
      };

    case 'run-failed':
      if (
        event.code ===
          'CANCELLED'
      ) {
        return {
          phase:
            'cancelled',
          label:
            'Cancelled',
          detail:
            'The run stopped safely and browser cleanup completed.',
          runActive:
            false
        };
      }

      return {
        phase:
          'failed',
        label:
          'Failed',
        detail:
          event.message,
        runActive:
          false
      };

    case 'inspection-completed':
    case 'navigation-completed':
    case 'model-request-completed':
    case 'investigation-completed':
      return {
        phase:
          'running',
        label:
          'Running',
        detail:
          event.message,
        runActive:
          true
      };
  }
}
