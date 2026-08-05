import {
  preflightDesktopGeminiCredentials,
  type DesktopGeminiCredentialPreflightResult,
  type PreflightDesktopGeminiCredentialsInput
} from './preflight-gemini-credentials';
import {
  preflightDesktopTargetReachability,
  type DesktopTargetReachabilityPreflightResult,
  type PreflightDesktopTargetReachabilityInput
} from './preflight-target-reachability';
import {
  startCheckQuest,
  type CheckQuestRun,
  type StartCheckQuestInput
} from '../agent/application/start-checkquest';
import { type DesktopCancelRunReply, type DesktopStartRunReply } from './ipc-contract';
import { projectApplicationRunEvent, type DesktopRunEvent } from './run-event-contract';
import { DesktopSessionCredentialStore } from './session-credential';
import { validateDesktopStartRunInput, type DesktopStartRunInput } from './start-run-contract';

export type StartCheckQuestFunction = (input: StartCheckQuestInput) => CheckQuestRun;

export type PreflightDesktopGeminiCredentialsFunction = (
  input: PreflightDesktopGeminiCredentialsInput
) => Promise<DesktopGeminiCredentialPreflightResult>;

export type PreflightDesktopTargetReachabilityFunction = (
  input: PreflightDesktopTargetReachabilityInput
) => Promise<DesktopTargetReachabilityPreflightResult>;

export interface DesktopRunControllerOptions {
  emitEvent: (event: DesktopRunEvent) => void;
  start?: StartCheckQuestFunction;
  preflight?: PreflightDesktopGeminiCredentialsFunction;
  targetPreflight?: PreflightDesktopTargetReachabilityFunction;
  sessionCredentials?: DesktopSessionCredentialStore;
}

interface ActiveDesktopOperation {
  cancel: () => void;
  cancellationRequested: boolean;
  settled: Promise<void>;
}

function createCancelledStartReply(): DesktopStartRunReply {
  return {
    accepted: false,
    reason: 'cancelled',
    message: 'The run was cancelled before it started.'
  };
}

export class DesktopRunController {
  private activeOperation: ActiveDesktopOperation | undefined;

  private readonly emitEvent: (event: DesktopRunEvent) => void;

  private readonly startCheckQuest: StartCheckQuestFunction;

  private readonly preflightDesktopGeminiCredentials: PreflightDesktopGeminiCredentialsFunction;

  private readonly preflightDesktopTargetReachability: PreflightDesktopTargetReachabilityFunction;

  private readonly sessionCredentials: DesktopSessionCredentialStore;

  constructor(options: DesktopRunControllerOptions) {
    this.emitEvent = options.emitEvent;
    this.startCheckQuest = options.start ?? startCheckQuest;
    this.preflightDesktopGeminiCredentials = options.preflight ?? preflightDesktopGeminiCredentials;
    this.preflightDesktopTargetReachability =
      options.targetPreflight ?? preflightDesktopTargetReachability;
    this.sessionCredentials = options.sessionCredentials ?? new DesktopSessionCredentialStore();
  }

  async start(request: unknown): Promise<DesktopStartRunReply> {
    if (this.activeOperation !== undefined) {
      return {
        accepted: false,
        reason: 'active-run',
        message: 'A CheckQuest run is already active.'
      };
    }

    const validation = validateDesktopStartRunInput(request, {
      sessionCredentialAvailable: this.sessionCredentials.hasGeminiApiKey()
    });

    if (!validation.success) {
      return {
        accepted: false,
        reason: 'invalid-request',
        message: validation.message,
        fieldErrors: validation.fieldErrors
      };
    }

    const { input } = validation;
    const suppliedGeminiApiKey = input.geminiApiKey;
    const effectiveGeminiApiKey = suppliedGeminiApiKey ?? this.sessionCredentials.getGeminiApiKey();

    if (effectiveGeminiApiKey === undefined) {
      return {
        accepted: false,
        reason: 'invalid-request',
        message: 'Gemini API key is required.',
        fieldErrors: {
          geminiApiKey: 'Gemini API key is required.'
        }
      };
    }

    const preflightAbortController = new AbortController();
    let resolvePreflightSettlement: () => void = () => undefined;
    const preflightOperation: ActiveDesktopOperation = {
      cancel: () => {
        preflightAbortController.abort();
      },
      cancellationRequested: false,
      settled: new Promise<void>(resolve => {
        resolvePreflightSettlement = resolve;
      })
    };

    this.activeOperation = preflightOperation;

    try {
      if (suppliedGeminiApiKey !== undefined) {
        let preflightResult: DesktopGeminiCredentialPreflightResult;

        try {
          preflightResult = await this.preflightDesktopGeminiCredentials({
            geminiApiKey: suppliedGeminiApiKey,
            signal: preflightAbortController.signal
          });
        } catch {
          if (preflightAbortController.signal.aborted) {
            return createCancelledStartReply();
          }

          return {
            accepted: false,
            reason: 'preflight-failed',
            message: 'Gemini credentials could not be checked. Try again.'
          };
        }

        if (preflightAbortController.signal.aborted) {
          return createCancelledStartReply();
        }

        if (!preflightResult.accepted) {
          return {
            accepted: false,
            reason: 'credential-rejected',
            message: preflightResult.message,
            fieldErrors: {
              geminiApiKey: preflightResult.message
            }
          };
        }

        this.sessionCredentials.replaceGeminiApiKey(suppliedGeminiApiKey);
      }

      try {
        this.emitEvent({
          type: 'target-preflight-started',
          timestamp: new Date().toISOString(),
          runId: 'desktop-preflight',
          message: 'Checking whether the website can be reached.'
        });
      } catch {
        /*
         * Desktop presentation failures must never alter preflight behavior.
         */
      }

      let targetPreflightResult: DesktopTargetReachabilityPreflightResult;

      try {
        targetPreflightResult = await this.preflightDesktopTargetReachability({
          target: input.targetUrl,
          signal: preflightAbortController.signal
        });
      } catch {
        if (preflightAbortController.signal.aborted) {
          return createCancelledStartReply();
        }

        return {
          accepted: false,
          reason: 'target-unreachable',
          message: 'Could not reach this website. Check the address and try again.',
          fieldErrors: {
            targetUrl: 'Could not reach this website. Check the address and try again.'
          }
        };
      }

      if (preflightAbortController.signal.aborted) {
        return createCancelledStartReply();
      }

      if (!targetPreflightResult.accepted) {
        return {
          accepted: false,
          reason: 'target-unreachable',
          message: targetPreflightResult.message,
          fieldErrors: {
            targetUrl: targetPreflightResult.message
          }
        };
      }

      return this.launchRun(
        {
          ...input,
          targetUrl: targetPreflightResult.target
        },
        effectiveGeminiApiKey
      );
    } finally {
      resolvePreflightSettlement();

      if (this.activeOperation === preflightOperation) {
        this.activeOperation = undefined;
      }
    }
  }

  private launchRun(input: DesktopStartRunInput, geminiApiKey: string): DesktopStartRunReply {
    let run: CheckQuestRun;

    try {
      run = this.startCheckQuest({
        target: input.targetUrl,
        budgets: {
          pages: input.pageBudget,
          navigationSteps: input.navigationBudget,
          investigationStepsPerPage: input.investigationStepsPerPage
        },
        credentials: {
          geminiApiKey
        },
        onEvent: event => {
          const desktopEvent = projectApplicationRunEvent(event);

          try {
            this.emitEvent(desktopEvent);
          } catch {
            /*
             * Desktop presentation failures must never alter execution.
             */
          }
        }
      });
    } catch {
      return {
        accepted: false,
        reason: 'application-unavailable',
        message: 'The desktop application could not start the run.'
      };
    }

    const activeRun: ActiveDesktopOperation = {
      cancel: run.cancel,
      cancellationRequested: false,
      settled: Promise.resolve()
    };

    activeRun.settled = run.result
      .then(
        () => undefined,
        () => undefined
      )
      .finally(() => {
        if (this.activeOperation === activeRun) {
          this.activeOperation = undefined;
        }
      });
    this.activeOperation = activeRun;

    return {
      accepted: true
    };
  }

  cancel(): DesktopCancelRunReply {
    const activeOperation = this.activeOperation;

    if (activeOperation === undefined) {
      return {
        requested: false
      };
    }

    if (!activeOperation.cancellationRequested) {
      activeOperation.cancellationRequested = true;

      try {
        activeOperation.cancel();
      } catch {
        /*
         * Cancellation is best-effort at this presentation boundary. The
         * application run/preflight handle owns cancellation semantics.
         */
      }
    }

    return {
      requested: true
    };
  }

  hasActiveRun(): boolean {
    return this.activeOperation !== undefined;
  }

  getSessionCredentialStatus(): {
    available: boolean;
  } {
    return {
      available: this.sessionCredentials.hasGeminiApiKey()
    };
  }

  clearSessionCredentials(): void {
    this.sessionCredentials.clear();
  }

  async cancelAndWait(): Promise<void> {
    const activeOperation = this.activeOperation;

    if (activeOperation === undefined) {
      return;
    }

    this.cancel();
    await activeOperation.settled;
  }
}
