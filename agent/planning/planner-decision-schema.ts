import { z } from 'zod';

import { agentActionSchema } from '../actions/agent-action-schema';

/**
 * A single exploratory decision produced by the AI planning layer.
 *
 * The planner may reason freely through the descriptive fields, but the
 * requested browser interaction must conform to the constrained AgentAction
 * vocabulary.
 */
export const plannerDecisionSchema = z.object({
  candidateReference: z
    .string()
    .min(1)
    .max(200)
    .nullable()
    .optional(),

  hypothesis: z
    .string()
    .min(1)
    .max(2_000),

  reasoning: z
    .string()
    .min(1)
    .max(2_000),

  action: agentActionSchema,

  expectedObservation: z
    .string()
    .min(1)
    .max(2_000)
}).superRefine(
  (decision, context) => {
    if (
      decision.action.kind !== 'stop' &&
      decision.candidateReference == null
    ) {
      context.addIssue({
        code: 'custom',
        path: ['candidateReference'],
        message:
          'A non-stop planner decision must identify the page-local candidate it investigates.'
      });
    }
  }
);

export type PlannerDecision = z.infer<typeof plannerDecisionSchema>;
