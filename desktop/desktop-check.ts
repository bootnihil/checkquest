import assert from 'node:assert/strict';
import {
  readFile
} from 'node:fs/promises';

import type {
  CheckQuestRunResult,
  StartCheckQuestInput
} from '../agent/application/start-checkquest';
import {
  desktopRunBudgetLimits,
  desktopRunDefaults,
  normalizeDesktopTargetUrl,
  projectDesktopCancelRunReply,
  projectDesktopRunEvent,
  projectDesktopSessionCredentialStatus,
  projectDesktopStartRunReply,
  validateDesktopStartRunInput,
  type DesktopRunEvent,
  type DesktopStartRunInput
} from './contracts';
import {
  DesktopRunController,
  type PreflightGeminiCredentialsFunction,
  type PreflightTargetReachabilityFunction,
  type StartCheckQuestFunction
} from './run-controller';
import {
  desktopRendererSecurityPreferences
} from './security-policy';
import {
  createCancellingUiState,
  createCheckingCredentialsUiState,
  createCheckingWebsiteUiState,
  createStartingUiState,
  formatDesktopCompletionSummary,
  getDesktopRunButtonPresentation,
  getDesktopUiReadinessMessage,
  initialDesktopUiState,
  reduceDesktopUiState
} from './ui-state';
import {
  submitDesktopRun
} from './renderer/submit-run';
import {
  createElapsedStatusText,
  formatElapsedTime
} from './renderer/elapsed-time';
import {
  isDesktopRunLocallyEligible
} from './renderer/form-eligibility';
import {
  reduceDesktopBudgetProgress
} from './renderer/budget-progress';
import {
  getDesktopCredentialPresentation
} from './renderer/credential-presentation';
import {
  getBudgetStepperAvailability,
  stepBudgetValue
} from './renderer/budget-stepper';
import {
  calculateFloatingPosition
} from './renderer/floating-position';
import {
  DesktopSessionCredentialStore
} from './session-credential';
import {
  getDesktopInitialWindowBounds
} from './window-bounds';

interface Deferred<Value> {
  promise:
    Promise<Value>;
  resolve:
    (
      value:
        Value
    ) => void;
  reject:
    (
      reason:
        unknown
    ) => void;
}

function createDeferred<Value>():
  Deferred<Value> {
  let resolvePromise:
    (
      value:
        Value
    ) => void =
      () => undefined;
  let rejectPromise:
    (
      reason:
        unknown
    ) => void =
      () => undefined;
  const promise =
    new Promise<Value>(
      (
        resolve,
        reject
      ) => {
        resolvePromise =
          resolve;
        rejectPromise =
          reject;
      }
    );

  return {
    promise,
    resolve:
      resolvePromise,
    reject:
      rejectPromise
  };
}

const validRequest:
  DesktopStartRunInput = {
    targetUrl:
      'https://example.com/',
    pageBudget:
      3,
    navigationBudget:
      4,
    investigationStepsPerPage:
      2,
    geminiApiKey:
      'desktop-test-key'
  };

const commonEvent = {
  timestamp:
    '2026-07-26T12:00:00.000Z',
  runId:
    'desktop-check',
  message:
    'Synthetic desktop event.'
} as const;

const acceptedTargetPreflight:
  PreflightTargetReachabilityFunction =
    async input => ({
      accepted:
        true,
      target:
        input.target
    });

function runValidationChecks():
  void {
  assert.equal(
    validateDesktopStartRunInput(
      validRequest
    ).success,
    true
  );

  const invalidCases:
    readonly unknown[] = [
      {
        ...validRequest,
        targetUrl:
          'not-a-url'
      },
      {
        ...validRequest,
        targetUrl:
          'ftp://example.com/'
      },
      {
        ...validRequest,
        pageBudget:
          0
      },
      {
        ...validRequest,
        pageBudget:
          1.5
      },
      {
        ...validRequest,
        navigationBudget:
          51
      },
      {
        ...validRequest,
        investigationStepsPerPage:
          -1
      },
      {
        ...validRequest,
        geminiApiKey:
          '   '
      },
      {
        ...validRequest,
        model:
          'gemini-debug-model'
      },
      {
        ...validRequest,
        dependencies: {
          forbidden:
            true
        }
      }
    ];

  for (
    const invalidCase of
      invalidCases
  ) {
    assert.equal(
      validateDesktopStartRunInput(
        invalidCase
      ).success,
      false
    );
  }

  for (
    const geminiApiKey of
      [
        '',
        '   '
      ]
  ) {
    const validation =
      validateDesktopStartRunInput({
        ...validRequest,
        geminiApiKey
      });

    assert.equal(
      validation.success,
      false
    );

    if (
      !validation.success
    ) {
      assert.equal(
        validation
          .fieldErrors
          .geminiApiKey,
        'Gemini API key is required.'
      );
    }
  }

  const malformedUrl =
    validateDesktopStartRunInput({
      ...validRequest,
      targetUrl:
        'not-a-url'
    });
  assert.equal(
    malformedUrl.success,
    false
  );

  if (
    !malformedUrl.success
  ) {
    assert.equal(
      typeof malformedUrl
        .fieldErrors
        .targetUrl,
      'string'
    );
  }

  const invalidBudget =
    validateDesktopStartRunInput({
      ...validRequest,
      pageBudget:
        1.5
    });
  assert.equal(
    invalidBudget.success,
    false
  );

  if (
    !invalidBudget.success
  ) {
    assert.equal(
      typeof invalidBudget
        .fieldErrors
        .pageBudget,
      'string'
    );
  }

  const secret =
    'credential-must-not-appear';
  const invalidCredential =
    validateDesktopStartRunInput({
      ...validRequest,
      geminiApiKey:
        secret.repeat(
          500
        )
    });

  assert.equal(
    invalidCredential.success,
    false
  );
  assert.equal(
    JSON.stringify(
      invalidCredential
    ).includes(
      secret
    ),
    false
  );

  for (
    const targetUrl of [
      'https://aidoc.com',
      'https://www.aidoc.com/',
      'https://www.aidoc.com/path',
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://[::1]:3000',
      'https://service.internal'
    ]
  ) {
    assert.equal(
      validateDesktopStartRunInput({
        ...validRequest,
        targetUrl
      }).success,
      true,
      `${targetUrl} should be accepted.`
    );
  }

  for (
    const targetUrl of [
      'eee',
      'ftp://example.com',
      'http://ee',
      'https://user:password@example.com'
    ]
  ) {
    assert.equal(
      validateDesktopStartRunInput({
        ...validRequest,
        targetUrl
      }).success,
      false,
      `${targetUrl} should be rejected.`
    );
  }

  assert.equal(
    validateDesktopStartRunInput(
      {
        ...validRequest,
        geminiApiKey:
          undefined
      },
      {
        sessionCredentialAvailable:
          true
      }
    ).success,
    true
  );

  const normalizationCases = [
    {
      input:
        'aidoc.com',
      expected:
        'https://aidoc.com/'
    },
    {
      input:
        'www.aidoc.com',
      expected:
        'https://www.aidoc.com/'
    },
    {
      input:
        'https://aidoc.com/path',
      expected:
        'https://aidoc.com/path'
    },
    {
      input:
        'http://localhost:3000',
      expected:
        'http://localhost:3000'
    },
    {
      input:
        'localhost:3000',
      expected:
        'http://localhost:3000/'
    },
    {
      input:
        '127.0.0.1:3000',
      expected:
        'http://127.0.0.1:3000/'
    }
  ] as const;

  for (
    const scenario of
      normalizationCases
  ) {
    assert.equal(
      normalizeDesktopTargetUrl(
        scenario.input
      ),
      scenario.expected
    );

    const validation =
      validateDesktopStartRunInput({
        ...validRequest,
        targetUrl:
          scenario.input
      });

    assert.equal(
      validation.success,
      true
    );

    if (
      validation.success
    ) {
      assert.equal(
        validation.input
          .targetUrl,
        scenario.expected
      );
    }
  }

  const aggregateValidation =
    validateDesktopStartRunInput({
      ...validRequest,
      targetUrl:
        'http://ee',
      pageBudget:
        0,
      navigationBudget:
        51,
      investigationStepsPerPage:
        0,
      geminiApiKey:
        ''
    });

  assert.equal(
    aggregateValidation
      .success,
    false
  );

  if (
    !aggregateValidation
      .success
  ) {
    assert.deepEqual(
      Object.keys(
        aggregateValidation
          .fieldErrors
      ),
      [
        'targetUrl',
        'pageBudget',
        'navigationBudget',
        'investigationStepsPerPage',
        'geminiApiKey'
      ]
    );
  }

  assert.deepEqual(
    desktopRunDefaults,
    {
      pageBudget:
        3,
      navigationBudget:
        4,
      investigationStepsPerPage:
        3
    }
  );
  assert.equal(
    desktopRunBudgetLimits
      .investigationStepsPerPage
      .minimum,
    1
  );
}

function runEventProjectionChecks():
  void {
  const credential =
    'desktop-event-secret';
  assert.deepEqual(
    projectDesktopRunEvent({
      ...commonEvent,
      type:
        'target-preflight-started',
      rawProviderError:
        credential
    }),
    {
      ...commonEvent,
      type:
        'target-preflight-started'
    }
  );
  const projected =
    projectDesktopRunEvent({
      ...commonEvent,
      type:
        'inspection-started',
      pageNumber:
        2,
      url:
        'https://example.com/private',
      geminiApiKey:
        credential,
      provider: {
        apiKey:
          credential
      },
      futureField:
        'must not cross'
    });

  assert.deepEqual(
    projected,
    {
      ...commonEvent,
      type:
        'inspection-started',
      pageNumber:
        2
    }
  );
  assert.equal(
    JSON.stringify(
      projected
    ).includes(
      credential
    ),
    false
  );
  assert.equal(
    projectDesktopRunEvent({
      ...commonEvent,
      type:
        'future-run-event'
    }),
    null
  );
  assert.equal(
    projectDesktopRunEvent({
      ...commonEvent,
      type:
        'run-completed',
      inspectedPageCount:
        'three',
      findingCount:
        0,
      occurrenceCount:
        0,
      outcome:
        'completed'
    }),
    null
  );

  assert.deepEqual(
    projectDesktopStartRunReply({
      accepted:
        true,
      geminiApiKey:
        credential
    }),
    {
      accepted:
        true
    }
  );
  assert.deepEqual(
    projectDesktopStartRunReply({
      accepted:
        false,
      reason:
        'credential-rejected',
      message:
        'Gemini API key could not be authenticated.',
      fieldErrors: {
        geminiApiKey:
          'Gemini API key could not be authenticated.',
        futureField:
          credential
      },
      rawProviderError:
        credential
    }),
    {
      accepted:
        false,
      reason:
        'credential-rejected',
      message:
        'Gemini API key could not be authenticated.',
      fieldErrors: {
        geminiApiKey:
          'Gemini API key could not be authenticated.'
      }
    }
  );
  assert.deepEqual(
    projectDesktopCancelRunReply({
      requested:
        true,
      rawIpc:
        'forbidden'
    }),
    {
      requested:
        true
    }
  );
  assert.deepEqual(
    projectDesktopSessionCredentialStatus({
      available:
        true,
      geminiApiKey:
        credential
    }),
    {
      available:
        true
    }
  );
}

async function runSessionCredentialChecks():
  Promise<void> {
  const sessionCredentials =
    new DesktopSessionCredentialStore();
  const preflightKeys:
    string[] =
      [];
  const runKeys:
    string[] =
      [];
  const controller =
    new DesktopRunController({
      targetPreflight:
        acceptedTargetPreflight,
      sessionCredentials,
      preflight:
        async input => {
          preflightKeys.push(
            input.geminiApiKey
          );

          return input
            .geminiApiKey ===
            'invalid-replacement'
            ? {
                accepted:
                  false,
                reason:
                  'authentication',
                message:
                  'Gemini API key could not be authenticated.'
              }
            : {
                accepted:
                  true
              };
        },
      start:
        input => {
          runKeys.push(
            input.credentials
              ?.geminiApiKey ??
              ''
          );

          return {
            result:
              Promise.resolve(
                {} as
                  CheckQuestRunResult
              ),
            cancel:
              () => undefined
          };
        },
      emitEvent:
        () => undefined
    });
  const withoutKey = {
    ...validRequest,
    geminiApiKey:
      undefined
  };

  assert.equal(
    (
      await controller.start(
        withoutKey
      )
    ).accepted,
    false
  );
  assert.deepEqual(
    controller
      .getSessionCredentialStatus(),
    {
      available:
        false
    }
  );

  assert.deepEqual(
    await controller.start({
      ...validRequest,
      geminiApiKey:
        'first-session-key'
    }),
    {
      accepted:
        true
    }
  );
  await new Promise<void>(
    resolve => {
      setImmediate(
        resolve
      );
    }
  );
  assert.deepEqual(
    controller
      .getSessionCredentialStatus(),
    {
      available:
        true
    }
  );

  assert.deepEqual(
    await controller.start(
      withoutKey
    ),
    {
      accepted:
        true
    }
  );
  await new Promise<void>(
    resolve => {
      setImmediate(
        resolve
      );
    }
  );
  assert.deepEqual(
    preflightKeys,
    [
      'first-session-key'
    ]
  );
  assert.deepEqual(
    runKeys,
    [
      'first-session-key',
      'first-session-key'
    ]
  );

  const invalidReplacementReply =
    await controller.start({
      ...validRequest,
      geminiApiKey:
        'invalid-replacement'
    });
  assert.equal(
    invalidReplacementReply
      .accepted,
    false
  );
  assert.equal(
    JSON.stringify(
      invalidReplacementReply
    ).includes(
      'invalid-replacement'
    ),
    false
  );

  assert.deepEqual(
    await controller.start(
      withoutKey
    ),
    {
      accepted:
        true
    }
  );
  await new Promise<void>(
    resolve => {
      setImmediate(
        resolve
      );
    }
  );
  assert.equal(
    runKeys.at(
      -1
    ),
    'first-session-key'
  );

  assert.deepEqual(
    await controller.start({
      ...validRequest,
      geminiApiKey:
        'replacement-session-key'
    }),
    {
      accepted:
        true
    }
  );
  await new Promise<void>(
    resolve => {
      setImmediate(
        resolve
      );
    }
  );
  assert.equal(
    runKeys.at(
      -1
    ),
    'replacement-session-key'
  );

  controller
    .clearSessionCredentials();
  assert.deepEqual(
    controller
      .getSessionCredentialStatus(),
    {
      available:
        false
    }
  );
}

function runElapsedTimeChecks():
  void {
  assert.equal(
    formatElapsedTime(
      27_999
    ),
    '00:27'
  );
  assert.equal(
    formatElapsedTime(
      3_661_000
    ),
    '01:01:01'
  );
  assert.equal(
    createElapsedStatusText(
      'inspecting',
      1_000,
      undefined,
      28_000
    ),
    '00:27'
  );
  assert.equal(
    createElapsedStatusText(
      'cancelling',
      1_000,
      24_000,
      28_000
    ),
    '00:04'
  );
  assert.equal(
    createElapsedStatusText(
      'completed',
      1_000,
      undefined,
      28_000
    ),
    null
  );
}

function runFormEligibilityChecks():
  void {
  assert.equal(
    isDesktopRunLocallyEligible(
      {
        ...validRequest,
        targetUrl:
          '',
        geminiApiKey:
          ''
      },
      false
    ),
    false
  );
  assert.equal(
    isDesktopRunLocallyEligible(
      {
        ...validRequest,
        targetUrl:
          'aidoc.com',
        geminiApiKey:
          'entered-key'
      },
      false
    ),
    true
  );
  assert.equal(
    isDesktopRunLocallyEligible(
      {
        ...validRequest,
        targetUrl:
          'aidoc.com',
        geminiApiKey:
          undefined
      },
      true
    ),
    true
  );
  assert.equal(
    isDesktopRunLocallyEligible(
      {
        ...validRequest,
        pageBudget:
          0
      },
      true
    ),
    false
  );
}

function runCredentialPresentationChecks():
  void {
  assert.deepEqual(
    getDesktopCredentialPresentation(
      false
    ),
    {
      inputRequired:
        true,
      requirementVisible:
        true,
      helpText:
        'Kept only until you close CheckQuest',
      placeholderText:
        '',
      accessibleStateText:
        '',
      available:
        false
    }
  );
  assert.deepEqual(
    getDesktopCredentialPresentation(
      true
    ),
    {
      inputRequired:
        false,
      requirementVisible:
        false,
      helpText:
        'Kept only until you close CheckQuest',
      placeholderText:
        '✓ API key ready for this session — enter a new key to replace it',
      accessibleStateText:
        'API key ready for this session. Enter a new key to replace it.',
      available:
        true
    }
  );
}

function runFloatingPositionChecks():
  void {
  const viewport = {
    width:
      800,
    height:
      600
  };
  const overlay = {
    width:
      250,
    height:
      80
  };

  assert.deepEqual(
    calculateFloatingPosition(
      {
        left:
          8,
        top:
          100,
        right:
          26,
        bottom:
          118,
        width:
          18,
        height:
          18
      },
      overlay,
      viewport
    ),
    {
      left:
        12,
      top:
        128,
      arrowLeft:
        14,
      placement:
        'below'
    }
  );
  assert.deepEqual(
    calculateFloatingPosition(
      {
        left:
          762,
        top:
          100,
        right:
          780,
        bottom:
          118,
        width:
          18,
        height:
          18
      },
      overlay,
      viewport
    ),
    {
      left:
        538,
      top:
        128,
      arrowLeft:
        233,
      placement:
        'below'
    }
  );
  assert.equal(
    calculateFloatingPosition(
      {
        left:
          391,
        top:
          560,
        right:
          409,
        bottom:
          578,
        width:
          18,
        height:
          18
      },
      overlay,
      viewport
    ).placement,
    'above'
  );
}

function runBudgetStepperChecks():
  void {
  const limits = {
    minimum:
      1,
    maximum:
      20
  } as const;

  assert.deepEqual(
    getBudgetStepperAvailability(
      '1',
      limits,
      false
    ),
    {
      decrementDisabled:
        true,
      incrementDisabled:
        false
    }
  );
  assert.deepEqual(
    getBudgetStepperAvailability(
      '20',
      limits,
      false
    ),
    {
      decrementDisabled:
        false,
      incrementDisabled:
        true
    }
  );
  assert.deepEqual(
    getBudgetStepperAvailability(
      '3',
      limits,
      true
    ),
    {
      decrementDisabled:
        true,
      incrementDisabled:
        true
    }
  );
  assert.deepEqual(
    getBudgetStepperAvailability(
      '1.5',
      limits,
      false
    ),
    {
      decrementDisabled:
        true,
      incrementDisabled:
        true
    }
  );
  assert.equal(
    stepBudgetValue(
      '1',
      -1,
      limits
    ),
    1
  );
  assert.equal(
    stepBudgetValue(
      '20',
      1,
      limits
    ),
    20
  );
  assert.equal(
    stepBudgetValue(
      '3',
      1,
      limits
    ),
    4
  );
}

function runBudgetProgressChecks():
  void {
  const started =
    reduceDesktopBudgetProgress(
      null,
      {
        ...commonEvent,
        type:
          'run-started',
        pageBudget:
          3,
        navigationBudget:
          4
      }
    );

  assert.deepEqual(
    started,
    {
      pageNumber:
        0,
      pageBudget:
        3,
      navigationUsed:
        0,
      navigationBudget:
        4
    }
  );

  const inspecting =
    reduceDesktopBudgetProgress(
      started,
      {
        ...commonEvent,
        type:
          'inspection-started',
        pageNumber:
          1
      }
    );

  assert.equal(
    inspecting
      ?.pageNumber,
    1
  );

  const navigating =
    reduceDesktopBudgetProgress(
      inspecting,
      {
        ...commonEvent,
        type:
          'navigation-started',
        navigationStep:
          1,
        navigationBudget:
          4,
        pageNumber:
          1
      }
    );

  assert.equal(
    navigating
      ?.navigationUsed,
    1
  );
  assert.equal(
    JSON.stringify(
      navigating
    ).includes(
      '%'
    ),
    false
  );
}

function runWindowBoundsChecks():
  void {
  assert.deepEqual(
    getDesktopInitialWindowBounds({
      width:
        1_920,
      height:
        1_040
    }),
    {
      width:
        800,
      height:
        620
    }
  );
  assert.deepEqual(
    getDesktopInitialWindowBounds({
      width:
        800,
      height:
        600
    }),
    {
      width:
        720,
      height:
        560
    }
  );
}

async function runControllerChecks():
  Promise<void> {
  const firstResult =
    createDeferred<
      CheckQuestRunResult
    >();
  const secondResult =
    createDeferred<
      CheckQuestRunResult
    >();
  const inputs:
    StartCheckQuestInput[] =
      [];
  let cancellationCount =
    0;
  let startCount =
    0;
  let preflightCount =
    0;
  const preflight:
    PreflightGeminiCredentialsFunction =
      async input => {
        preflightCount +=
          1;
        assert.equal(
          input.geminiApiKey,
          validRequest
            .geminiApiKey
        );

        return {
          accepted:
            true
        };
      };
  const start:
    StartCheckQuestFunction =
      input => {
        inputs.push(
          input
        );
        startCount +=
          1;
        const deferred =
          startCount ===
            1
            ? firstResult
            : secondResult;

        return {
          result:
            deferred.promise,
          cancel:
            () => {
              cancellationCount +=
                1;
            }
        };
      };
  const emittedEvents:
    DesktopRunEvent[] =
      [];
  const controller =
    new DesktopRunController({
      targetPreflight:
        acceptedTargetPreflight,
      start,
      preflight,
      emitEvent:
        event => {
          emittedEvents.push(
            event
          );
        }
    });

  assert.deepEqual(
    await controller.start(
      validRequest
    ),
    {
      accepted:
        true
    }
  );
  assert.equal(
    controller.hasActiveRun(),
    true
  );
  assert.equal(
    startCount,
    1
  );
  assert.deepEqual(
    await controller.start(
      validRequest
    ),
    {
      accepted:
        false,
      reason:
        'active-run',
      message:
        'A CheckQuest run is already active.'
    }
  );
  assert.equal(
    startCount,
    1
  );
  assert.equal(
    preflightCount,
    1
  );

  assert.equal(
    inputs[0]
      ?.target,
    validRequest.targetUrl
  );
  assert.deepEqual(
    inputs[0]
      ?.budgets,
    {
      pages:
        3,
      navigationSteps:
        4,
      investigationStepsPerPage:
        2
    }
  );
  assert.equal(
    inputs[0]
      ?.credentials
      ?.geminiApiKey,
    validRequest
      .geminiApiKey
  );
  assert.equal(
    inputs[0]
      ?.model,
    undefined
  );
  assert.equal(
    inputs[0]
      ?.dependencies,
    undefined
  );

  inputs[0]
    ?.onEvent
    ?.({
      ...commonEvent,
      type:
        'run-started',
      startUrl:
        'https://example.com/',
      pageBudget:
        3,
      navigationBudget:
        4
    });
  assert.deepEqual(
    emittedEvents.at(
      -1
    ),
    {
      ...commonEvent,
      type:
        'run-started',
      pageBudget:
        3,
      navigationBudget:
        4
    }
  );

  assert.deepEqual(
    controller.cancel(),
    {
      requested:
        true
    }
  );
  assert.deepEqual(
    controller.cancel(),
    {
      requested:
        true
    }
  );
  assert.equal(
    cancellationCount,
    1
  );

  firstResult.reject(
    new Error(
      'Synthetic rejected run result.'
    )
  );
  await controller
    .cancelAndWait();
  assert.equal(
    controller.hasActiveRun(),
    false
  );
  assert.deepEqual(
    controller.cancel(),
    {
      requested:
        false
    }
  );

  assert.deepEqual(
    await controller.start(
      validRequest
    ),
    {
      accepted:
        true
    }
  );
  assert.equal(
    startCount,
    2
  );
  secondResult.resolve(
    {} as CheckQuestRunResult
  );
  await secondResult.promise;
  await new Promise<void>(
    resolve => {
      setImmediate(
        resolve
      );
    }
  );
  assert.equal(
    controller.hasActiveRun(),
    false
  );

  const throwingPresentationController =
    new DesktopRunController({
      targetPreflight:
        acceptedTargetPreflight,
      preflight,
      start:
        input => {
          input.onEvent?.({
            ...commonEvent,
            type:
              'run-started',
            startUrl:
              'https://example.com/',
            pageBudget:
              3,
            navigationBudget:
              4
          });

          return {
            result:
              Promise.reject(
                new Error(
                  'Synthetic result rejection.'
                )
              ),
            cancel:
              () => undefined
          };
        },
      emitEvent:
        () => {
          throw new Error(
            'Synthetic presentation failure.'
          );
        }
    });

  assert.deepEqual(
    await throwingPresentationController
      .start(
        validRequest
      ),
    {
      accepted:
        true
    }
  );
  await throwingPresentationController
    .cancelAndWait();

  let rejectedRunStartCount =
    0;
  const rejectedController =
    new DesktopRunController({
      targetPreflight:
        acceptedTargetPreflight,
      preflight:
        async () => ({
          accepted:
            false,
          reason:
            'authentication',
          message:
            'Gemini API key could not be authenticated.'
        }),
      start:
        input => {
          rejectedRunStartCount +=
            1;
          return start(
            input
          );
        },
      emitEvent:
        () => undefined
    });
  const rejectedReply =
    await rejectedController
      .start(
        validRequest
      );

  assert.deepEqual(
    rejectedReply,
    {
      accepted:
        false,
      reason:
        'credential-rejected',
      message:
        'Gemini API key could not be authenticated.',
      fieldErrors: {
        geminiApiKey:
          'Gemini API key could not be authenticated.'
      }
    }
  );
  assert.equal(
    rejectedRunStartCount,
    0
  );
  assert.equal(
    rejectedController
      .hasActiveRun(),
    false
  );

  const providerSecret =
    'provider-secret-must-not-cross';
  const providerFailureController =
    new DesktopRunController({
      targetPreflight:
        acceptedTargetPreflight,
      preflight:
        async () => {
          throw new Error(
            providerSecret
          );
        },
      start,
      emitEvent:
        () => undefined
    });
  const providerFailureReply =
    await providerFailureController
      .start(
        validRequest
      );

  assert.deepEqual(
    providerFailureReply,
    {
      accepted:
        false,
      reason:
        'preflight-failed',
      message:
        'Gemini credentials could not be checked. Try again.'
    }
  );
  assert.equal(
    JSON.stringify(
      providerFailureReply
    ).includes(
      providerSecret
    ),
    false
  );

  let invalidPreflightCount =
    0;
  const invalidController =
    new DesktopRunController({
      targetPreflight:
        acceptedTargetPreflight,
      preflight:
        async () => {
          invalidPreflightCount +=
            1;
          return {
            accepted:
              true
          };
        },
      start,
      emitEvent:
        () => undefined
    });
  const invalidReply =
    await invalidController
      .start({
        ...validRequest,
        geminiApiKey:
          ' '
      });

  assert.equal(
    invalidReply.accepted,
    false
  );
  assert.equal(
    invalidPreflightCount,
    0
  );

  let preflightAbortCount =
    0;
  let cancelledRunStartCount =
    0;
  const cancellablePreflightController =
    new DesktopRunController({
      targetPreflight:
        acceptedTargetPreflight,
      preflight:
        input =>
          new Promise(
            (
              _resolve,
              reject
            ) => {
              input.signal
                ?.addEventListener(
                  'abort',
                  () => {
                    preflightAbortCount +=
                      1;
                    reject(
                      new Error(
                        'Synthetic abort.'
                      )
                    );
                  },
                  {
                    once:
                      true
                  }
                );
            }
          ),
      start:
        input => {
          cancelledRunStartCount +=
            1;
          return start(
            input
          );
        },
      emitEvent:
        () => undefined
    });
  const cancelledStart =
    cancellablePreflightController
      .start(
        validRequest
      );

  assert.deepEqual(
    cancellablePreflightController
      .cancel(),
    {
      requested:
        true
    }
  );
  assert.deepEqual(
    cancellablePreflightController
      .cancel(),
    {
      requested:
        true
    }
  );
  assert.deepEqual(
    await cancelledStart,
    {
      accepted:
        false,
      reason:
        'cancelled',
      message:
        'The run was cancelled before it started.'
    }
  );
  assert.equal(
    preflightAbortCount,
    1
  );
  assert.equal(
    cancelledRunStartCount,
    0
  );
}

async function runTargetPreflightControllerChecks():
  Promise<void> {
  let startCount =
    0;
  let targetPreflightCount =
    0;
  const emittedEvents:
    DesktopRunEvent[] =
      [];
  const unreachableController =
    new DesktopRunController({
      preflight:
        async () => ({
          accepted:
            true
        }),
      targetPreflight:
        async input => {
          targetPreflightCount +=
            1;
          assert.equal(
            input.target,
            'https://aidoc.com/'
          );

          return {
            accepted:
              false,
            message:
              'Could not reach this website. Check the address and try again.'
          };
        },
      start:
        () => {
          startCount +=
            1;
          throw new Error(
            'Execution must not start for an unreachable target.'
          );
        },
      emitEvent:
        event => {
          emittedEvents.push(
            event
          );
        }
    });

  assert.deepEqual(
    await unreachableController
      .start({
        ...validRequest,
        targetUrl:
          'aidoc.com'
      }),
    {
      accepted:
        false,
      reason:
        'target-unreachable',
      message:
        'Could not reach this website. Check the address and try again.',
      fieldErrors: {
        targetUrl:
          'Could not reach this website. Check the address and try again.'
      }
    }
  );
  assert.equal(
    targetPreflightCount,
    1
  );
  assert.equal(
    startCount,
    0
  );
  assert.equal(
    emittedEvents.at(
      -1
    )?.type,
    'target-preflight-started'
  );

  const canonicalRunResult =
    createDeferred<
      CheckQuestRunResult
    >();
  let canonicalExecutionTarget:
    string | undefined;
  const canonicalController =
    new DesktopRunController({
      preflight:
        async () => ({
          accepted:
            true
        }),
      targetPreflight:
        async () => ({
          accepted:
            true,
          target:
            'https://www.example.com/'
        }),
      start:
        input => {
          canonicalExecutionTarget =
            input.target;

          return {
            result:
              canonicalRunResult
                .promise,
            cancel:
              () => undefined
          };
        },
      emitEvent:
        () => undefined
    });

  assert.deepEqual(
    await canonicalController
      .start(
        validRequest
      ),
    {
      accepted:
        true
    }
  );
  assert.equal(
    canonicalExecutionTarget,
    'https://www.example.com/'
  );
  canonicalRunResult.resolve(
    {} as
      CheckQuestRunResult
  );
  await canonicalRunResult
    .promise;

  let targetAbortCount =
    0;
  const cancellableController =
    new DesktopRunController({
      preflight:
        async () => ({
          accepted:
            true
        }),
      targetPreflight:
        input =>
          new Promise(
            (
              _resolve,
              reject
            ) => {
              input.signal
                ?.addEventListener(
                  'abort',
                  () => {
                    targetAbortCount +=
                      1;
                    reject(
                      new Error(
                        'Synthetic target navigation abort.'
                      )
                    );
                  },
                  {
                    once:
                      true
                  }
                );
            }
          ),
      start:
        () => {
          startCount +=
            1;
          throw new Error(
            'Execution must not start after target cancellation.'
          );
        },
      emitEvent:
        () => undefined
    });
  const cancelledStart =
    cancellableController
      .start(
        validRequest
      );

  await new Promise<void>(
    resolve => {
      setImmediate(
        resolve
      );
    }
  );

  assert.deepEqual(
    cancellableController
      .cancel(),
    {
      requested:
        true
    }
  );
  assert.deepEqual(
    cancellableController
      .cancel(),
    {
      requested:
        true
    }
  );
  assert.deepEqual(
    await cancelledStart,
    {
      accepted:
        false,
      reason:
        'cancelled',
      message:
        'The run was cancelled before it started.'
    }
  );
  assert.equal(
    targetAbortCount,
    1
  );
}

async function runFormSubmissionChecks():
  Promise<void> {
  const invalidCases:
    ReadonlyArray<{
      request:
        DesktopStartRunInput;
      field:
        keyof DesktopStartRunInput;
    }> = [
      {
        request: {
          ...validRequest,
          geminiApiKey:
            ''
        },
        field:
          'geminiApiKey'
      },
      {
        request: {
          ...validRequest,
          geminiApiKey:
            '   '
        },
        field:
          'geminiApiKey'
      },
      {
        request: {
          ...validRequest,
          targetUrl:
            'not-a-url'
        },
        field:
          'targetUrl'
      },
      {
        request: {
          ...validRequest,
          pageBudget:
            1.5
        },
        field:
          'pageBudget'
      },
      {
        request: {
          ...validRequest,
          navigationBudget:
            100
        },
        field:
          'navigationBudget'
      },
      {
        request: {
          ...validRequest,
          investigationStepsPerPage:
            -1
        },
        field:
          'investigationStepsPerPage'
      }
    ];

  for (
    const scenario of
      invalidCases
  ) {
    let startCallCount =
      0;
    let checkingStateCount =
      0;
    const result =
      await submitDesktopRun({
        request:
          scenario.request,
        startRun:
          async () => {
            startCallCount +=
              1;
            return {
              accepted:
                true
            };
          },
        onPreflightStarted:
          () => {
            checkingStateCount +=
              1;
          }
      });

    assert.equal(
      result.outcome,
      'field-errors'
    );
    assert.equal(
      startCallCount,
      0
    );
    assert.equal(
      checkingStateCount,
      0
    );

    if (
      result.outcome ===
        'field-errors'
    ) {
      assert.equal(
        typeof result
          .fieldErrors[
            scenario.field
          ],
        'string'
      );
      assert.equal(
        result.state.phase,
        'ready'
      );
      assert.equal(
        result.state.runActive,
        false
      );
    }
  }

  const acceptedRequest = {
    ...validRequest
  };
  let checkingState:
    ReturnType<
      typeof createCheckingCredentialsUiState
    > | undefined;
  const acceptedResult =
    await submitDesktopRun({
      request:
        acceptedRequest,
      startRun:
        async () => ({
          accepted:
            true
        }),
      onPreflightStarted:
        state => {
          checkingState =
            state;
        }
    });

  assert.equal(
    acceptedResult.outcome,
    'started'
  );
  assert.equal(
    checkingState?.phase,
    'checking-credentials'
  );
  assert.equal(
    acceptedRequest
      .geminiApiKey,
    ''
  );

  const cachedRequest = {
    ...validRequest,
    geminiApiKey:
      undefined
  };
  let cachedPreflightPhase:
    string | undefined;
  const cachedResult =
    await submitDesktopRun({
      request:
        cachedRequest,
      sessionCredentialAvailable:
        true,
      startRun:
        async input => {
          assert.equal(
            input.geminiApiKey,
            undefined
          );

          return {
            accepted:
              true
          };
        },
      onPreflightStarted:
        state => {
          cachedPreflightPhase =
            state.phase;
        }
    });
  assert.equal(
    cachedResult.outcome,
    'started'
  );
  assert.equal(
    cachedPreflightPhase,
    'checking-website'
  );

  const rejectedRequest = {
    ...validRequest
  };
  const rejectedResult =
    await submitDesktopRun({
      request:
        rejectedRequest,
      startRun:
        async () => ({
          accepted:
            false,
          reason:
            'credential-rejected',
          message:
            'Gemini API key could not be authenticated.',
          fieldErrors: {
            geminiApiKey:
              'Gemini API key could not be authenticated.'
          }
        }),
      onPreflightStarted:
        () => undefined
    });

  assert.equal(
    rejectedResult.outcome,
    'field-errors'
  );

  if (
    rejectedResult.outcome ===
      'field-errors'
  ) {
    assert.equal(
      rejectedResult
        .state
        .phase,
      'ready'
    );
    assert.equal(
      rejectedResult
        .fieldErrors
        .geminiApiKey,
      'Gemini API key could not be authenticated.'
    );
  }
  assert.equal(
    rejectedRequest
      .geminiApiKey,
    ''
  );
}

function runUiStateChecks():
  void {
  const checkingState =
    createCheckingCredentialsUiState();

  assert.equal(
    checkingState.phase,
    'checking-credentials'
  );
  assert.equal(
    checkingState.runActive,
    true
  );
  assert.equal(
    createCheckingWebsiteUiState()
      .phase,
    'checking-website'
  );

  let state =
    createStartingUiState();

  assert.equal(
    state.phase,
    'starting'
  );
  assert.equal(
    state.runActive,
    true
  );

  state =
    reduceDesktopUiState(
      state,
      {
        ...commonEvent,
        type:
          'run-started',
        pageBudget:
          3,
        navigationBudget:
          4
      }
    );
  assert.equal(
    state.phase,
    'running'
  );

  state =
    reduceDesktopUiState(
      state,
      {
        ...commonEvent,
        type:
          'inspection-started',
        pageNumber:
          2
      }
    );
  assert.equal(
    state.label,
    'Inspecting page 2'
  );

  state =
    reduceDesktopUiState(
      state,
      {
        ...commonEvent,
        type:
          'model-request-started',
        operation:
          'page-analysis',
        attempt:
          1,
        maxAttempts:
          2
      }
    );
  assert.equal(
    state.phase,
    'analyzing'
  );

  state =
    reduceDesktopUiState(
      state,
      {
        ...commonEvent,
        type:
          'model-request-retrying',
        operation:
          'page-analysis',
        attempt:
          2,
        maxAttempts:
          2,
        retryDelayMs:
          2_000,
        statusCode:
          429
      }
    );
  assert.equal(
    state.phase,
    'retrying'
  );

  state =
    createCancellingUiState(
      state
    );
  assert.equal(
    state.phase,
    'cancelling'
  );
  assert.equal(
    state.label,
    'Cancelling…'
  );
  assert.equal(
    state.detail,
    'Stopping current work and cleaning up…'
  );
  state =
    reduceDesktopUiState(
      state,
      {
        ...commonEvent,
        type:
          'model-request-completed',
        operation:
          'page-analysis',
        attempt:
          2,
        maxAttempts:
          2
      }
    );
  assert.equal(
    state.phase,
    'cancelling'
  );
  state =
    reduceDesktopUiState(
      state,
      {
        ...commonEvent,
        type:
          'run-failed',
        code:
          'CANCELLED',
        phase:
          'browser-close'
      }
    );
  assert.equal(
    state.phase,
    'cancelled'
  );
  assert.equal(
    state.runActive,
    false
  );
  assert.equal(
    state.label,
    'Cancelled'
  );
  assert.equal(
    getDesktopUiReadinessMessage(
      state
    ),
    'Ready for another run'
  );

  const completed =
    reduceDesktopUiState(
      initialDesktopUiState,
      {
        ...commonEvent,
        type:
          'run-completed',
        outcome:
          'completed',
        inspectedPageCount:
          3,
        findingCount:
          2,
        occurrenceCount:
          4
      }
    );
  assert.equal(
    completed.phase,
    'completed'
  );
  assert.equal(
    completed.runActive,
    false
  );
  assert.equal(
    completed.detail.includes(
      '%'
    ),
    false
  );
  assert.equal(
    completed.detail,
    '3 pages inspected · 2 findings'
  );
  assert.equal(
    formatDesktopCompletionSummary(
      1,
      1
    ),
    '1 page inspected · 1 finding'
  );
  assert.equal(
    formatDesktopCompletionSummary(
      2,
      0
    ),
    '2 pages inspected · 0 findings'
  );
  assert.equal(
    completed.detail.includes(
      'occurrence'
    ),
    false
  );
  assert.equal(
    getDesktopUiReadinessMessage(
      completed
    ),
    'Ready for another run'
  );

  assert.deepEqual(
    getDesktopRunButtonPresentation(
      createCheckingCredentialsUiState()
    ),
    {
      label:
        'Checking…',
      busy:
        true
    }
  );
  assert.deepEqual(
    getDesktopRunButtonPresentation({
      phase:
        'running',
      label:
        'Running',
      detail:
        'Synthetic active run.',
      runActive:
        true
    }),
    {
      label:
        'Running…',
      busy:
        true
    }
  );
  assert.deepEqual(
    getDesktopRunButtonPresentation(
      createCancellingUiState({
        phase:
          'running',
        label:
          'Running',
        detail:
          'Synthetic active run.',
        runActive:
          true
      })
    ),
    {
      label:
        'Cancelling…',
      busy:
        true
    }
  );
  assert.deepEqual(
    getDesktopRunButtonPresentation(
      completed
    ),
    {
      label:
        'Run CheckQuest',
      busy:
        false
    }
  );

  const failed =
    reduceDesktopUiState(
      initialDesktopUiState,
      {
        ...commonEvent,
        type:
          'run-failed',
        code:
          'MODEL',
        message:
          'The model request failed.'
      }
    );
  assert.equal(
    failed.phase,
    'failed'
  );
  assert.equal(
    failed.label,
    'Failed'
  );
  assert.equal(
    failed.runActive,
    false
  );
  assert.equal(
    getDesktopUiReadinessMessage(
      failed
    ),
    'Ready to try again'
  );
}

async function runSourceBoundaryChecks():
  Promise<void> {
  const rendererSource =
    (
      await Promise.all([
        readFile(
          new URL(
            './renderer/app.ts',
            import.meta.url
          ),
          'utf8'
        ),
        readFile(
          new URL(
            './renderer/submit-run.ts',
            import.meta.url
          ),
          'utf8'
        ),
        readFile(
          new URL(
            './renderer/credential-presentation.ts',
            import.meta.url
          ),
          'utf8'
        ),
        readFile(
          new URL(
            './renderer/floating-position.ts',
            import.meta.url
          ),
          'utf8'
        )
      ])
    ).join(
      '\n'
    );
  const preloadSource =
    await readFile(
      new URL(
        './preload.ts',
        import.meta.url
      ),
      'utf8'
    );
  const controllerSource =
    await readFile(
      new URL(
        './run-controller.ts',
        import.meta.url
      ),
      'utf8'
    );
  const sessionCredentialSource =
    await readFile(
      new URL(
        './session-credential.ts',
        import.meta.url
      ),
      'utf8'
    );
  const mainSource =
    await readFile(
      new URL(
        './main.ts',
        import.meta.url
      ),
      'utf8'
    );
  const rendererHtml =
    await readFile(
      new URL(
        './renderer/index.html',
        import.meta.url
      ),
      'utf8'
    );
  const rendererStyles =
    await readFile(
      new URL(
        './renderer/styles.css',
        import.meta.url
      ),
      'utf8'
    );

  for (
    const forbidden of [
      'localStorage',
      'sessionStorage',
      'console.log',
      'console.error',
      '@google/genai',
      '@playwright/test'
    ]
  ) {
    assert.equal(
      rendererSource.includes(
        forbidden
      ),
      false,
      `Renderer must not contain ${forbidden}.`
    );
  }

  assert.equal(
    preloadSource.includes(
      'exposeInMainWorld'
    ),
    true
  );
  assert.equal(
    preloadSource.includes(
      'ipcRenderer.send'
    ),
    false
  );
  assert.equal(
    controllerSource.includes(
      'startCheckQuest'
    ),
    true
  );
  assert.equal(
    controllerSource.includes(
      'runSite'
    ),
    false
  );

  for (
    const forbidden of [
      'localStorage',
      'sessionStorage',
      'process.env',
      'writeFile',
      'appendFile',
      'console.'
    ]
  ) {
    assert.equal(
      sessionCredentialSource
        .includes(
          forbidden
        ),
      false,
      `Session credential storage must not contain ${forbidden}.`
    );
  }

  assert.equal(
    mainSource.includes(
      'window.maximize()'
    ),
    false
  );
  for (
    const resizeCall of [
      '.setBounds(',
      '.setContentBounds(',
      '.setContentSize(',
      '.setSize('
    ]
  ) {
    assert.equal(
      mainSource.includes(
        resizeCall
      ),
      false,
      `Main window must not invoke ${resizeCall} after construction.`
    );
  }
  assert.equal(
    mainSource.includes(
      "'checkquest-icon.png'"
    ),
    true
  );
  assert.equal(
    mainSource.includes(
      'sessionCredentials'
    ) &&
      mainSource.includes(
        '.clear()'
      ),
    true
  );
  assert.equal(
    rendererHtml.includes(
      'model-override'
    ),
    false
  );
  assert.equal(
    rendererHtml.includes(
      '<summary>Advanced</summary>'
    ),
    false
  );
  assert.equal(
    rendererHtml.includes(
      'Reset to defaults'
    ),
    true
  );
  assert.equal(
    rendererHtml.includes(
      'Reset Run Settings'
    ),
    false
  );
  assert.equal(
    (
      rendererHtml.match(
        /id="vocabulary-button"/g
      ) ??
      []
    ).length,
    1
  );
  assert.equal(
    rendererHtml.includes(
      'class="product-bar"'
    ) &&
      rendererHtml.includes(
        '<span class="product-version">v0.1 alpha</span>'
      ) &&
      !rendererHtml.includes(
        '<button class="product-version"'
      ) &&
      !rendererHtml.includes(
        'class="product-badge"'
      ),
    true
  );
  assert.equal(
    rendererHtml.includes(
      'Explore <span aria-hidden="true">•</span>'
    ) &&
      rendererHtml.includes(
        'Investigate <span aria-hidden="true">•</span>'
      ) &&
      !rendererHtml.includes(
        'Explore · Investigate · Report.'
      ),
    true
  );
  for (
    const vocabularyTerm of [
      'Page',
      'Navigation',
      'Investigation step',
      'Finding'
    ]
  ) {
    assert.equal(
      rendererHtml.includes(
        `<h2>${vocabularyTerm}</h2>`
      ),
      true
    );
  }
  assert.equal(
    rendererHtml.includes(
      'Run Configuration'
    ) &&
      rendererHtml.includes(
        'TARGET'
      ) &&
      rendererHtml.includes(
        'EXPLORATION BUDGETS'
      ) &&
      rendererHtml.includes(
        'AI CONFIGURATION'
      ) &&
      rendererHtml.includes(
        'Investigation steps'
      ) &&
      !rendererHtml.includes(
        'Steps per page'
      ),
    true
  );
  assert.equal(
    rendererHtml.includes(
      'Maximum pages CheckQuest may inspect during this run.'
    ) &&
      rendererHtml.includes(
        'Maximum moves to another approved page while exploring.'
      ) &&
      rendererHtml.includes(
        'Maximum bounded evidence-gathering interactions per page.'
      ),
    true
  );
  assert.equal(
    rendererHtml.includes(
      'aidoc.com'
    ),
    false
  );
  assert.equal(
    rendererHtml.includes(
      'https://example.com/'
    ) &&
      rendererHtml.includes(
        'such as example.com'
      ),
    true
  );
  assert.equal(
    rendererHtml.includes(
      'Gemini API key'
    ) &&
      rendererHtml.includes(
        '— Required'
      ),
    true
  );
  assert.equal(
    rendererHtml.includes(
      'Kept only until you close CheckQuest'
    ) &&
      rendererSource.includes(
        'API key ready for this session'
      ),
    true
  );
  assert.equal(
    rendererHtml.includes(
      'button-danger'
    ),
    false
  );
  assert.equal(
    rendererHtml.includes(
      'button-secondary'
    ),
    true
  );
  assert.equal(
    rendererHtml.includes(
      'role="tooltip"'
    ),
    false
  );
  assert.equal(
    rendererHtml.includes(
      'class="info-help"'
    ) ||
      rendererHtml.includes(
        'class="help-wrap"'
      ) ||
      rendererHtml.includes(
        'class="field-tooltip"'
      ),
    false
  );
  assert.equal(
    (
      rendererHtml.match(
        /data-destination-button=/g
      ) ??
      []
    ).length,
    4
  );
  assert.equal(
    (
      rendererHtml.match(
        /class="wip-badge"/g
      ) ??
      []
    ).length,
    3
  );
  for (
    const placeholder of [
      'Run history and previous CheckQuest runs will live here.',
      'Findings, evidence, and saved CheckQuest reports will live here.',
      'Persistent local CheckQuest preferences will live here.'
    ]
  ) {
    assert.equal(
      rendererHtml.includes(
        placeholder
      ),
      true
    );
  }
  assert.equal(
    rendererHtml.includes(
      'data-destination-button="run"'
    ) &&
      rendererHtml.includes(
        'aria-current="page"'
      ) &&
      rendererHtml.includes(
        'id="destination-explore"'
      ) &&
      rendererHtml.includes(
        'id="destination-reports"'
      ) &&
      rendererHtml.includes(
        'id="destination-settings"'
      ),
    true
  );
  assert.equal(
    rendererHtml.includes(
      'Bounded exploratory QA'
    ) ||
      rendererHtml.includes(
        'Start a CheckQuest run.'
      ),
    false
  );
  assert.equal(
    rendererHtml.includes(
      'class="overview"'
    ) ||
      rendererHtml.includes(
        'class="intro"'
      ),
    false
  );
  assert.equal(
    rendererHtml.includes(
      'class="setup-grid"'
    ) ||
      rendererHtml.includes(
        'class="status-panel"'
      ),
    false
  );
  assert.equal(
    rendererHtml.includes(
      'class="status-bar"'
    ),
    true
  );
  assert.equal(
    rendererHtml.indexOf(
      'class="required-note"'
    ) <
      rendererHtml.indexOf(
        'id="target-url"'
      ),
    true
  );
  assert.equal(
    (
      rendererHtml.match(
        /class="number-stepper"/g
      ) ??
      []
    ).length,
    3
  );
  assert.equal(
    (
      rendererHtml.match(
        /class="stepper-button"/g
      ) ??
      []
    ).length,
    6
  );
  assert.equal(
    rendererHtml.indexOf(
      'id="cancel-button"'
    ) <
      rendererHtml.indexOf(
        'id="run-button"'
      ),
    true
  );
  assert.equal(
    rendererHtml.indexOf(
      'class="actions"'
    ) <
      rendererHtml.indexOf(
        'id="run-status"'
      ),
    true
  );
  assert.equal(
    rendererSource.includes(
      'field.disabled'
    ) &&
      rendererSource.includes(
        'uiState.runActive'
      ) &&
      rendererSource.includes(
        'resetDefaultsButton.disabled'
      ) &&
      rendererSource.includes(
        '.locked'
      ) &&
      rendererSource.includes(
        'showDestination'
      ) &&
      rendererSource.includes(
        'destinationBindings'
      ),
    true
  );
  assert.equal(
    rendererStyles.includes(
      '--product-bar-height: 52px'
    ) &&
      rendererStyles.includes(
        '--status-bar-height: 42px'
      ) &&
      rendererStyles.includes(
        'grid-template-rows: var(--product-bar-height) minmax(0, 1fr) var(--status-bar-height)'
      ) &&
      rendererStyles.includes(
        'grid-template-columns: var(--navigation-width) minmax(0, 1fr)'
      ) &&
      rendererStyles.includes(
        '.navigation-item[aria-current="page"]'
      ) &&
      rendererStyles.includes(
        'grid-template-columns: 34px 52px 34px'
      ) &&
      rendererStyles.includes(
        '.section-heading {\n  display: flex;'
      ) &&
      rendererStyles.includes(
        '.budget-setting {\n  display: grid;'
      ) &&
      rendererStyles.includes(
        '.run-form[data-locked="true"] .number-stepper'
      ) &&
      rendererStyles.includes(
        '.run-form[data-locked="true"] .reset-settings-button:disabled'
      ) &&
      rendererStyles.includes(
        '.vocabulary-popover {\n  position: fixed'
      ) &&
      !rendererStyles.includes(
        '.field-tooltip'
      ) &&
      !rendererStyles.includes(
        'repeat(auto-fit, minmax(160px, 1fr))'
      ) &&
      !rendererStyles.includes(
        '.app-shell'
      ),
    true
  );
}

async function main():
  Promise<void> {
  assert.deepEqual(
    desktopRendererSecurityPreferences,
    {
      contextIsolation:
        true,
      sandbox:
        true,
      nodeIntegration:
        false,
      webSecurity:
        true
    }
  );

  runValidationChecks();
  runEventProjectionChecks();
  await runSessionCredentialChecks();
  runFormEligibilityChecks();
  runCredentialPresentationChecks();
  runFloatingPositionChecks();
  runBudgetStepperChecks();
  runBudgetProgressChecks();
  runWindowBoundsChecks();
  await runControllerChecks();
  await runTargetPreflightControllerChecks();
  await runFormSubmissionChecks();
  runUiStateChecks();
  runElapsedTimeChecks();
  await runSourceBoundaryChecks();

  console.log(
    'Desktop deterministic checks passed.'
  );
}

void main();
