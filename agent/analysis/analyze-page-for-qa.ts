import { GoogleGenAI } from '@google/genai';
import { parseModelJsonResponse } from '../ai/parse-model-json-response';
import { requireGeminiApiKey } from '../ai/resolve-gemini-api-key';
import {
  runGeminiRequest,
  type GeminiRequestDependencies,
  type GeminiRequestOptions
} from '../ai/run-gemini-request';
import type { GeminiOperationOptions } from '../ai/gemini-operation-options';
import type { ExtractedPageContent } from '../browser/extracted-page-content';
import type { VisitedPageObservation } from '../browser/visit-approved-link';
import { aiConfig } from '../config/ai-config';
import type { ClassifiedDiagnostics } from './classify-diagnostics';
import { buildExploratoryQaPrompt } from './build-exploratory-qa-prompt';
import type { PageFinding } from './evaluate-page';
import type { KnownFindingPromptContext } from '../investigation/known-findings';
import { exploratoryQaAnalysisSchema, type ExploratoryQaAnalysis } from './exploratory-qa-schema';

export interface AnalyzePageForQaInput {
  observation: VisitedPageObservation;
  content: ExtractedPageContent;
  classifiedDiagnostics: ClassifiedDiagnostics;
  ruleBasedFindings: PageFinding[];
  knownFindings?: KnownFindingPromptContext[];
}

export interface AnalyzePageForQaOptions
  extends GeminiOperationOptions,
    Pick<GeminiRequestDependencies, 'wait' | 'random'> {
  requestModelResponse?: (
    prompt: string,
    requestOptions: GeminiRequestOptions
  ) => Promise<string | undefined>;
}

export async function analyzePageForQa(
  input: AnalyzePageForQaInput,
  requestDependencies: AnalyzePageForQaOptions = {}
): Promise<ExploratoryQaAnalysis> {
  const ai = new GoogleGenAI({
    apiKey: requireGeminiApiKey(requestDependencies.geminiApiKey)
  });

  const prompt = buildExploratoryQaPrompt(input);

  const requestModelResponse =
    requestDependencies.requestModelResponse ??
    (async (requestPrompt: string, requestOptions: GeminiRequestOptions) => {
      const response = await ai.models.generateContent({
        model: requestDependencies.model ?? aiConfig.model,

        contents: requestPrompt,

        config: {
          responseMimeType: 'application/json',

          abortSignal: requestOptions.abortSignal,

          httpOptions: {
            timeout: requestOptions.timeout_ms,

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

      return response.text;
    });

  return runGeminiRequest(
    'performing exploratory QA analysis',

    async requestOptions => {
      const rawResponse = await requestModelResponse(prompt, requestOptions);

      return parseModelJsonResponse(
        rawResponse,
        'exploratory-qa-analysis-response',
        exploratoryQaAnalysisSchema,
        {
          retryable: true
        }
      );
    },
    {
      onEvent: requestDependencies.onEvent,
      signal: requestDependencies.signal,
      wait: requestDependencies.wait,
      random: requestDependencies.random
    }
  );
}
