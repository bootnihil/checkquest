import type {
  ZodType
} from 'zod';

import {
  CheckQuestError
} from '../errors/checkquest-error';

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
    'schema-invalid'
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
        false
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
      'schema-invalid'
    );
  }

  return validationResult.data;
}
