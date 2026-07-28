import {
  validateDesktopStartRunInput,
  type CheckQuestDesktopApi,
  type DesktopRunFieldErrors,
  type DesktopStartRunInput
} from '../contracts';
import {
  createCancelledUiState,
  createCheckingCredentialsUiState,
  createCheckingWebsiteUiState,
  createReadyUiState,
  createStartRejectedUiState,
  type DesktopUiState
} from '../ui-state';

export type DesktopFormSubmissionResult =
  | {
      outcome:
        'started';
    }
  | {
      outcome:
        'field-errors';
      fieldErrors:
        DesktopRunFieldErrors;
      state:
        DesktopUiState;
    }
  | {
      outcome:
        'cancelled';
      state:
        DesktopUiState;
    }
  | {
      outcome:
        'failed';
      state:
        DesktopUiState;
    };

export interface SubmitDesktopRunOptions {
  request:
    DesktopStartRunInput;
  startRun:
    CheckQuestDesktopApi[
      'startRun'
    ];
  onPreflightStarted:
    (
      state:
        DesktopUiState
    ) => void;
  sessionCredentialAvailable?:
    boolean;
}

export async function submitDesktopRun(
  options:
    SubmitDesktopRunOptions
): Promise<
  DesktopFormSubmissionResult
> {
  const validation =
    validateDesktopStartRunInput(
      options.request,
      {
        sessionCredentialAvailable:
          options
            .sessionCredentialAvailable
      }
    );

  if (
    !validation.success
  ) {
    options.request
      .geminiApiKey =
        '';

    return {
      outcome:
        'field-errors',
      fieldErrors:
        validation.fieldErrors,
      state:
        createReadyUiState()
    };
  }

  const input =
    validation.input;

  options.onPreflightStarted(
    input.geminiApiKey ===
      undefined
      ? createCheckingWebsiteUiState()
      : createCheckingCredentialsUiState()
  );

  try {
    const reply =
      await options.startRun(
        input
      );

    if (
      reply.accepted
    ) {
      return {
        outcome:
          'started'
      };
    }

    if (
      reply.fieldErrors !==
        undefined &&
      Object.keys(
        reply.fieldErrors
      ).length >
        0
    ) {
      return {
        outcome:
          'field-errors',
        fieldErrors:
          reply.fieldErrors,
        state:
          createReadyUiState()
      };
    }

    if (
      reply.reason ===
        'cancelled'
    ) {
      return {
        outcome:
          'cancelled',
        state:
          createCancelledUiState()
      };
    }

    return {
      outcome:
        'failed',
      state:
        createStartRejectedUiState(
          reply.message
        )
    };
  } catch {
    return {
      outcome:
        'failed',
      state:
        createStartRejectedUiState(
          'The desktop application could not start the run.'
        )
    };
  } finally {
    options.request
      .geminiApiKey =
        '';
    if (
      input.geminiApiKey !==
        undefined
    ) {
      input.geminiApiKey =
        '';
    }
  }
}
