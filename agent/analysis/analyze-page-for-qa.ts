import { GoogleGenAI } from '@google/genai';
import { runGeminiRequest } from '../ai/run-gemini-request';
import type { ExtractedPageContent } from '../browser/extract-page-content';
import type { VisitedPageObservation } from '../browser/visit-approved-link';
import { aiConfig } from '../config/ai-config';
import type { ClassifiedDiagnostics } from './classify-diagnostics';
import { buildExploratoryQaPrompt } from './build-exploratory-qa-prompt';
import type { PageFinding } from './evaluate-page';
import {
  exploratoryQaAnalysisSchema,
  type ExploratoryQaAnalysis
} from './exploratory-qa-schema';

export interface AnalyzePageForQaInput {
  observation: VisitedPageObservation;
  content: ExtractedPageContent;
  classifiedDiagnostics: ClassifiedDiagnostics;
  ruleBasedFindings: PageFinding[];
}

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

export async function analyzePageForQa(
  input: AnalyzePageForQaInput
): Promise<ExploratoryQaAnalysis> {
  const ai =
    new GoogleGenAI({
      apiKey:
        getGeminiApiKey()
    });

  const prompt =
    buildExploratoryQaPrompt(
      input
    );

  const response =
    await runGeminiRequest(
      'performing exploratory QA analysis',

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
      'Gemini returned an empty exploratory QA response.'
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
      `Gemini returned invalid JSON during exploratory QA analysis: ${cleanedText}`,
      {
        cause: error
      }
    );
  }

  const validationResult =
    exploratoryQaAnalysisSchema.safeParse(
      parsedJson
    );

  if (
    !validationResult.success
  ) {
    throw new Error(
      `Gemini returned an invalid exploratory QA response: ${validationResult.error.message}`
    );
  }

  return validationResult.data;
}
