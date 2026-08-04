import assert from 'node:assert/strict';

import { runGeminiRequest } from '../../agent/ai/run-gemini-request';
import { CheckQuestError } from '../../agent/errors/checkquest-error';
import { createSafeDisplayUrl } from '../../agent/errors/safe-display-url';
import {
  createModelRequestRunEventObserver,
  createRunEventEmitter,
  createRunFailureEvent,
  type RunEvent,
  type RunEventObserver
} from '../../agent/run/run-event';
import { runSite } from '../../agent/run/run-site';

async function main(): Promise<void> {
  const events: RunEvent[] = [];
  const emit = createRunEventEmitter(
    'event-contract-run',
    event => {
      events.push(event);
    },
    () => new Date('2026-07-25T12:00:00.000Z')
  );

  emit({
    type: 'run-started',
    message: 'CheckQuest run started.',
    startUrl: createSafeDisplayUrl('https://user:password@example.test/start?token=secret#private'),
    pageBudget: 2,
    navigationBudget: 1
  });

  assert.deepEqual(events, [
    {
      type: 'run-started',
      message: 'CheckQuest run started.',
      startUrl: 'https://example.test/start',
      pageBudget: 2,
      navigationBudget: 1,
      timestamp: '2026-07-25T12:00:00.000Z',
      runId: 'event-contract-run'
    }
  ]);

  const throwingEmitter = createRunEventEmitter('throwing-observer', () => {
    throw new Error('Observer must be isolated.');
  });

  assert.doesNotThrow(() => {
    throwingEmitter({
      type: 'run-completed',
      message: 'CheckQuest run completed.',
      outcome: 'completed',
      inspectedPageCount: 1,
      findingCount: 0,
      confirmedFindingCount: 0,
      reviewFindingCount: 0,
      technicalObservationCount: 0,
      occurrenceCount: 0
    });
  });

  const unexpectedAsyncObserver = (() =>
    Promise.reject(
      new Error('Rejected observer promise must be isolated.')
    )) as unknown as RunEventObserver;
  const rejectingEmitter = createRunEventEmitter('rejecting-observer', unexpectedAsyncObserver);

  rejectingEmitter({
    type: 'run-completed',
    message: 'CheckQuest run completed.',
    outcome: 'completed',
    inspectedPageCount: 1,
    findingCount: 0,
    confirmedFindingCount: 0,
    reviewFindingCount: 0,
    technicalObservationCount: 0,
    occurrenceCount: 0
  });
  await Promise.resolve();
  await Promise.resolve();

  const modelEvents: RunEvent[] = [];
  const emitModelRunEvent = createRunEventEmitter(
    'model-event-run',
    event => {
      modelEvents.push(event);
    },
    () => new Date('2026-07-25T12:01:00.000Z')
  );
  let modelAttempts = 0;

  const modelResult = await runGeminiRequest(
    'contract operation',
    async () => {
      modelAttempts += 1;

      if (modelAttempts === 1) {
        throw Object.assign(new Error('raw SDK body with private-token'), {
          status: 503
        });
      }

      return 'success';
    },
    {
      wait: async () => undefined,
      random: () => 0,
      onEvent: createModelRequestRunEventObserver(emitModelRunEvent)
    }
  );

  assert.equal(modelResult, 'success');
  assert.deepEqual(
    modelEvents.map(event => event.type),
    [
      'model-request-started',
      'model-request-retrying',
      'model-request-started',
      'model-request-completed'
    ]
  );

  const retryEvent = modelEvents[1];

  assert.equal(retryEvent?.type, 'model-request-retrying');

  if (retryEvent?.type === 'model-request-retrying') {
    assert.equal(retryEvent.statusCode, 503);
    assert.equal(retryEvent.attempt, 1);
    assert.equal(retryEvent.maxAttempts, 2);
  }

  const failure = new CheckQuestError('NAVIGATION', 'Safe navigation failure.', {
    phase: 'agent-navigation',
    pageNumber: 2,
    navigationStep: 1,
    requestedUrl: 'https://user:password@example.test/path?token=private-token#secret',
    finalUrl: 'https://example.test/final?session=private-token',
    cause: new Error('private cause content')
  });

  emitModelRunEvent(createRunFailureEvent(failure));

  const failedEvent = modelEvents.at(-1);

  assert.equal(failedEvent?.type, 'run-failed');

  if (failedEvent?.type === 'run-failed') {
    assert.equal(failedEvent.requestedUrl, 'https://example.test/path');
    assert.equal(failedEvent.finalUrl, 'https://example.test/final');
    assert.equal('cause' in failedEvent, false);
  }

  const serializedEvents = JSON.stringify([...events, ...modelEvents]);

  for (const forbiddenValue of [
    'password',
    'private-token',
    'private cause content',
    'raw SDK body',
    'GEMINI_API_KEY',
    'GOOGLE_API_KEY'
  ]) {
    assert.equal(serializedEvents.includes(forbiddenValue), false);
  }

  const validationEvents: RunEvent[] = [];

  await assert.rejects(
    runSite({
      site: {
        id: 'invalid-event-input',
        name: 'Invalid event input',
        startUrl: 'file:///private/path',
        allowedHosts: ['example.test'],
        maxPages: 1,
        maxAgentSteps: 0,
        maxExploratoryStepsPerPage: 0,
        allowFormSubmission: false
      },
      runId: '../unsafe-run-id',
      onEvent: event => {
        validationEvents.push(event);
      }
    }),
    error => error instanceof CheckQuestError && error.code === 'CONFIGURATION'
  );
  assert.deepEqual(
    validationEvents.map(event => ({
      type: event.type,
      runId: event.runId
    })),
    [
      {
        type: 'run-failed',
        runId: 'unavailable'
      }
    ]
  );

  console.log('Stage 8D.2 run event contract and observer-isolation checks passed.');
}

main().catch((error: unknown) => {
  console.error('Stage 8D.2 run event checks failed.', error);
  process.exitCode = 1;
});
