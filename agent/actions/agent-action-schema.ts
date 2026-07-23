import { z } from 'zod';

/**
 * Identifies a form control using human-readable DOM attributes.
 *
 * The AI is deliberately not allowed to provide arbitrary CSS selectors.
 * The browser executor will use these fields to locate the intended element
 * using deterministic logic.
 */
export const formControlTargetSchema = z
  .object({
    label: z.string().min(1).max(500).nullable(),
    name: z.string().min(1).max(500).nullable(),
    id: z.string().min(1).max(500).nullable(),
    placeholder: z.string().min(1).max(500).nullable()
  })
  .refine(
    target =>
      target.label !== null ||
      target.name !== null ||
      target.id !== null ||
      target.placeholder !== null,
    {
      message:
        'A form control target must contain at least one identifying attribute.'
    }
  );

export const fillTextFieldActionSchema = z.object({
  kind: z.literal('fill-text-field'),
  target: formControlTargetSchema,
  value: z.string().max(2_000)
});

export const clearFieldActionSchema = z.object({
  kind: z.literal('clear-field'),
  target: formControlTargetSchema
});

export const blurFieldActionSchema = z.object({
  kind: z.literal('blur-field'),
  target: formControlTargetSchema
});

export const selectOptionActionSchema = z.object({
  kind: z.literal('select-option'),
  target: formControlTargetSchema,
  optionText: z.string().min(1).max(500)
});

export const disclosureControlTargetSchema = z.object({
  controlId: z.string().min(1).max(500),
  accessibleName: z.string().min(1).max(500),
  controlledRegionId: z.string().min(1).max(500)
});

export const setDisclosureStateActionSchema = z.object({
  kind: z.literal('set-disclosure-state'),
  target: disclosureControlTargetSchema,
  desiredState: z.enum(['expanded', 'collapsed'])
});

export const tabControlTargetSchema = z.object({
  controlId: z.string().min(1).max(500),
  accessibleName: z.string().min(1).max(500),
  tabListId: z.string().min(1).max(500),
  controlledPanelId: z.string().min(1).max(500)
}).strict();

export const selectTabActionSchema = z.object({
  kind: z.literal('select-tab'),
  target: tabControlTargetSchema,
  desiredState: z.literal('selected')
}).strict();

export const scrollActionSchema = z.object({
  kind: z.literal('scroll'),
  direction: z.enum(['up', 'down']),
  viewportCount: z.number().int().min(1).max(3)
});

export const stopActionSchema = z.object({
  kind: z.literal('stop'),
  reason: z.string().min(1).max(1_000)
});

/**
 * The complete set of actions that the exploratory planner is currently
 * permitted to request.
 *
 * Adding a new action here does not automatically give the AI browser access.
 * A corresponding deterministic executor must also be implemented separately.
 */
export const agentActionSchema = z.discriminatedUnion('kind', [
  fillTextFieldActionSchema,
  clearFieldActionSchema,
  blurFieldActionSchema,
  selectOptionActionSchema,
  setDisclosureStateActionSchema,
  selectTabActionSchema,
  scrollActionSchema,
  stopActionSchema
]);

export type FormControlTarget = z.infer<typeof formControlTargetSchema>;
export type DisclosureControlTarget = z.infer<
  typeof disclosureControlTargetSchema
>;
export type TabControlTarget = z.infer<
  typeof tabControlTargetSchema
>;
export type AgentAction = z.infer<typeof agentActionSchema>;
