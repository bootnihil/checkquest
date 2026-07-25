import { GoogleGenAI } from '@google/genai';

import {
  parseModelJsonResponse
} from '../ai/parse-model-json-response';
import {
  requireGeminiApiKey
} from '../ai/resolve-gemini-api-key';
import {
  runGeminiRequest
} from '../ai/run-gemini-request';
import type {
  GeminiOperationOptions
} from '../ai/gemini-operation-options';
import { aiConfig } from '../config/ai-config';
import {
  buildPlannerPrompt,
  type BuildPlannerPromptInput
} from './build-planner-prompt';
import {
  plannerDecisionSchema,
  type PlannerDecision
} from './planner-decision-schema';

/**
 * Asks Gemini to choose exactly one safe next exploratory action.
 *
 * The returned JSON is validated against plannerDecisionSchema before
 * anything is allowed to reach the deterministic browser executor.
 */
export async function planNextAction(
  input: BuildPlannerPromptInput,
  requestDependencies:
    GeminiOperationOptions = {}
): Promise<PlannerDecision> {
  const ai =
    new GoogleGenAI({
      apiKey:
        requireGeminiApiKey(
          requestDependencies
            .geminiApiKey
        )
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
      },
      {
        onEvent:
          requestDependencies
            .onEvent
      }
    );

  return parseModelJsonResponse(
    response.text,
    'exploratory-planner-response',
    plannerDecisionSchema
  );
}
