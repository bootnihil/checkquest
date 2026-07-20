import { GoogleGenAI } from '@google/genai';

import { runGeminiRequest } from '../ai/run-gemini-request';
import { aiConfig } from '../config/ai-config';
import {
  buildPlannerPrompt,
  type BuildPlannerPromptInput
} from './build-planner-prompt';
import {
  plannerDecisionSchema,
  type PlannerDecision
} from './planner-decision-schema';

function getGeminiApiKey(): string {
  const apiKey =
    process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY environment variable is not configured.'
    );
  }

  return apiKey;
}

function cleanJsonResponse(
  rawText: string
): string {
  const trimmed =
    rawText.trim();

  if (
    trimmed.startsWith('```json') &&
    trimmed.endsWith('```')
  ) {
    return trimmed
      .slice(7, -3)
      .trim();
  }

  if (
    trimmed.startsWith('```') &&
    trimmed.endsWith('```')
  ) {
    return trimmed
      .slice(3, -3)
      .trim();
  }

  return trimmed;
}

/**
 * Asks Gemini to choose exactly one safe next exploratory action.
 *
 * The returned JSON is validated against plannerDecisionSchema before
 * anything is allowed to reach the deterministic browser executor.
 */
export async function planNextAction(
  input: BuildPlannerPromptInput
): Promise<PlannerDecision> {
  const ai =
    new GoogleGenAI({
      apiKey:
        getGeminiApiKey()
    });

  const prompt =
    buildPlannerPrompt(
      input
    );

  const response =
    await runGeminiRequest(
      'planning next exploratory QA action',

      async (
        requestOptions
      ) => {
        return ai.models.generateContent({
          model:
            aiConfig.model,

          contents:
            prompt,

          config: {
            responseMimeType:
              'application/json',

            httpOptions: {
              timeout:
                requestOptions.timeout_ms,

              /*
               * Disable SDK-level retries.
               *
               * runGeminiRequest() owns retry behavior so that retries,
               * delays, logging, and final error messages remain
               * centralized and predictable.
               */
              retryOptions: {
                attempts: 1
              }
            }
          }
        });
      }
    );

  const rawText =
    response.text;

  if (!rawText) {
    throw new Error(
      'Gemini returned an empty exploratory planner response.'
    );
  }

  const cleanedText =
    cleanJsonResponse(
      rawText
    );

  let parsedJson: unknown;

  try {
    parsedJson =
      JSON.parse(
        cleanedText
      );
  } catch (
    error: unknown
  ) {
    throw new Error(
      `Gemini returned invalid JSON while planning the next exploratory action: ${cleanedText}`,
      {
        cause: error
      }
    );
  }

  const validationResult =
    plannerDecisionSchema.safeParse(
      parsedJson
    );

  if (
    !validationResult.success
  ) {
    throw new Error(
      `Gemini returned an invalid exploratory planner decision: ${validationResult.error.message}`
    );
  }

  return validationResult.data;
}
