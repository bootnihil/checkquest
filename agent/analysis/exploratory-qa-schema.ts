import { z } from 'zod';

export const selectOptionEvidenceTargetSchema = z.object({
  kind: z.literal('select-option'),

  controlLabel: z.string().min(1).max(500).nullable(),

  controlName: z.string().min(1).max(500).nullable(),

  controlId: z.string().min(1).max(500).nullable(),

  optionText: z.string().min(1).max(500)
});

export const disclosureStateEvidenceTargetSchema = z.object({
  kind: z.literal('disclosure-state'),
  controlId: z.string().min(1).max(500),
  accessibleName: z.string().min(1).max(500),
  controlledRegionId: z.string().min(1).max(500),
  desiredState: z.enum(['expanded', 'collapsed'])
});

export const tabStateEvidenceTargetSchema = z
  .object({
    kind: z.literal('tab-state'),
    controlId: z.string().min(1).max(500),
    accessibleName: z.string().min(1).max(500),
    tabListId: z.string().min(1).max(500),
    controlledPanelId: z.string().min(1).max(500),
    desiredState: z.literal('selected')
  })
  .strict();

export const exploratoryQaEvidenceTargetSchema = z.discriminatedUnion('kind', [
  selectOptionEvidenceTargetSchema,
  disclosureStateEvidenceTargetSchema,
  tabStateEvidenceTargetSchema
]);

export const findingPresentationTargetSchema = z
  .object({
    kind: z.literal('visible-text'),
    elementKind: z.enum(['heading', 'link', 'button']),
    text: z.string().min(1).max(500)
  })
  .strict();

export const findingStructuredIdentitySchema = z
  .object({
    mechanism: z.enum([
      'unresolved-token',
      'unexpected-value',
      'duplicate-value',
      'missing-value',
      'state-mismatch',
      'accessibility-semantics',
      'other'
    ]),
    observedValue: z.string().min(1).max(500),
    source: z.literal('accessible-name'),
    subject: z
      .object({
        kind: z.literal('semantic-control'),
        controlType: z.enum(['tab', 'disclosure']),
        controlId: z.string().min(1).max(500),
        componentId: z.string().min(1).max(500).nullable(),
        locator: z.string().min(1).max(1_000).nullable()
      })
      .strict()
  })
  .strict();

export const accessibilityEvidenceFactSchema = z
  .object({
    controlType: z.enum(['tab', 'disclosure']),
    controlId: z.string().min(1).max(500),
    property: z.enum([
      'visible-text',
      'accessible-name',
      'aria-expanded',
      'aria-selected',
      'aria-controls',
      'controlled-content-exists',
      'controlled-content-visible'
    ]),
    value: z.union([z.string().max(1_000), z.boolean(), z.null()])
  })
  .strict();

export const accessibilityDefectBasisSchema = z
  .object({
    expectation: z.string().min(1).max(1_000),
    conflict: z.string().min(1).max(1_000),
    supportingEvidence: z.array(accessibilityEvidenceFactSchema).min(1).max(8)
  })
  .strict();

export const technicalFailedRequestIdentitySchema = z
  .object({
    kind: z.literal('failed-request'),
    failureText: z.string().min(1).max(1_000),
    method: z.string().min(1).max(50),
    resourceType: z.string().min(1).max(100),
    resourceUrl: z.string().url().max(4_000),
    originRelation: z.enum(['same-origin', 'cross-origin'])
  })
  .strict();

export const technicalCorsIdentitySchema = z
  .object({
    kind: z.literal('cors'),
    mechanism: z.string().min(1).max(1_000),
    method: z.string().min(1).max(50),
    resourceType: z.enum(['fetch', 'xhr']),
    resourceUrl: z.string().url().max(4_000),
    requestingOrigin: z.string().url().max(4_000),
    originRelation: z.literal('cross-origin')
  })
  .strict();

export const technicalConsoleErrorIdentitySchema = z
  .object({
    kind: z.literal('console-error'),
    message: z.string().min(1).max(2_000),
    source: z.enum(['inspected-page', 'resource']),
    sourceUrl: z.string().url().max(4_000).nullable(),
    httpStatus: z.number().int().min(100).max(599).nullable()
  })
  .strict();

export const technicalObservationIdentitySchema = z.discriminatedUnion('kind', [
  technicalFailedRequestIdentitySchema,
  technicalCorsIdentitySchema,
  technicalConsoleErrorIdentitySchema
]);

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
    .regex(/^known-\d+$/)
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
  relatedRuleCode: z.string().min(1).max(100).nullable().optional(),

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

  severity: z.enum(['high', 'medium', 'low']),

  confidence: z.enum(['high', 'medium', 'low']),

  title: z.string().min(1).max(200),

  evidence: z.string().min(1).max(2_000),

  reasoning: z.string().min(1).max(2_000),

  suggestedCheck: z.string().min(1).max(1_000),

  /*
   * Optional machine-readable evidence target.
   *
   * This is null when the finding cannot be tied
   * safely and precisely to a supported UI element.
   *
   * Our first supported target is a specific option
   * inside a select dropdown.
   */
  evidenceTarget: exploratoryQaEvidenceTargetSchema.nullable(),

  /*
   * Optional presentation-only target used to capture focused human evidence.
   *
   * It is not an investigation action and has no effect on verification.
   * The text and element kind must be copied from structured page evidence.
   */
  presentationTarget: findingPresentationTargetSchema.nullable().optional(),

  /*
   * Optional identity evidence for a non-actionable semantic control.
   *
   * Runtime reconciliation accepts this only when the exact control id,
   * accessible name, control type, and component relationship are present in
   * the current page's extracted structured evidence. Generated prose and the
   * optional page-specific locator are never substantive finding identity.
   */
  structuredIdentity: findingStructuredIdentitySchema.nullable().optional(),

  /*
   * Accessibility findings need a concrete defect basis in addition to a
   * neutral property observation. Runtime admission validates every supplied
   * fact against the current structured control evidence and requires an
   * actual omission, negative relationship fact, or conflicting pair.
   */
  accessibilityDefectBasis: accessibilityDefectBasisSchema.nullable().optional(),

  /*
   * Model-supplied references are advisory pointers to exact deterministic
   * diagnostic groups included in the current prompt. Runtime resolves them
   * against current browser diagnostics before accepting technical identity.
   */
  technicalEvidenceReferences: z
    .array(
      z
        .string()
        .regex(/^technical-(?:request|cors)-\d+$/)
        .max(100)
    )
    .max(100)
    .nullable()
    .optional(),

  /*
   * Runtime-derived only. Model-supplied values are cleared before
   * reconciliation and never receive identity authority.
   */
  technicalIdentity: technicalObservationIdentitySchema.nullable().optional()
});

export const exploratoryQaAnalysisSchema = z.object({
  findings: z.array(exploratoryQaFindingSchema).max(10),

  summary: z.string().min(1).max(1_000)
});

export type SelectOptionEvidenceTarget = z.infer<typeof selectOptionEvidenceTargetSchema>;

export type DisclosureStateEvidenceTarget = z.infer<typeof disclosureStateEvidenceTargetSchema>;

export type TabStateEvidenceTarget = z.infer<typeof tabStateEvidenceTargetSchema>;

export type FindingPresentationTarget = z.infer<typeof findingPresentationTargetSchema>;

export type FindingStructuredIdentity = z.infer<typeof findingStructuredIdentitySchema>;

export type AccessibilityEvidenceFact = z.infer<typeof accessibilityEvidenceFactSchema>;

export type AccessibilityDefectBasis = z.infer<typeof accessibilityDefectBasisSchema>;

export type TechnicalFailedRequestIdentity = z.infer<typeof technicalFailedRequestIdentitySchema>;

export type TechnicalCorsIdentity = z.infer<typeof technicalCorsIdentitySchema>;

export type TechnicalConsoleErrorIdentity = z.infer<typeof technicalConsoleErrorIdentitySchema>;

export type TechnicalObservationIdentity = z.infer<typeof technicalObservationIdentitySchema>;

export type ExploratoryQaFinding = z.infer<typeof exploratoryQaFindingSchema>;

export type ExploratoryQaAnalysis = z.infer<typeof exploratoryQaAnalysisSchema>;
