import assert from 'node:assert/strict';
import { GoogleGenAI } from '@google/genai';
import { runGeminiRequest, isRetryableGeminiError } from '../../agent/ai/run-gemini-request';
import { aiConfig } from '../../agent/config/ai-config';
import { CheckQuestError, formatPublicError } from '../../agent/errors/checkquest-error';
import { sanitizeApplicationError } from '../../agent/application/sanitize-application-boundary';

export async function checkGeminiTimeouts(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const testKeepAlive = originalSetTimeout(() => assert.fail('Offline timeout test hung.'), 10_000);
  const key = 'PRIVATE_TIMEOUT_KEY_SENTINEL';
  const ai = new GoogleGenAI({ apiKey: key });
  let fetchCount = 0;
  let onFetch: (() => void) | undefined;
  let succeed = false;
  let status: number | undefined;
  let unrelatedAbort = false;
  const sdkRequest = (timeout: number, signal?: AbortSignal) =>
    ai.models.generateContent({
      model: 'offline-test',
      contents: 'offline',
      config: {
        abortSignal: signal,
        httpOptions: { timeout, retryOptions: { attempts: 1 } }
      }
    });
  try {
    globalThis.fetch = async (_input, init) => {
      fetchCount += 1;
      const signal = init?.signal;
      assert.ok(signal);
      onFetch?.();
      if (unrelatedAbort) {
        throw new DOMException(key, 'AbortError');
      }
      if (status !== undefined) {
        return new Response(JSON.stringify({ error: { code: status, message: key } }), { status });
      }
      if (succeed) {
        return new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] })
        );
      }
      return new Promise<Response>((_resolve, reject) => {
        const aborted = () => reject(signal.reason);
        if (signal.aborted) {
          aborted();
        } else {
          signal.addEventListener('abort', aborted, { once: true });
        }
      });
    };
    let sdkFailure: unknown;
    try {
      await sdkRequest(5);
      assert.fail('The SDK deadline must abort the mocked fetch.');
    } catch (error) {
      sdkFailure = error;
    }
    assert.ok(sdkFailure instanceof Error);
    assert.ok(sdkFailure instanceof DOMException);
    assert.equal(sdkFailure.name, 'AbortError');
    assert.equal(sdkFailure.code, 20);
    assert.equal(sdkFailure.cause, undefined);
    assert.equal(isRetryableGeminiError(sdkFailure), false);
    console.log(
      'Installed SDK deadline:',
      sdkFailure.name,
      'code:',
      sdkFailure.code,
      'cause:',
      sdkFailure.cause
    );

    // Accelerate only request deadlines, exercising the real SDK transport and timers.
    globalThis.setTimeout = ((callback: () => void, delay?: number, ...args: unknown[]) =>
      originalSetTimeout(
        callback,
        delay === aiConfig.requestTimeoutMs ? 5 : delay,
        ...args
      )) as typeof setTimeout;
    fetchCount = 0;
    const delays: number[] = [];
    const events: string[] = [];
    await assert.rejects(
      runGeminiRequest(
        'offline SDK deadline',
        options => sdkRequest(options.timeout_ms, options.abortSignal),
        {
          wait: async delay => {
            delays.push(delay);
          },
          random: () => 0,
          onEvent: event => {
            events.push(event.type);
          }
        }
      ),
      error => {
        assert.ok(error instanceof CheckQuestError);
        assert.equal(error.code, 'MODEL');
        assert.equal(error.retryable, true);
        assert.match(error.message, /did not respond within 30 seconds/);
        const publicError = sanitizeApplicationError(error, 'offline-timeout', key);
        assert.equal(publicError.cause, undefined);
        assert.equal(formatPublicError(publicError).includes(key), false);
        return true;
      }
    );
    assert.equal(fetchCount, aiConfig.maxRetries + 1);
    assert.deepEqual(delays, [aiConfig.baseRetryDelayMs]);
    assert.deepEqual(events, ['started', 'retrying', 'started']);

    fetchCount = 0;
    events.length = 0;
    const response = await runGeminiRequest(
      'deadline then success',
      options => sdkRequest(options.timeout_ms, options.abortSignal),
      {
        wait: async () => {
          succeed = true;
        },
        onEvent: event => {
          events.push(event.type);
        }
      }
    );
    assert.equal(response.text, 'ok');
    assert.equal(fetchCount, 2);
    assert.deepEqual(events, ['started', 'retrying', 'started', 'completed']);

    succeed = false;
    fetchCount = 0;
    const cancellation = new AbortController();
    onFetch = () => cancellation.abort();
    await assert.rejects(
      runGeminiRequest(
        'user cancellation',
        options => sdkRequest(options.timeout_ms, options.abortSignal),
        {
          signal: cancellation.signal,
          wait: async () => {
            assert.fail('Cancellation cannot retry.');
          }
        }
      ),
      error =>
        error instanceof CheckQuestError && error.code === 'CANCELLED' && error.retryable === false
    );
    assert.equal(fetchCount, 1);

    const beforeRequestCancellation = new AbortController();
    await assert.rejects(
      runGeminiRequest(
        'cancel on started',
        async () => {
          assert.fail('A cancelled request must not reach the SDK.');
        },
        {
          signal: beforeRequestCancellation.signal,
          onEvent: event => {
            if (event.type === 'started') {
              beforeRequestCancellation.abort();
            }
          }
        }
      ),
      error => error instanceof CheckQuestError && error.code === 'CANCELLED'
    );

    onFetch = undefined;
    fetchCount = 0;
    const backoffCancellation = new AbortController();
    await assert.rejects(
      runGeminiRequest(
        'backoff cancellation',
        options => sdkRequest(options.timeout_ms, options.abortSignal),
        {
          signal: backoffCancellation.signal,
          wait: async () => {
            backoffCancellation.abort();
          }
        }
      ),
      error => error instanceof CheckQuestError && error.code === 'CANCELLED'
    );
    assert.equal(fetchCount, 1);

    fetchCount = 0;
    status = 503;
    await assert.rejects(
      runGeminiRequest(
        'offline SDK 503',
        options => sdkRequest(options.timeout_ms, options.abortSignal),
        {
          wait: async () => undefined,
          random: () => 0
        }
      ),
      error =>
        error instanceof CheckQuestError &&
        error.code === 'MODEL' &&
        error.statusCode === 503 &&
        error.retryable === true &&
        /transient server error/.test(error.message)
    );
    assert.equal(fetchCount, aiConfig.maxRetries + 1);
    status = undefined;
    unrelatedAbort = true;
    fetchCount = 0;
    await assert.rejects(
      runGeminiRequest(
        'unrelated abort',
        options => sdkRequest(options.timeout_ms, options.abortSignal),
        {
          wait: async () => {
            assert.fail('Unowned abort cannot retry.');
          }
        }
      ),
      error =>
        error instanceof CheckQuestError &&
        error.retryable === false &&
        !formatPublicError(error).includes(key)
    );
    assert.equal(fetchCount, 1);

    for (const fail of [false, true]) {
      const cancelled = new AbortController();
      const completionEvents: string[] = [];
      await assert.rejects(
        runGeminiRequest(
          'cancellation wins at completion',
          async options => {
            await new Promise<void>(resolve =>
              options.abortSignal?.addEventListener(
                'abort',
                () => {
                  cancelled.abort();
                  resolve();
                },
                { once: true }
              )
            );
            if (fail) {
              throw new DOMException(key, 'AbortError');
            }
            return 'late success';
          },
          {
            signal: cancelled.signal,
            wait: async () => {
              assert.fail('Cancellation cannot retry.');
            },
            onEvent: event => {
              completionEvents.push(event.type);
            }
          }
        ),
        error => error instanceof CheckQuestError && error.code === 'CANCELLED'
      );
      assert.deepEqual(completionEvents, ['started']);
    }

    let explicitCancellationAttempts = 0;
    await assert.rejects(
      runGeminiRequest(
        'explicit cancellation after deadline',
        async options => {
          explicitCancellationAttempts += 1;
          await new Promise<void>(resolve =>
            options.abortSignal?.addEventListener('abort', () => resolve(), { once: true })
          );
          throw new CheckQuestError('CANCELLED', 'Explicit cancellation.', { retryable: false });
        },
        {
          wait: async () => {
            assert.fail('Explicit cancellation cannot retry.');
          }
        }
      ),
      error =>
        error instanceof CheckQuestError && error.code === 'CANCELLED' && error.retryable === false
    );
    assert.equal(explicitCancellationAttempts, 1);
  } finally {
    clearTimeout(testKeepAlive);
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  }
}

if (require.main === module) {
  checkGeminiTimeouts()
    .then(() => console.log('Installed SDK timeout checks passed.'))
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
