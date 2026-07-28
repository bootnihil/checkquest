import assert from 'node:assert/strict';

import {
  preflightTargetReachability,
  resolveSafeCanonicalTarget
} from './application/preflight-target-reachability';
import {
  CheckQuestError
} from './errors/checkquest-error';

async function main():
  Promise<void> {
  const signal =
    new AbortController()
      .signal;
  let receivedTarget:
    string | undefined;
  let receivedSignal:
    AbortSignal | undefined;
  const accepted =
    await preflightTargetReachability(
      {
        target:
          'http://127.0.0.1:3000/',
        signal
      },
      {
        probe:
          async input => {
            receivedTarget =
              input.target;
            receivedSignal =
              input.signal;

            return {
              finalUrl:
                input.target
            };
          }
      }
    );

  assert.deepEqual(
    accepted,
    {
      accepted:
        true,
      target:
        'http://127.0.0.1:3000/'
    }
  );
  assert.equal(
    receivedTarget,
    'http://127.0.0.1:3000/'
  );
  assert.equal(
    receivedSignal,
    signal
  );

  const canonicalCases:
    ReadonlyArray<
      readonly [
        string,
        string,
        string | null
      ]
    > = [
      [
        'https://example.com/',
        'https://www.example.com/',
        'https://www.example.com/'
      ],
      [
        'https://www.example.com/',
        'https://example.com/path',
        'https://example.com/path'
      ],
      [
        'http://example.com/',
        'https://www.example.com/',
        'https://www.example.com/'
      ],
      [
        'https://example.com/',
        'https://app.example.com/',
        null
      ],
      [
        'https://app.example.com/',
        'https://shop.example.com/',
        null
      ],
      [
        'https://example.com/',
        'https://unrelated.example.net/',
        null
      ],
      [
        'https://example.com:444/',
        'https://www.example.com:445/',
        null
      ],
      [
        'https://example.com/',
        'http://www.example.com/',
        null
      ]
    ];

  for (
    const [
      requestedTarget,
      finalTarget,
      expected
    ] of canonicalCases
  ) {
    assert.equal(
      resolveSafeCanonicalTarget(
        requestedTarget,
        finalTarget
      ),
      expected
    );
  }

  assert.deepEqual(
    await preflightTargetReachability(
      {
        target:
          'https://example.com/'
      },
      {
        probe:
          async () => ({
            finalUrl:
              'https://www.example.com/'
          })
      }
    ),
    {
      accepted:
        true,
      target:
        'https://www.example.com/'
    }
  );

  assert.deepEqual(
    await preflightTargetReachability(
      {
        target:
          'https://example.com/'
      },
      {
        probe:
          async () => ({
            finalUrl:
              'https://app.example.com/'
          })
      }
    ),
    {
      accepted:
        false,
      message:
        'Could not reach this website. Check the address and try again.'
    }
  );

  const providerDetail =
    'net::ERR_NAME_NOT_RESOLVED private-host.invalid';
  const rejected =
    await preflightTargetReachability(
      {
        target:
          'https://missing.example/'
      },
      {
        probe:
          async () => {
            throw new Error(
              providerDetail
            );
          }
      }
    );

  assert.deepEqual(
    rejected,
    {
      accepted:
        false,
      message:
        'Could not reach this website. Check the address and try again.'
    }
  );
  assert.equal(
    JSON.stringify(
      rejected
    ).includes(
      providerDetail
    ),
    false
  );

  const cancellation =
    new AbortController();
  cancellation.abort();

  await assert.rejects(
    preflightTargetReachability(
      {
        target:
          'https://example.com/',
        signal:
          cancellation.signal
      },
      {
        probe:
          async () => {
            throw new Error(
              'Synthetic interrupted navigation.'
            );
          }
      }
    ),
    error =>
      error instanceof
        CheckQuestError &&
      error.code ===
        'CANCELLED' &&
      error.phase ===
        'target-reachability-preflight'
  );

  console.log(
    'Target reachability preflight checks passed.'
  );
}

void main();
