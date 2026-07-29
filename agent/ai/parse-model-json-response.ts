import type {
  ZodIssue,
  ZodType
} from 'zod';

import {
  CheckQuestError
} from '../errors/checkquest-error';

const maximumSchemaIssueCount =
  8;
const maximumIssueValueLength =
  200;
const maximumResponseExcerptLength =
  600;

function formatPath(
  path:
    PropertyKey[]
): string {
  if (
    path.length ===
      0
  ) {
    return '<root>';
  }

  return path.map(
    segment =>
      typeof segment ===
        'number'
        ? `[${segment}]`
        : String(
            segment
          )
  ).join(
    '.'
  ).replace(
    /\.\[/g,
    '['
  );
}

function getValueAtPath(
  value:
    unknown,
  path:
    PropertyKey[]
): {
  found: boolean;
  value?: unknown;
} {
  let current =
    value;

  for (
    const segment of
      path
  ) {
    if (
      typeof current !==
        'object' ||
      current ===
        null ||
      !Object.prototype
        .hasOwnProperty.call(
          current,
          segment
        )
    ) {
      return {
        found:
          false
      };
    }

    current =
      (
        current as
          Record<
            PropertyKey,
            unknown
          >
      )[segment];
  }

  return {
    found:
      true,
    value:
      current
  };
}

function describeValue(
  value:
    unknown
): {
  type: string;
  preview: string;
} {
  let type:
    string =
    typeof value;

  if (
    value ===
      null
  ) {
    type =
      'null';
  } else if (
    Array.isArray(
      value
    )
  ) {
    type =
      'array';
  }

  let serialized:
    string;

  try {
    serialized =
      JSON.stringify(
        value
      ) ??
      String(
        value
      );
  } catch {
    serialized =
      '<unserializable>';
  }

  return {
    type,
    preview:
      serialized.slice(
        0,
        maximumIssueValueLength
      )
  };
}

function safeIssueMetadata(
  issue:
    ZodIssue
): Record<
  string,
  unknown
> {
  const issueRecord =
    issue as unknown as
      Record<
        string,
        unknown
      >;
  const metadata:
    Record<
      string,
      unknown
    > =
      {};

  for (
    const key of
      [
        'expected',
        'received',
        'format',
        'minimum',
        'maximum',
        'inclusive',
        'exact'
      ]
  ) {
    const value =
      issueRecord[key];

    if (
      typeof value ===
        'string' ||
      typeof value ===
        'number' ||
      typeof value ===
        'boolean' ||
      value ===
        null
    ) {
      metadata[key] =
        value;
    }
  }

  return metadata;
}

function createResponseExcerpt(
  rawText:
    string
): string {
  if (
    rawText.length <=
      maximumResponseExcerptLength
  ) {
    return rawText;
  }

  const halfLength =
    Math.floor(
      maximumResponseExcerptLength /
        2
    );
  const omittedLength =
    rawText.length -
    (
      halfLength *
      2
    );

  return (
    rawText.slice(
      0,
      halfLength
    ) +
    `<${omittedLength} characters omitted>` +
    rawText.slice(
      -halfLength
    )
  );
}

function createSchemaDiagnosticError(
  rawText:
    string,
  cleanedText:
    string,
  parsedJson:
    unknown,
  issues:
    readonly ZodIssue[]
): Error {
  const issueDiagnostics =
    issues
      .slice(
        0,
        maximumSchemaIssueCount
      )
      .map(
        issue => {
          const locatedValue =
            getValueAtPath(
              parsedJson,
              issue.path
            );

          return {
            path:
              formatPath(
                issue.path
              ),
            code:
              issue.code,
            message:
              issue.message,
            ...safeIssueMetadata(
              issue
            ),
            value:
              locatedValue.found
                ? describeValue(
                    locatedValue
                      .value
                  )
                : {
                    type:
                      'missing',
                    preview:
                      '<missing>'
                  }
          };
        }
      );
  const diagnostic =
    new Error(
      [
        'Model response schema validation failed.',
        `metadata=${JSON.stringify({
          responseLength:
            rawText.length,
          cleanedResponseLength:
            cleanedText.length,
          issueCount:
            issues.length,
          retainedIssueCount:
            issueDiagnostics
              .length
        })}`,
        `issues=${JSON.stringify(
          issueDiagnostics
        )}`,
        `responseExcerpt=${JSON.stringify(
          createResponseExcerpt(
            cleanedText
          )
        )}`
      ].join(
        ' '
      )
    );

  diagnostic.name =
    'ModelResponseSchemaDiagnosticError';

  return diagnostic;
}

function cleanJsonResponse(
  rawText:
    string
): string {
  const trimmed =
    rawText.trim();

  if (
    trimmed.startsWith(
      '```json'
    ) &&
    trimmed.endsWith(
      '```'
    )
  ) {
    return trimmed
      .slice(
        7,
        -3
      )
      .trim();
  }

  if (
    trimmed.startsWith(
      '```'
    ) &&
    trimmed.endsWith(
      '```'
    )
  ) {
    return trimmed
      .slice(
        3,
        -3
      )
      .trim();
  }

  return trimmed;
}

function responseError(
  operation:
    string,
  responseClass:
    'empty' |
    'malformed-json' |
    'schema-invalid',
  cause?:
    unknown
): CheckQuestError {
  const explanations = {
    empty:
      'Gemini returned an empty response.',
    'malformed-json':
      'Gemini returned malformed JSON.',
    'schema-invalid':
      'Gemini returned JSON that did not match the required response schema.'
  } as const;

  return new CheckQuestError(
    'MODEL_RESPONSE',
    `${explanations[responseClass]} Operation: ${operation}.`,
    {
      phase:
        operation,
      retryable:
        false,
      cause
    }
  );
}

export function parseModelJsonResponse<T>(
  rawText:
    string | undefined,
  operation:
    string,
  schema:
    ZodType<T>
): T {
  if (
    rawText ===
      undefined ||
    rawText.trim().length ===
      0
  ) {
    throw responseError(
      operation,
      'empty'
    );
  }

  const cleanedText =
    cleanJsonResponse(
      rawText
    );

  let parsedJson:
    unknown;

  try {
    parsedJson =
      JSON.parse(
        cleanedText
      );
  } catch {
    /*
     * JSON parser messages can echo the rejected input. Do not retain
     * that parser error or the raw model response in the public error.
     */
    throw responseError(
      operation,
      'malformed-json'
    );
  }

  const validationResult =
    schema.safeParse(
      parsedJson
    );

  if (
    !validationResult.success
  ) {
    /*
     * Schema diagnostics can contain model-supplied values. The
     * response class is sufficient at this public trust boundary.
     */
    throw responseError(
      operation,
      'schema-invalid',
      createSchemaDiagnosticError(
        rawText,
        cleanedText,
        parsedJson,
        validationResult
          .error
          .issues
      )
    );
  }

  return validationResult.data;
}
