import {
  CheckQuestError
} from './checkquest-error';
import {
  getSecondaryCleanupError
} from './required-cleanup';

export interface DeveloperDiagnosticEnvironment {
  CHECKQUEST_DEBUG?:
    string;
}

export interface DeveloperDiagnosticOptions {
  secrets?:
    readonly (
      string |
      undefined
    )[];
}

const maximumCauseDepth =
  6;
const maximumStackFrames =
  30;
const maximumMessageLength =
  2_000;

export function isDeveloperDiagnosticsEnabled(
  environment:
    DeveloperDiagnosticEnvironment
): boolean {
  return (
    environment
      .CHECKQUEST_DEBUG ===
    '1'
  );
}

function redactDiagnosticText(
  value:
    string,
  secrets:
    readonly (
      string |
      undefined
    )[]
): string {
  let redacted =
    value;

  for (
    const secret of
      secrets
  ) {
    if (
      secret !==
        undefined &&
      secret.length >
        0
    ) {
      redacted =
        redacted.replaceAll(
          secret,
          '[REDACTED]'
        );
    }
  }

  return redacted
    .replace(
      /\b(authorization|cookie|set-cookie|x-goog-api-key|api[_-]?key)\s*[:=]\s*(?:Bearer\s+)?[^\s,;]+/gi,
      '$1=[REDACTED]'
    )
    .replace(
      /\bBearer\s+[^\s,;]+/gi,
      'Bearer [REDACTED]'
    );
}

function formatSafeMessage(
  error:
    Error,
  secrets:
    readonly (
      string |
      undefined
    )[]
): string {
  return redactDiagnosticText(
    error.message,
    secrets
  )
    .replace(
      /\r?\n/g,
      ' '
    )
    .slice(
      0,
      maximumMessageLength
    );
}

function getSafeStackFrames(
  error:
    Error,
  secrets:
    readonly (
      string |
      undefined
    )[]
): string[] {
  if (
    error.stack ===
      undefined
  ) {
    return [];
  }

  return error.stack
    .split(
      /\r?\n/
    )
    .slice(
      1
    )
    .filter(
      line =>
        /^\s*at\s/.test(
          line
        )
    )
    .slice(
      0,
      maximumStackFrames
    )
    .map(
      line =>
        redactDiagnosticText(
          line.trim(),
          secrets
        )
    );
}

function pushCheckQuestContext(
  lines:
    string[],
  error:
    CheckQuestError,
  secrets:
    readonly (
      string |
      undefined
    )[]
): void {
  lines.push(
    `  code: ${error.code}`
  );

  for (
    const [
      label,
      value
    ] of [
      [
        'phase',
        error.phase
      ],
      [
        'run',
        error.runId
      ],
      [
        'page',
        error.pageNumber
      ],
      [
        'navigation-step',
        error.navigationStep
      ],
      [
        'candidate',
        error.candidateReference
      ]
    ] as const
  ) {
    if (
      value !==
        undefined
    ) {
      lines.push(
        `  ${label}: ${
          typeof value ===
            'string'
            ? redactDiagnosticText(
                value,
                secrets
              )
            : value
        }`
      );
    }
  }
}

function pushErrorChain(
  lines:
    string[],
  initialError:
    unknown,
  secrets:
    readonly (
      string |
      undefined
    )[],
  heading:
    string
): void {
  lines.push(
    heading
  );

  let current:
    unknown =
      initialError;
  const seen =
    new Set<object>();

  for (
    let depth =
      0;
    depth <
      maximumCauseDepth;
    depth +=
      1
  ) {
    if (
      !(
        current instanceof
        Error
      )
    ) {
      lines.push(
        `  [${depth}] <non-Error ${typeof current} cause omitted>`
      );
      return;
    }

    if (
      seen.has(
        current
      )
    ) {
      lines.push(
        `  [${depth}] <circular cause omitted>`
      );
      return;
    }

    seen.add(
      current
    );
    lines.push(
      `  [${depth}] ${redactDiagnosticText(
        current.name,
        secrets
      )}: ${formatSafeMessage(
        current,
        secrets
      )}`
    );

    if (
      current instanceof
        CheckQuestError
    ) {
      pushCheckQuestContext(
        lines,
        current,
        secrets
      );
    }

    for (
      const frame of
        getSafeStackFrames(
          current,
          secrets
        )
    ) {
      lines.push(
        `    ${frame}`
      );
    }

    if (
      current.cause ===
        undefined
    ) {
      return;
    }

    current =
      current.cause;
  }

  lines.push(
    '  <maximum cause depth reached>'
  );
}

/**
 * Produces an explicitly developer-only diagnostic. It reads only Error
 * metadata and stack-frame lines. Arbitrary thrown objects, request payloads,
 * headers, cookies, and environment state are never serialized.
 */
export function formatDeveloperErrorDiagnostic(
  error:
    unknown,
  options:
    DeveloperDiagnosticOptions =
      {}
): string {
  const secrets =
    options.secrets ??
    [];
  const lines = [
    'CheckQuest developer diagnostic (redacted)'
  ];

  pushErrorChain(
    lines,
    error,
    secrets,
    'Primary error chain:'
  );

  const cleanupError =
    getSecondaryCleanupError(
      error
    );

  if (
    cleanupError !==
      undefined
  ) {
    pushErrorChain(
      lines,
      cleanupError,
      secrets,
      'Secondary cleanup error chain:'
    );
  }

  return lines.join(
    '\n'
  );
}
