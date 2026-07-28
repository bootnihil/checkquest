import { z } from 'zod';

export const selectOptionEvidenceTargetSchema =
  z.object({
    kind: z.literal('select-option'),

    controlLabel: z
      .string()
      .min(1)
      .max(500)
      .nullable(),

    controlName: z
      .string()
      .min(1)
      .max(500)
      .nullable(),

    controlId: z
      .string()
      .min(1)
      .max(500)
      .nullable(),

    optionText: z
      .string()
      .min(1)
      .max(500)
  });

export const disclosureStateEvidenceTargetSchema =
  z.object({
    kind: z.literal('disclosure-state'),
    controlId: z.string().min(1).max(500),
    accessibleName: z.string().min(1).max(500),
    controlledRegionId: z.string().min(1).max(500),
    desiredState: z.enum(['expanded', 'collapsed'])
  });

export const tabStateEvidenceTargetSchema =
  z.object({
    kind: z.literal('tab-state'),
    controlId: z.string().min(1).max(500),
    accessibleName: z.string().min(1).max(500),
    tabListId: z.string().min(1).max(500),
    controlledPanelId: z.string().min(1).max(500),
    desiredState: z.literal('selected')
  }).strict();

export const exploratoryQaEvidenceTargetSchema =
  z.discriminatedUnion('kind', [
    selectOptionEvidenceTargetSchema,
    disclosureStateEvidenceTargetSchema,
    tabStateEvidenceTargetSchema
  ]);

export const findingPresentationTargetSchema =
  z.object({
    kind:
      z.literal(
        'visible-text'
      ),
    elementKind:
      z.enum([
        'heading',
        'link',
        'button'
      ]),
    text:
      z.string()
        .min(1)
        .max(500)
  }).strict();

export const findingStructuredIdentitySchema =
  z.object({
    mechanism:
      z.enum([
        'unresolved-token',
        'unexpected-value',
        'duplicate-value',
        'missing-value',
        'state-mismatch',
        'accessibility-semantics',
        'other'
      ]),
    observedValue:
      z.string()
        .min(1)
        .max(500),
    source:
      z.literal(
        'accessible-name'
      ),
    subject:
      z.object({
        kind:
          z.literal(
            'semantic-control'
          ),
        controlType:
          z.enum([
            'tab',
            'disclosure'
          ]),
        controlId:
          z.string()
            .min(1)
            .max(500),
        componentId:
          z.string()
            .min(1)
            .max(500)
            .nullable(),
        locator:
          z.string()
            .min(1)
            .max(1_000)
            .nullable()
      }).strict()
  }).strict();

export const exploratoryQaFindingSchema = z.object({
  /*
   * Optional model-supplied relationship to a run-local
   * known finding.
   *
   * This is advisory only. Runtime fingerprint reconciliation
   * remains authoritative.
   */
  knownFindingReference: z
    .string()
    .regex(
      /^known-\d+$/
    )
    .max(100)
    .nullable()
    .optional(),

  /*
   * Optional advisory link to one deterministic rule finding supplied
   * for this exact page.
   *
   * Runtime reconciliation accepts it only when the exact code exists and
   * the targetless model title/evidence exactly identify that rule assertion.
   * A structured target is incompatible with current targetless rules.
   * The reference never grants verification.
   */
  relatedRuleCode: z
    .string()
    .min(1)
    .max(100)
    .nullable()
    .optional(),

  category: z.enum([
    'content',
    'navigation',
    'interaction',
    'visual',
    'accessibility',
    'consistency',
    'technical',
    'other'
  ]),

  severity: z.enum([
    'high',
    'medium',
    'low'
  ]),

  confidence: z.enum([
    'high',
    'medium',
    'low'
  ]),

  title: z
    .string()
    .min(1)
    .max(200),

  evidence: z
    .string()
    .min(1)
    .max(2_000),

  reasoning: z
    .string()
    .min(1)
    .max(2_000),

  suggestedCheck: z
    .string()
    .min(1)
    .max(1_000),

  /*
   * Optional machine-readable evidence target.
   *
   * This is null when the finding cannot be tied
   * safely and precisely to a supported UI element.
   *
   * Our first supported target is a specific option
   * inside a select dropdown.
   */
  evidenceTarget:
    exploratoryQaEvidenceTargetSchema
      .nullable(),

  /*
   * Optional presentation-only target used to capture focused human evidence.
   *
   * It is not an investigation action and has no effect on verification.
   * The text and element kind must be copied from structured page evidence.
   */
  presentationTarget:
    findingPresentationTargetSchema
      .nullable()
      .optional(),

  /*
   * Optional identity evidence for a non-actionable semantic control.
   *
   * Runtime reconciliation accepts this only when the exact control id,
   * accessible name, control type, and component relationship are present in
   * the current page's extracted structured evidence. Generated prose and the
   * optional page-specific locator are never substantive finding identity.
   */
  structuredIdentity:
    findingStructuredIdentitySchema
      .nullable()
      .optional()
});

export const exploratoryQaAnalysisSchema = z.object({
  findings: z
    .array(exploratoryQaFindingSchema)
    .max(10),

  summary: z
    .string()
    .min(1)
    .max(1_000)
});

export type SelectOptionEvidenceTarget =
  z.infer<
    typeof selectOptionEvidenceTargetSchema
  >;

export type DisclosureStateEvidenceTarget =
  z.infer<
    typeof disclosureStateEvidenceTargetSchema
  >;

export type TabStateEvidenceTarget =
  z.infer<
    typeof tabStateEvidenceTargetSchema
  >;

export type FindingPresentationTarget =
  z.infer<
    typeof findingPresentationTargetSchema
  >;

export type FindingStructuredIdentity =
  z.infer<
    typeof findingStructuredIdentitySchema
  >;

export type ExploratoryQaFinding =
  z.infer<
    typeof exploratoryQaFindingSchema
  >;

export type ExploratoryQaAnalysis =
  z.infer<
    typeof exploratoryQaAnalysisSchema
  >;
