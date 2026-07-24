import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';

import {
  runGeminiRequest
} from '../ai/run-gemini-request';

import type {
  PredictedPageIdentity
} from '../exploration/page-novelty';

import type {
  NavigationBudgetContext,
  NavigationPolicyCandidate
} from '../exploration/navigation-policy';

import type {
  NavigationLink
} from '../browser/inspect-navigation';

import {
  aiConfig
} from '../config/ai-config';

import type {
  SiteConfig
} from '../config/site-config';

const chooseLinkArguments =
  z.object({
    linkIndex:
      z
        .number()
        .int()
        .nonnegative(),

    reason:
      z
        .string()
        .min(1)
  });

const finishArguments =
  z.object({
    summary:
      z
        .string()
        .min(1)
  });

export interface NavigationChoice {
  type: 'link';
  link: NavigationLink;
  predictedIdentity: PredictedPageIdentity;
  policyCandidate: NavigationPolicyCandidate;
  reason: string;
}

export interface FinishChoice {
  type: 'finish';
  summary: string;
}

export type NavigationDecision =
  | NavigationChoice
  | FinishChoice;

export async function chooseNavigationLink(
  site: SiteConfig,
  candidates: NavigationPolicyCandidate[],
  budget: NavigationBudgetContext
): Promise<NavigationDecision> {
  if (
    candidates.length ===
    0
  ) {
    return {
      type:
        'finish',

      summary:
        'No safe navigation links were available.'
    };
  }

  /*
   * The explicit "as const" on the discriminator keeps TypeScript from
   * widening "function" into the generic string type.
   */
  const chooseLinkTool = {
    type:
      'function' as const,

    name:
      'choose_navigation_link',

    description:
      'Choose one safe navigation link from the supplied numbered list for the next QA inspection.',

    parameters: {
      type:
        'object',

      properties: {
        linkIndex: {
          type:
            'integer',

          minimum:
            0,

          maximum:
            candidates.length - 1,

          description:
            'The zero-based list position of the navigation link to inspect.'
        },

        reason: {
          type:
            'string',

          description:
            'Why this link is a useful and safe next QA target.'
        }
      },

      required: [
        'linkIndex',
        'reason'
      ]
    }
  };

  const finishTool = {
    type:
      'function' as const,

    name:
      'finish',

    description:
      'Choose this when none of the available navigation links should be inspected.',

    parameters: {
      type:
        'object',

      properties: {
        summary: {
          type:
            'string',

          description:
            'A short explanation of why no navigation link should be selected.'
        }
      },

      required: [
        'summary'
      ]
    }
  };

  const numberedLinks =
    candidates.map(
      (
        candidate,
        index
      ) => ({
        index,

        text:
          candidate.link.text,

        url:
          candidate.link.url,

        areaKey:
          candidate
            .predictedIdentity
            .areaKey,

        routeFamilyKey:
          candidate
            .predictedIdentity
            .routeFamilyKey,

        novelty:
          candidate.noveltyTier,

        traversalDepth:
          candidate
            .minimumDiscoveryDepth,

        firstDiscoveredFromUrl:
          candidate
            .firstDiscoveredFromUrl,

        minimumDepthDiscoveredFromUrl:
          candidate
            .minimumDepthDiscoveredFromUrl,

        policyBand:
          candidate.policyBand,

        policyReason:
          candidate.policyReason,

        previousAreaVisits:
          candidate.areaVisitCount,

        previousRouteFamilyVisits:
          candidate
            .routeFamilyVisitCount,

        previousObservedTemplateVisits:
          candidate
            .observedTemplateVisitCount
      })
    );

  const ai =
    new GoogleGenAI({});

  const interaction =
    await runGeminiRequest(
      'choosing a safe navigation target',

      requestOptions =>
        ai.interactions.create(
          {
            model:
              aiConfig.model,

            /*
             * Explicitly choose the non-streaming overload so the
             * returned object is a completed interaction with steps.
             */
            stream:
              false,

            store:
              false,

            input: `
You are a cautious QA agent testing the public website "${site.name}".

Mission:
Choose one useful, representative internal navigation link for the next page inspection.

Rules:
- Choose only from the supplied numbered list.
- Deterministic policy has already restricted the list to the strongest currently eligible novelty band.
- Choose within this list; do not invent or request a candidate outside it.
- Treat novelty, traversal depth and policy metadata as prioritization guidance, never as permission to bypass safety.
- Prefer an informative content or product page.
- Do not choose a form, demo-booking page, search page or destructive action.
- Do not invent a URL.
- Choose exactly one available function.

Remaining page slots: ${budget.remainingPageSlots}
Remaining navigation-decision slots: ${budget.remainingNavigationDecisionSlots}

Safe navigation links:
${JSON.stringify(
  numberedLinks,
  null,
  2
)}
`,

            tools: [
              chooseLinkTool,
              finishTool
            ],

            generation_config: {
              tool_choice:
                'any',

              thinking_level:
                'low'
            }
          },

          requestOptions
        )
    );

  const functionCalls =
    (
      interaction.steps ??
      []
    ).filter(
      step =>
        step.type ===
        'function_call'
    );

  if (
    functionCalls.length !==
    1
  ) {
    throw new Error(
      `Expected exactly one navigation decision, received ${functionCalls.length}.`
    );
  }

  const decision =
    functionCalls[0];

  if (
    decision.name ===
    'choose_navigation_link'
  ) {
    const argumentsResult =
      chooseLinkArguments.parse(
        decision.arguments
      );

    const selectedLink =
      candidates[
        argumentsResult.linkIndex
      ];

    if (!selectedLink) {
      throw new Error(
        `Agent selected invalid link index ${argumentsResult.linkIndex}.`
      );
    }

    return {
      type:
        'link',

      link:
        selectedLink.link,

      predictedIdentity:
        selectedLink
          .predictedIdentity,

      policyCandidate:
        selectedLink,

      reason:
        argumentsResult.reason
    };
  }

  if (
    decision.name ===
    'finish'
  ) {
    const argumentsResult =
      finishArguments.parse(
        decision.arguments
      );

    return {
      type:
        'finish',

      summary:
        argumentsResult.summary
    };
  }

  throw new Error(
    `Unexpected navigation function: ${decision.name}`
  );
}
