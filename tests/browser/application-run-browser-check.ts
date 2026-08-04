import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startCheckQuest, type CheckQuestRun } from '../../agent/application/start-checkquest';
import { preflightTargetReachability } from '../../agent/application/preflight-target-reachability';
import { CheckQuestError } from '../../agent/errors/checkquest-error';
import type { RunEvent } from '../../agent/run/run-event';
import { listenOnBrowserSafeLoopbackPort } from '../support/listen-on-browser-safe-loopback-port';

const allowedHost = '127.0.0.1';

function createFixtureServer(): Server {
  return createServer((request, response) => {
    if (request.url === '/preflight-hang') {
      return;
    }

    if (request.url === '/preflight-redirect') {
      response.writeHead(302, {
        location: '/success'
      });
      response.end();
      return;
    }

    if (request.url === '/preflight-forbidden') {
      response.writeHead(403, {
        'content-type': 'text/html; charset=utf-8'
      });
      response.end('<!doctype html><title>Forbidden but reachable</title>');
      return;
    }

    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8'
    });
    response.end(
      `<!doctype html>
<html lang="en">
  <head><title>G1 fixture</title></head>
  <body>
    <h1>${request.url === '/cancel' ? 'Cancellation' : 'Success'}</h1>
  </body>
</html>`
    );
  });
}

async function waitForNoConnections(server: Server): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const connectionCount = await new Promise<number>((resolve, reject) => {
      server.getConnections((error, count) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(count);
      });
    });

    if (connectionCount === 0) {
      return;
    }

    await new Promise<void>(resolve => {
      setTimeout(resolve, 20);
    });
  }

  assert.fail('The browser connection remained open after cancellation.');
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close(error => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function main(): Promise<void> {
  const server = createFixtureServer();

  await listenOnBrowserSafeLoopbackPort(server, 'G1 application boundary fixture');

  const address = server.address();

  assert.ok(address !== null && typeof address !== 'string');

  const baseUrl = `http://${allowedHost}:${address.port}`;
  let reportDirectoryPath: string | undefined;
  const originalGeminiModel = process.env.GEMINI_MODEL;
  const processModelSentinel = 'PROCESS_MODEL_MUST_NOT_CHANGE';

  process.env.GEMINI_MODEL = processModelSentinel;

  try {
    assert.deepEqual(
      await preflightTargetReachability({
        target: `${baseUrl}/success`
      }),
      {
        accepted: true,
        target: `${baseUrl}/success`
      }
    );
    assert.deepEqual(
      await preflightTargetReachability({
        target: `${baseUrl}/preflight-redirect`
      }),
      {
        accepted: true,
        target: `${baseUrl}/success`
      }
    );
    assert.deepEqual(
      await preflightTargetReachability({
        target: `${baseUrl}/preflight-forbidden`
      }),
      {
        accepted: true,
        target: `${baseUrl}/preflight-forbidden`
      }
    );

    const refusedServer = createServer();

    await listenOnBrowserSafeLoopbackPort(refusedServer, 'target reachability refusal fixture');
    const refusedAddress = refusedServer.address();

    assert.ok(refusedAddress !== null && typeof refusedAddress !== 'string');
    const refusedUrl = `http://${allowedHost}:${refusedAddress.port}/`;

    await closeServer(refusedServer);

    assert.deepEqual(
      await preflightTargetReachability({
        target: refusedUrl
      }),
      {
        accepted: false,
        message: 'Could not reach this website. Check the address and try again.'
      }
    );

    const targetPreflightCancellation = new AbortController();
    const cancellableTargetPreflight = preflightTargetReachability({
      target: `${baseUrl}/preflight-hang`,
      signal: targetPreflightCancellation.signal
    });

    setTimeout(() => {
      targetPreflightCancellation.abort();
    }, 100);

    await assert.rejects(
      cancellableTargetPreflight,
      error => error instanceof CheckQuestError && error.code === 'CANCELLED'
    );
    await waitForNoConnections(server);

    const credential = 'G1_TRANSIENT_CREDENTIAL_SENTINEL';
    const model = 'g1-model-override';
    const successEvents: RunEvent[] = [];
    const observedModels: Array<string | undefined> = [];
    const observedCredentials: Array<string | undefined> = [];
    const successfulRun: CheckQuestRun = startCheckQuest({
      target: `${baseUrl}/success`,
      budgets: {
        pages: 1,
        navigationSteps: 0,
        investigationStepsPerPage: 0
      },
      credentials: {
        geminiApiKey: credential
      },
      model,
      onEvent: event => {
        successEvents.push(event);

        if (event.type === 'run-completed') {
          successfulRun.cancel();
          successfulRun.cancel();
        }

        throw new Error('Subscriber failures must remain isolated.');
      },
      dependencies: {
        analyzePageForQa: async (_input, options) => {
          observedModels.push(options?.model);
          observedCredentials.push(options?.geminiApiKey);

          return {
            findings: [],
            summary: credential
          };
        }
      }
    });

    const successResult = await successfulRun.result;
    reportDirectoryPath = successResult.reportDirectoryPath;

    successfulRun.cancel();
    successfulRun.cancel();

    const startedEvent = successEvents.find(event => event.type === 'run-started');

    assert.equal(startedEvent?.type === 'run-started' ? startedEvent.pageBudget : null, 1);
    assert.equal(startedEvent?.type === 'run-started' ? startedEvent.navigationBudget : null, 0);
    assert.deepEqual(observedModels, [model]);
    assert.equal(process.env.GEMINI_MODEL, processModelSentinel);
    assert.deepEqual(observedCredentials, [credential]);
    assert.equal(successEvents.at(-1)?.type, 'run-completed');

    assert.equal((await stat(successResult.reportDirectoryPath)).isDirectory(), true);
    assert.equal((await stat(successResult.jsonReportPath)).isFile(), true);
    assert.equal((await stat(successResult.markdownReportPath)).isFile(), true);

    assert.equal(
      JSON.stringify({
        result: successResult,
        events: successEvents
      }).includes(credential),
      false
    );
    assert.equal(
      (await readFile(successResult.jsonReportPath, 'utf8')).includes(credential),
      false
    );
    assert.equal(
      (await readFile(successResult.markdownReportPath, 'utf8')).includes(credential),
      false
    );

    const privateFailureEvents: RunEvent[] = [];
    const privateFailureRun = startCheckQuest({
      target: `${baseUrl}/private-failure`,
      budgets: {
        pages: 1,
        navigationSteps: 0,
        investigationStepsPerPage: 0
      },
      credentials: {
        geminiApiKey: credential
      },
      onEvent: event => {
        privateFailureEvents.push(event);
      },
      dependencies: {
        analyzePageForQa: async () => {
          throw new CheckQuestError('MODEL', `Synthetic model failure: ${credential}`, {
            phase: 'synthetic-model',
            cause: new Error(`Nested SDK cause: ${credential}`)
          });
        }
      }
    });
    let privateFailure: unknown;

    try {
      await privateFailureRun.result;
    } catch (error: unknown) {
      privateFailure = error;
    }

    assert.ok(privateFailure instanceof CheckQuestError);
    assert.equal(privateFailure.code, 'MODEL');
    assert.equal(privateFailure.cause, undefined);
    assert.equal(
      JSON.stringify({
        error: {
          ...privateFailure,
          message: privateFailure.message,
          cause: privateFailure.cause
        },
        events: privateFailureEvents
      }).includes(credential),
      false
    );
    assert.equal(
      privateFailureEvents.some(event => event.type === 'run-completed'),
      false
    );

    await waitForNoConnections(server);

    const persistenceDirectory = await mkdtemp(join(tmpdir(), 'checkquest-g1-persistence-'));
    const originalWorkingDirectory = process.cwd();
    const persistenceEvents: RunEvent[] = [];
    let persistenceFailure: unknown;

    try {
      await writeFile(
        join(persistenceDirectory, 'agent-results'),
        'This file deliberately blocks report-directory creation.',
        'utf8'
      );
      process.chdir(persistenceDirectory);

      const persistenceRun = startCheckQuest({
        target: `${baseUrl}/persistence-failure`,
        budgets: {
          pages: 1,
          navigationSteps: 0,
          investigationStepsPerPage: 0
        },
        credentials: {
          geminiApiKey: credential
        },
        onEvent: event => {
          persistenceEvents.push(event);
        },
        dependencies: {
          analyzePageForQa: async () => ({
            findings: [],
            summary: 'Persistence failure fixture.'
          })
        }
      });

      try {
        await persistenceRun.result;
      } catch (error: unknown) {
        persistenceFailure = error;
      }
    } finally {
      process.chdir(originalWorkingDirectory);
      await rm(persistenceDirectory, {
        recursive: true,
        force: true
      });
    }

    assert.ok(persistenceFailure instanceof CheckQuestError);
    assert.equal(persistenceFailure.code, 'REPORTING');
    assert.equal(persistenceFailure.cause, undefined);
    assert.equal(
      persistenceEvents.some(event => event.type === 'run-completed'),
      false
    );
    const finalPersistenceEvent = persistenceEvents.at(-1);

    assert.equal(
      finalPersistenceEvent?.type === 'run-failed' ? finalPersistenceEvent.code : null,
      'REPORTING'
    );

    await waitForNoConnections(server);

    let analysisStarted: () => void = () => undefined;
    const analysisStartedPromise = new Promise<void>(resolve => {
      analysisStarted = resolve;
    });
    const cancellationEvents: RunEvent[] = [];
    const cancelledRun = startCheckQuest({
      target: `${baseUrl}/cancel`,
      budgets: {
        pages: 1,
        navigationSteps: 0,
        investigationStepsPerPage: 0
      },
      credentials: {
        geminiApiKey: credential
      },
      onEvent: event => {
        cancellationEvents.push(event);
      },
      dependencies: {
        analyzePageForQa: async (_input, options) => {
          analysisStarted();

          await new Promise<never>((_resolve, reject) => {
            options?.signal?.addEventListener(
              'abort',
              () => {
                reject(new Error('Synthetic cancellation interruption.'));
              },
              {
                once: true
              }
            );
          });

          throw new Error('Unreachable analysis completion.');
        }
      }
    });

    await analysisStartedPromise;
    cancelledRun.cancel();

    await assert.rejects(
      cancelledRun.result,
      error => error instanceof CheckQuestError && error.code === 'CANCELLED'
    );
    assert.equal(
      cancellationEvents.some(event => event.type === 'run-completed'),
      false
    );
    const finalCancellationEvent = cancellationEvents.at(-1);

    assert.equal(finalCancellationEvent?.type, 'run-failed');
    assert.equal(
      finalCancellationEvent?.type === 'run-failed' ? finalCancellationEvent.code : null,
      'CANCELLED'
    );

    await waitForNoConnections(server);

    console.log(
      'G1 application success, persistence, event isolation, cancellation, and target reachability browser checks passed.'
    );
  } finally {
    if (reportDirectoryPath !== undefined) {
      await rm(reportDirectoryPath, {
        recursive: true,
        force: true
      });
    }

    await closeServer(server);

    if (originalGeminiModel === undefined) {
      delete process.env.GEMINI_MODEL;
    } else {
      process.env.GEMINI_MODEL = originalGeminiModel;
    }
  }
}

main().catch((error: unknown) => {
  console.error('G1 application browser check failed.', error);
  process.exitCode = 1;
});
