import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { startCheckQuest } from '../../agent/application/start-checkquest';
import { CheckQuestError } from '../../agent/errors/checkquest-error';
import { createRunCancelledError } from '../../agent/errors/run-cancellation';
import {
  completeRequiredCleanup,
  getSecondaryCleanupError
} from '../../agent/errors/required-cleanup';
import type { RunEvent } from '../../agent/run/run-event';

async function main(): Promise<void> {
  const events: RunEvent[] = [];
  const run = startCheckQuest({
    target: 'not-a-configured-site-or-url',
    budgets: {
      pages: 2,
      navigationSteps: 1,
      investigationStepsPerPage: 0
    },
    credentials: {
      geminiApiKey: 'APPLICATION_KEY_MUST_NOT_LEAK'
    },
    model: 'application-model-override',
    onEvent: event => {
      events.push(event);
    }
  });

  assert.equal(typeof run.cancel, 'function');

  let failure: unknown;

  try {
    await run.result;
  } catch (error: unknown) {
    failure = error;
  }

  assert.ok(failure instanceof CheckQuestError);
  assert.equal(failure.code, 'CONFIGURATION');
  assert.deepEqual(
    events.map(event => event.type),
    ['run-failed']
  );
  assert.equal(events[0]?.type === 'run-failed' ? events[0].code : null, 'CONFIGURATION');
  assert.equal(
    JSON.stringify({
      events,
      failure: {
        code: failure.code,
        message: failure.message
      }
    }).includes('APPLICATION_KEY_MUST_NOT_LEAK'),
    false
  );

  const preStartEvents: RunEvent[] = [];
  const preStartCancellation = startCheckQuest({
    target: 'http://127.0.0.1:1/',
    onEvent: event => {
      preStartEvents.push(event);
    }
  });

  preStartCancellation.cancel();
  preStartCancellation.cancel();

  await assert.rejects(
    preStartCancellation.result,
    error => error instanceof CheckQuestError && error.code === 'CANCELLED'
  );
  assert.deepEqual(
    preStartEvents.map(event => event.type),
    ['run-failed']
  );

  const cancellationError = createRunCancelledError('cleanup-precedence', 'test-cancellation');
  const cleanupCause = new Error('Synthetic cleanup failure.');

  await completeRequiredCleanup(
    cancellationError,
    [
      () => {
        throw cleanupCause;
      }
    ],
    {
      phase: 'test-cleanup',
      runId: 'cleanup-precedence'
    }
  );

  assert.equal(cancellationError.code, 'CANCELLED');
  assert.equal(getSecondaryCleanupError(cancellationError)?.code, 'CLEANUP');

  const cliSource = await readFile(
    new URL('../../agent/run-site-agent.ts', import.meta.url),
    'utf8'
  );

  assert.equal(cliSource.includes('startCheckQuest'), true);
  assert.equal(cliSource.includes('runSite('), false);
  assert.equal(cliSource.includes('persistSiteAgentReport'), false);

  const applicationSource = await readFile(
    new URL('../../agent/application/start-checkquest.ts', import.meta.url),
    'utf8'
  );
  const runSiteSource = await readFile(
    new URL('../../agent/run/run-site.ts', import.meta.url),
    'utf8'
  );

  for (const forbiddenApplicationCoupling of [
    '/cli/',
    'process.env',
    'console.',
    '@google/genai'
  ]) {
    assert.equal(applicationSource.includes(forbiddenApplicationCoupling), false);
  }
  assert.equal(cliSource.includes('writeJsonReport'), false);
  assert.equal(cliSource.includes('writeMarkdownReport'), false);
  assert.equal(cliSource.includes("process.once(\n    'SIGINT'"), false);
  assert.equal(runSiteSource.includes('requireGeminiApiKey'), true);
  for (const forbiddenRemotePreflight of [
    'probeGeminiCredentials',
    'probeTargetReachability',
    'preflightDesktopGeminiCredentials',
    'preflightDesktopTargetReachability'
  ]) {
    assert.equal(runSiteSource.includes(forbiddenRemotePreflight), false);
  }

  const exploratoryQaAnalyzerSource = await readFile(
    new URL('../../agent/analysis/analyze-page-for-qa.ts', import.meta.url),
    'utf8'
  );
  const pageContentExtractorSource = await readFile(
    new URL('../../agent/browser/extract-page-content.ts', import.meta.url),
    'utf8'
  );
  const reportTypesSource = await readFile(
    new URL('../../agent/reporting/report-types.ts', import.meta.url),
    'utf8'
  );

  assert.equal(exploratoryQaAnalyzerSource.includes("from './exploratory-qa-schema'"), true);
  assert.equal(pageContentExtractorSource.includes("from './extracted-page-content'"), true);
  assert.equal(pageContentExtractorSource.includes('export interface'), false);
  assert.deepEqual(
    [...reportTypesSource.matchAll(/^export (?:interface|type) (\w+)/gm)].map(match => match[1]),
    ['SiteAgentReport']
  );

  for (const runtimeOwner of [
    '../../agent/exploration/run-site-exploration.ts',
    '../../agent/findings/current-finding-adapters.ts',
    '../../agent/inspection/inspect-page.ts'
  ]) {
    const source = await readFile(new URL(runtimeOwner, import.meta.url), 'utf8');

    assert.equal(source.includes('report-types'), false);
  }

  console.log('G1 application run contract and thin CLI checks passed.');
}

main().catch((error: unknown) => {
  console.error('G1 application run contract check failed.', error);
  process.exitCode = 1;
});
