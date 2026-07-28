import {
  probeTargetReachability,
  type ProbeTargetReachabilityInput,
  type ProbeTargetReachabilityResult
} from '../browser/probe-target-reachability';
import {
  CheckQuestError
} from '../errors/checkquest-error';
import {
  normalizeRunCancellation
} from '../errors/run-cancellation';

export type TargetReachabilityPreflightResult =
  | {
      accepted:
        true;
      target:
        string;
    }
  | {
      accepted:
        false;
      message:
        string;
    };

export interface PreflightTargetReachabilityInput {
  target:
    string;
  signal?:
    AbortSignal;
}

export interface PreflightTargetReachabilityDependencies {
  probe?:
    (
      input:
        ProbeTargetReachabilityInput
    ) => Promise<
      ProbeTargetReachabilityResult
    >;
}

function getEffectivePort(
  url:
    URL
): string {
  if (
    url.port.length >
      0
  ) {
    return url.port;
  }

  return url.protocol ===
    'https:'
    ? '443'
    : '80';
}

function isNarrowCanonicalHostnamePair(
  requestedHostname:
    string,
  finalHostname:
    string
): boolean {
  return (
    requestedHostname ===
      finalHostname ||
    `www.${requestedHostname}` ===
      finalHostname ||
    requestedHostname ===
      `www.${finalHostname}`
  );
}

export function resolveSafeCanonicalTarget(
  requestedTarget:
    string,
  finalTarget:
    string
): string | null {
  let requestedUrl:
    URL;
  let finalUrl:
    URL;

  try {
    requestedUrl =
      new URL(
        requestedTarget
      );
    finalUrl =
      new URL(
        finalTarget
      );
  } catch {
    return null;
  }

  if (
    ![
      'http:',
      'https:'
    ].includes(
      requestedUrl.protocol
    ) ||
    ![
      'http:',
      'https:'
    ].includes(
      finalUrl.protocol
    ) ||
    finalUrl.username.length >
      0 ||
    finalUrl.password.length >
      0 ||
    !isNarrowCanonicalHostnamePair(
      requestedUrl.hostname
        .toLowerCase(),
      finalUrl.hostname
        .toLowerCase()
    )
  ) {
    return null;
  }

  const sameProtocol =
    requestedUrl.protocol ===
      finalUrl.protocol;
  const httpUpgrade =
    requestedUrl.protocol ===
      'http:' &&
    finalUrl.protocol ===
      'https:';
  const sameEffectivePort =
    getEffectivePort(
      requestedUrl
    ) ===
    getEffectivePort(
      finalUrl
    );
  const defaultHttpUpgrade =
    getEffectivePort(
      requestedUrl
    ) ===
      '80' &&
    getEffectivePort(
      finalUrl
    ) ===
      '443';

  if (
    !(
      (
        sameProtocol &&
        sameEffectivePort
      ) ||
      (
        httpUpgrade &&
        (
          sameEffectivePort ||
          defaultHttpUpgrade
        )
      )
    )
  ) {
    return null;
  }

  return finalUrl
    .toString();
}

export async function preflightTargetReachability(
  input:
    PreflightTargetReachabilityInput,
  dependencies:
    PreflightTargetReachabilityDependencies =
      {}
): Promise<
  TargetReachabilityPreflightResult
> {
  const probe =
    dependencies.probe ??
    probeTargetReachability;

  try {
    const probeResult =
      await probe({
      target:
        input.target,
      signal:
        input.signal
    });

    const safeTarget =
      resolveSafeCanonicalTarget(
        input.target,
        probeResult.finalUrl
      );

    if (
      safeTarget ===
        null
    ) {
      return {
        accepted:
          false,
        message:
          'Could not reach this website. Check the address and try again.'
      };
    }

    return {
      accepted:
        true,
      target:
        safeTarget
    };
  } catch (
    error:
      unknown
  ) {
    const cancellationError =
      normalizeRunCancellation(
        error,
        input.signal,
        undefined,
        'target-reachability-preflight'
      );

    if (
      cancellationError instanceof
        CheckQuestError &&
      cancellationError.code ===
        'CANCELLED'
    ) {
      throw cancellationError;
    }

    return {
      accepted:
        false,
      message:
        'Could not reach this website. Check the address and try again.'
    };
  }

}
