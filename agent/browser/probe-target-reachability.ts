import {
  chromium
} from '@playwright/test';

import {
  getSiteConfig
} from '../sites';
import {
  normalizeRunCancellation,
  throwIfRunCancelled
} from '../errors/run-cancellation';
import {
  runWithRequiredCleanup
} from '../errors/required-cleanup';
import {
  gotoWithCancellation
} from './goto-with-cancellation';

const targetReachabilityTimeoutMs =
  15_000;

export interface ProbeTargetReachabilityInput {
  target:
    string;
  signal?:
    AbortSignal;
}

export interface ProbeTargetReachabilityResult {
  finalUrl:
    string;
}

export async function probeTargetReachability(
  input:
    ProbeTargetReachabilityInput
): Promise<
  ProbeTargetReachabilityResult
> {
  const phase =
    'target-reachability-preflight';
  const site =
    getSiteConfig(
      input.target
    );

  throwIfRunCancelled(
    input.signal,
    undefined,
    phase
  );

  let browser:
    Awaited<
      ReturnType<
        typeof chromium.launch
      >
    >;

  try {
    browser =
      await chromium.launch({
        headless:
          true
      });
  } catch (
    error:
      unknown
  ) {
    throw normalizeRunCancellation(
      error,
      input.signal,
      undefined,
      phase
    );
  }

  return runWithRequiredCleanup(
    async () => {
      throwIfRunCancelled(
        input.signal,
        undefined,
        phase
      );

      const page =
        await browser.newPage({
          serviceWorkers:
            'block'
        });

      await gotoWithCancellation(
        page,
        site.startUrl,
        {
          waitUntil:
            'domcontentloaded',
          timeout:
            targetReachabilityTimeoutMs
        },
        {
          signal:
            input.signal,
          phase
        }
      );

      throwIfRunCancelled(
        input.signal,
        undefined,
        phase
      );

      return {
        finalUrl:
          page.url()
      };
    },
    [
      () =>
        browser.close()
    ],
    {
      phase:
        'target-reachability-browser-close'
    }
  );
}
