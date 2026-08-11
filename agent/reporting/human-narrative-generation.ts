import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';

import { parseModelJsonResponse } from '../ai/parse-model-json-response';
import type { GeminiOperationOptions } from '../ai/gemini-operation-options';
import { runGeminiRequest } from '../ai/run-gemini-request';
import { requireGeminiApiKey } from '../ai/resolve-gemini-api-key';
import {
  exploratoryQaFindingSchema,
  type AccessibilityDefectBasis,
  type FindingStructuredIdentity
} from '../analysis/exploratory-qa-schema';
import { aiConfig } from '../config/ai-config';
import { CheckQuestError } from '../errors/checkquest-error';
import type { UnifiedFinding } from '../findings/finding-model';
import { createStructuredIdentityFingerprint } from '../investigation/finding-fingerprint';
import { getRuntimeTechnicalIdentity, isPrimaryHumanFinding } from './run-summary-projection';
import type {
  PersistedExploratoryHumanNarrative,
  SiteAgentReport,
  SiteAgentReportV4
} from './report-types';

export const exploratoryHumanNarrativeSchema = z
  .object({
    plainTitle: z.string().min(1).max(160),
    plainCondition: z.string().min(1).max(1_000)
  })
  .strict();

export type ExploratoryHumanNarrativeOutput = z.infer<typeof exploratoryHumanNarrativeSchema>;

export interface ExploratoryHumanNarrativeInput {
  findingReference: UnifiedFinding['findingReference'];
  supportedClaim: {
    title: string | null;
    condition: string;
  };
  humanVisibleEvidenceValues: string[];
  evidenceSource: 'Observed directly' | 'Seen in browser data' | 'AI analysis only';
  assessment: 'Confirmed issue' | 'Needs human review';
  affectedPageCount: number;
}

export type HumanNarrativeGenerator = (
  input: ExploratoryHumanNarrativeInput,
  options?: GeminiOperationOptions
) => Promise<ExploratoryHumanNarrativeOutput>;

export interface HumanNarrativeEnrichmentOptions extends GeminiOperationOptions {
  generateNarrative?: HumanNarrativeGenerator;
}

export type SupportedDeterministicNarrativeMechanism =
  | 'runtime-technical-identity'
  | 'structured-semantic-control'
  | 'accessibility-defect-basis'
  | 'deterministic-page-rule'
  | 'non-primary-report-item';

export type RecognizedPartialNarrativeMechanism =
  | 'structured-semantic-control'
  | 'accessibility-defect-basis'
  | 'runtime-technical-identity'
  | 'deterministic-page-rule';

export type HumanNarrativeRoute =
  | {
      kind: 'supported-deterministic';
      mechanism: SupportedDeterministicNarrativeMechanism;
    }
  | {
      kind: 'partial-recognized-structured';
      mechanism: RecognizedPartialNarrativeMechanism;
    }
  | {
      kind: 'exploratory';
    };

export interface StructuredAccessibilityNarrativeFacts {
  identity: FindingStructuredIdentity | null;
  defectBasis: AccessibilityDefectBasis | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function addNonEmptyString(target: Set<string>, value: unknown): void {
  if (typeof value === 'string' && value.trim().length > 0) {
    target.add(value.trim());
  }
}

type TechnicalNarrativeSource =
  | 'opaque-reference'
  | 'selector-or-locator'
  | 'control-identifier'
  | 'semantic-control-name'
  | 'rule-or-mechanism'
  | 'technical-url-or-origin'
  | 'technical-failure-detail';

type TechnicalNarrativeMatchMode = 'normalized-substring' | 'normalized-whole-field';

interface TechnicalNarrativeValue {
  value: string;
  sourceField: string;
  source: TechnicalNarrativeSource;
  matchMode: TechnicalNarrativeMatchMode;
}

const technicalNarrativeFieldPolicy = new Map<
  string,
  Pick<TechnicalNarrativeValue, 'source' | 'matchMode'>
>([
  ['candidateReference', { source: 'opaque-reference', matchMode: 'normalized-substring' }],
  ['componentId', { source: 'control-identifier', matchMode: 'normalized-substring' }],
  ['controlId', { source: 'control-identifier', matchMode: 'normalized-substring' }],
  /*
   * A form control name can be an ordinary reader-language word. Returning the
   * name as an entire generated field is still a leak, but merely using that
   * word inside a sentence is not. Opaque IDs and references retain substring
   * protection below.
   */
  ['controlName', { source: 'semantic-control-name', matchMode: 'normalized-whole-field' }],
  ['controlledPanelId', { source: 'control-identifier', matchMode: 'normalized-substring' }],
  ['controlledRegionId', { source: 'control-identifier', matchMode: 'normalized-substring' }],
  ['findingReference', { source: 'opaque-reference', matchMode: 'normalized-substring' }],
  ['knownFindingReference', { source: 'opaque-reference', matchMode: 'normalized-substring' }],
  ['locator', { source: 'selector-or-locator', matchMode: 'normalized-substring' }],
  ['relatedRuleCode', { source: 'rule-or-mechanism', matchMode: 'normalized-substring' }],
  ['selector', { source: 'selector-or-locator', matchMode: 'normalized-substring' }],
  ['tabListId', { source: 'control-identifier', matchMode: 'normalized-substring' }],
  ['technicalEvidenceReferences', { source: 'opaque-reference', matchMode: 'normalized-substring' }]
]);

function addTechnicalNarrativeValue(
  target: TechnicalNarrativeValue[],
  value: unknown,
  sourceField: string,
  source: TechnicalNarrativeSource,
  matchMode: TechnicalNarrativeMatchMode = 'normalized-substring'
): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return;
  }

  const candidate = {
    value: value.trim(),
    sourceField,
    source,
    matchMode
  } as const;

  if (
    !target.some(
      existing =>
        existing.value === candidate.value &&
        existing.sourceField === candidate.sourceField &&
        existing.source === candidate.source &&
        existing.matchMode === candidate.matchMode
    )
  ) {
    target.push(candidate);
  }
}

function collectKnownTechnicalFields(value: unknown, target: TechnicalNarrativeValue[]): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectKnownTechnicalFields(item, target);
    }

    return;
  }

  if (!isRecord(value)) {
    return;
  }

  for (const [key, item] of Object.entries(value)) {
    const policy = technicalNarrativeFieldPolicy.get(key);

    if (policy !== undefined) {
      if (Array.isArray(item)) {
        for (const nested of item) {
          addTechnicalNarrativeValue(target, nested, key, policy.source, policy.matchMode);
        }
      } else {
        addTechnicalNarrativeValue(target, item, key, policy.source, policy.matchMode);
      }
    }

    collectKnownTechnicalFields(item, target);
  }
}

function collectHumanVisibleEvidenceValues(finding: UnifiedFinding): Set<string> {
  const values = new Set<string>();

  for (const occurrence of finding.occurrences) {
    const target = occurrence.target;

    if (target?.kind === 'select-option') {
      addNonEmptyString(values, target.controlLabel);
      addNonEmptyString(values, target.optionText);
    } else if (target?.kind === 'disclosure-state' || target?.kind === 'tab-state') {
      addNonEmptyString(values, target.accessibleName);
    }

    for (const evidence of occurrence.evidence) {
      if (evidence.rawSource?.type !== 'exploratory-qa-finding') {
        continue;
      }

      const parsed = exploratoryQaFindingSchema.safeParse(evidence.rawSource.value);

      if (!parsed.success) {
        continue;
      }

      const modelFinding = parsed.data;
      const evidenceTarget = modelFinding.evidenceTarget;

      addNonEmptyString(values, modelFinding.structuredIdentity?.observedValue);
      addNonEmptyString(values, modelFinding.presentationTarget?.text);

      if (evidenceTarget?.kind === 'select-option') {
        addNonEmptyString(values, evidenceTarget.controlLabel);
        addNonEmptyString(values, evidenceTarget.optionText);
      } else if (
        evidenceTarget?.kind === 'disclosure-state' ||
        evidenceTarget?.kind === 'tab-state'
      ) {
        addNonEmptyString(values, evidenceTarget.accessibleName);
      }

      for (const fact of modelFinding.accessibilityDefectBasis?.supportingEvidence ?? []) {
        if (fact.property === 'visible-text' || fact.property === 'accessible-name') {
          addNonEmptyString(values, fact.value);
        }
      }
    }
  }

  return values;
}

function normalizedValue(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

function normalizeHumanVisibleIdentity(value: string): string {
  let normalized = normalizedValue(value);

  /*
   * Trusted labels may carry wrapper quotes or a conventional required-field
   * marker. Preserve every other punctuation character so selectors and
   * unrelated technical values cannot become accidentally allowlisted.
   */
  for (let pass = 0; pass < 2; pass += 1) {
    normalized = normalized
      .replace(/^["'‘’“”](.*)["'‘’“”]$/u, '$1')
      .replace(/\s*\*+\s*$/u, '')
      .trim();
  }

  return normalized;
}

function collectTechnicalOnlyNarrativeValues(finding: UnifiedFinding): TechnicalNarrativeValue[] {
  const values: TechnicalNarrativeValue[] = [];

  addTechnicalNarrativeValue(
    values,
    finding.findingReference,
    'findingReference',
    'opaque-reference'
  );
  addTechnicalNarrativeValue(values, finding.fingerprint, 'fingerprint', 'opaque-reference');

  for (const occurrence of finding.occurrences) {
    addTechnicalNarrativeValue(
      values,
      occurrence.occurrenceReference,
      'occurrenceReference',
      'opaque-reference'
    );

    for (const screenshotReference of occurrence.screenshotReferences) {
      addTechnicalNarrativeValue(
        values,
        screenshotReference,
        'screenshotReference',
        'opaque-reference'
      );
    }

    collectKnownTechnicalFields(occurrence.target, values);

    for (const evidence of occurrence.evidence) {
      addTechnicalNarrativeValue(
        values,
        evidence.evidenceReference,
        'evidenceReference',
        'opaque-reference'
      );
      addTechnicalNarrativeValue(
        values,
        evidence.rawReference?.candidateReference,
        'candidateReference',
        'opaque-reference'
      );
      collectKnownTechnicalFields(evidence.rawSource?.value, values);

      if (evidence.rawSource?.type !== 'exploratory-qa-finding') {
        continue;
      }

      const parsed = exploratoryQaFindingSchema.safeParse(evidence.rawSource.value);
      const identity = parsed.success ? (parsed.data.technicalIdentity ?? null) : null;

      if (identity?.kind === 'failed-request') {
        addTechnicalNarrativeValue(
          values,
          identity.resourceUrl,
          'resourceUrl',
          'technical-url-or-origin'
        );
        addTechnicalNarrativeValue(
          values,
          identity.failureText,
          'failureText',
          'technical-failure-detail'
        );
      } else if (identity?.kind === 'cors') {
        addTechnicalNarrativeValue(
          values,
          identity.resourceUrl,
          'resourceUrl',
          'technical-url-or-origin'
        );
        addTechnicalNarrativeValue(
          values,
          identity.requestingOrigin,
          'requestingOrigin',
          'technical-url-or-origin'
        );
        addTechnicalNarrativeValue(values, identity.mechanism, 'mechanism', 'rule-or-mechanism');
      } else if (identity?.kind === 'console-error') {
        addTechnicalNarrativeValue(values, identity.message, 'message', 'technical-failure-detail');
        addTechnicalNarrativeValue(
          values,
          identity.sourceUrl,
          'sourceUrl',
          'technical-url-or-origin'
        );
      }
    }
  }

  const allowed = new Set(
    [...collectHumanVisibleEvidenceValues(finding)]
      .map(normalizeHumanVisibleIdentity)
      .filter(value => value.length > 0)
  );

  return values.filter(value => {
    const normalized = normalizeHumanVisibleIdentity(value.value);
    return normalized.length === 0 || !allowed.has(normalized);
  });
}

function technicalValueMatchesField(
  fieldValue: string,
  technical: TechnicalNarrativeValue
): boolean {
  const normalizedFieldValue = normalizedValue(fieldValue);
  const normalizedTechnicalValue = normalizedValue(technical.value);

  return technical.matchMode === 'normalized-whole-field'
    ? normalizedFieldValue === normalizedTechnicalValue
    : normalizedFieldValue.includes(normalizedTechnicalValue);
}

function getNarratorSafeCanonicalTitle(finding: UnifiedFinding): string | null {
  const normalizedTitle = normalizedValue(finding.title);

  return collectTechnicalOnlyNarrativeValues(finding).some(value =>
    value.matchMode === 'normalized-whole-field'
      ? normalizedTitle === normalizedValue(value.value)
      : normalizedTitle.includes(normalizedValue(value.value))
  )
    ? null
    : finding.title;
}

export function validateGeneratedHumanNarrative(
  finding: UnifiedFinding,
  generated: ExploratoryHumanNarrativeOutput
): void {
  const generatedFields = [
    ['plainTitle', generated.plainTitle],
    ['plainCondition', generated.plainCondition]
  ] as const;

  for (const [generatedField, generatedValue] of generatedFields) {
    for (const forbiddenValue of collectTechnicalOnlyNarrativeValues(finding)) {
      if (!technicalValueMatchesField(generatedValue, forbiddenValue)) {
        continue;
      }

      throw new CheckQuestError(
        'REPORTING',
        'Generated human narrative contains a technical-only report value.',
        {
          phase: 'human-narrative-validation',
          runId: undefined,
          developerContext: {
            findingReference: finding.findingReference,
            generatedField,
            matchedForbiddenValue: forbiddenValue.value,
            forbiddenSource: `${forbiddenValue.source}:${forbiddenValue.sourceField}`,
            matchMode: forbiddenValue.matchMode
          }
        }
      );
    }
  }
}

function isPageRule(value: unknown): value is {
  code: string;
  severity: 'high' | 'medium' | 'low';
  title: string;
  evidence: string;
  url: string;
} {
  return (
    isRecord(value) &&
    typeof value.code === 'string' &&
    value.code.length > 0 &&
    (value.severity === 'high' || value.severity === 'medium' || value.severity === 'low') &&
    typeof value.title === 'string' &&
    value.title.length > 0 &&
    typeof value.evidence === 'string' &&
    value.evidence.length > 0 &&
    typeof value.url === 'string' &&
    value.url.length > 0
  );
}

function isRecognizedStructuredIdentityCandidate(value: unknown): boolean {
  if (!isRecord(value) || value.source !== 'accessible-name' || !isRecord(value.subject)) {
    return false;
  }

  return value.subject.kind === 'semantic-control';
}

function isRecognizedAccessibilityBasisCandidate(value: unknown): boolean {
  return (
    isRecord(value) &&
    ('expectation' in value || 'conflict' in value || 'supportingEvidence' in value)
  );
}

function isRecognizedTechnicalIdentityCandidate(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value.kind === 'failed-request' || value.kind === 'cors' || value.kind === 'console-error')
  );
}

function inspectStructuredAccessibility(
  finding: UnifiedFinding
): StructuredAccessibilityNarrativeFacts | 'partial' | null {
  let partial = false;

  for (const occurrence of finding.occurrences) {
    for (const evidence of occurrence.evidence) {
      if (evidence.rawSource?.type !== 'exploratory-qa-finding') {
        continue;
      }

      const parsed = exploratoryQaFindingSchema.safeParse(evidence.rawSource.value);

      if (parsed.success) {
        const identity = parsed.data.structuredIdentity ?? null;
        const defectBasis =
          finding.category === 'accessibility'
            ? (parsed.data.accessibilityDefectBasis ?? null)
            : null;

        if (
          identity !== null &&
          finding.fingerprint === createStructuredIdentityFingerprint(identity)
        ) {
          return { identity, defectBasis };
        }

        if (defectBasis !== null) {
          return { identity: null, defectBasis };
        }

        if (identity !== null) {
          partial = true;
        }

        continue;
      }

      const raw = evidence.rawSource.value;

      if (!isRecord(raw)) {
        continue;
      }

      if (
        isRecognizedStructuredIdentityCandidate(raw.structuredIdentity) ||
        (finding.category === 'accessibility' &&
          isRecognizedAccessibilityBasisCandidate(raw.accessibilityDefectBasis))
      ) {
        partial = true;
      }
    }
  }

  return partial ? 'partial' : null;
}

export function getStructuredAccessibilityNarrativeFacts(
  finding: UnifiedFinding
): StructuredAccessibilityNarrativeFacts | null {
  const inspected = inspectStructuredAccessibility(finding);

  return inspected === 'partial' ? null : inspected;
}

function inspectPageRule(finding: UnifiedFinding): 'supported' | 'partial' | null {
  let partial = false;

  for (const occurrence of finding.occurrences) {
    for (const evidence of occurrence.evidence) {
      if (evidence.rawSource?.type !== 'page-finding') {
        continue;
      }

      if (
        isPageRule(evidence.rawSource.value) &&
        finding.fingerprint === `rule|${evidence.rawSource.value.code}`
      ) {
        return 'supported';
      }

      partial = true;
    }
  }

  return partial ? 'partial' : null;
}

function hasRecognizedPartialTechnicalIdentity(finding: UnifiedFinding): boolean {
  return finding.occurrences.some(occurrence =>
    occurrence.evidence.some(evidence => {
      if (evidence.rawSource?.type !== 'exploratory-qa-finding') {
        return false;
      }

      const raw = evidence.rawSource.value;

      return isRecord(raw) && isRecognizedTechnicalIdentityCandidate(raw.technicalIdentity);
    })
  );
}

export function determineHumanNarrativeRoute(finding: UnifiedFinding): HumanNarrativeRoute {
  if (!isPrimaryHumanFinding(finding)) {
    return { kind: 'supported-deterministic', mechanism: 'non-primary-report-item' };
  }

  if (getRuntimeTechnicalIdentity(finding) !== null) {
    return { kind: 'supported-deterministic', mechanism: 'runtime-technical-identity' };
  }

  if (hasRecognizedPartialTechnicalIdentity(finding)) {
    return {
      kind: 'partial-recognized-structured',
      mechanism: 'runtime-technical-identity'
    };
  }

  const structuredAccessibility = inspectStructuredAccessibility(finding);

  if (structuredAccessibility !== null && structuredAccessibility !== 'partial') {
    return {
      kind: 'supported-deterministic',
      mechanism:
        structuredAccessibility.identity === null
          ? 'accessibility-defect-basis'
          : 'structured-semantic-control'
    };
  }

  if (structuredAccessibility === 'partial') {
    return {
      kind: 'partial-recognized-structured',
      mechanism: 'structured-semantic-control'
    };
  }

  const pageRule = inspectPageRule(finding);

  if (pageRule === 'supported') {
    return { kind: 'supported-deterministic', mechanism: 'deterministic-page-rule' };
  }

  if (pageRule === 'partial') {
    return {
      kind: 'partial-recognized-structured',
      mechanism: 'deterministic-page-rule'
    };
  }

  return { kind: 'exploratory' };
}

export function requiresPersistedHumanNarrative(finding: UnifiedFinding): boolean {
  return determineHumanNarrativeRoute(finding).kind === 'exploratory';
}

function getAdmittedModelClaim(finding: UnifiedFinding): {
  observation: string;
  reasoning: string;
} {
  let admittedModelSummary: string | null = null;

  for (const occurrence of finding.occurrences) {
    for (const evidence of occurrence.evidence) {
      if (evidence.source === 'model' && admittedModelSummary === null) {
        admittedModelSummary = evidence.summary;
      }

      if (evidence.rawSource?.type !== 'exploratory-qa-finding') {
        continue;
      }

      const parsed = exploratoryQaFindingSchema.safeParse(evidence.rawSource.value);

      if (parsed.success) {
        return {
          observation: parsed.data.evidence,
          reasoning: parsed.data.reasoning
        };
      }

      const raw = evidence.rawSource.value;

      if (typeof raw === 'object' && raw !== null) {
        const observation =
          'evidence' in raw && typeof raw.evidence === 'string' ? raw.evidence : evidence.summary;
        const reasoning =
          'reasoning' in raw && typeof raw.reasoning === 'string'
            ? raw.reasoning
            : finding.description;

        return { observation, reasoning };
      }
    }
  }

  if (admittedModelSummary !== null) {
    return {
      observation: admittedModelSummary,
      reasoning: finding.description
    };
  }

  throw new CheckQuestError(
    'REPORTING',
    'An exploratory finding required human wording but had no admitted model claim.',
    { phase: 'human-narrative-input', runId: undefined }
  );
}

function hasLinkedBrowserData(finding: UnifiedFinding): boolean {
  const route = determineHumanNarrativeRoute(finding);

  if (
    route.kind === 'supported-deterministic' &&
    (route.mechanism === 'runtime-technical-identity' ||
      route.mechanism === 'structured-semantic-control' ||
      route.mechanism === 'accessibility-defect-basis')
  ) {
    return true;
  }

  return finding.occurrences.some(occurrence =>
    occurrence.evidence.some(evidence => evidence.source !== 'model')
  );
}

function getNarrativeEvidenceSource(
  report: SiteAgentReport,
  finding: UnifiedFinding
): ExploratoryHumanNarrativeInput['evidenceSource'] {
  const pairs = new Set<string>();

  for (const occurrence of finding.occurrences) {
    for (const evidence of occurrence.evidence) {
      if (
        evidence.rawReference?.pageNumber !== undefined &&
        evidence.rawReference.candidateReference !== undefined
      ) {
        pairs.add(
          JSON.stringify([
            evidence.rawReference.pageNumber,
            evidence.rawReference.candidateReference
          ])
        );
      }
    }
  }

  const directlyObserved = report.inspectedPages
    .flatMap(page => page.presentationEvidence ?? [])
    .some(
      evidence =>
        pairs.has(JSON.stringify([evidence.pageNumber, evidence.candidateReference])) &&
        evidence.screenshotPaths.length > 0 &&
        evidence.shownTargetCount > 0
    );

  if (directlyObserved) {
    return 'Observed directly';
  }

  return hasLinkedBrowserData(finding) ? 'Seen in browser data' : 'AI analysis only';
}

export function buildExploratoryHumanNarrativeInput(
  report: SiteAgentReport,
  finding: UnifiedFinding
): ExploratoryHumanNarrativeInput {
  const assessment =
    finding.verification.state === 'verified'
      ? 'Confirmed issue'
      : finding.verification.state === 'inconclusive'
        ? 'Needs human review'
        : null;

  if (assessment === null) {
    throw new CheckQuestError('REPORTING', 'An ineligible finding reached narrative enrichment.', {
      phase: 'human-narrative-input',
      runId: report.runId
    });
  }

  const admitted = getAdmittedModelClaim(finding);

  return {
    findingReference: finding.findingReference,
    supportedClaim: {
      title: getNarratorSafeCanonicalTitle(finding),
      condition: admitted.observation
    },
    humanVisibleEvidenceValues: [...collectHumanVisibleEvidenceValues(finding)],
    evidenceSource: getNarrativeEvidenceSource(report, finding),
    assessment,
    affectedPageCount: new Set(finding.occurrences.map(occurrence => occurrence.pageUrl)).size
  };
}

function buildNarrativePrompt(input: ExploratoryHumanNarrativeInput): string {
  return `Rewrite one final, already-admitted CheckQuest report finding for a non-technical reader.

Return JSON only with exactly: plainTitle, plainCondition.
Each value must be plain text, not Markdown. Do not add a new defect, cause, consequence, certainty, affected user, business effect, security effect, page, remediation, or investigation target. Do not mention internal evidence mechanics.

Do not infer a vendor, product, framework, component purpose, interface purpose, or business purpose from an identifier, internal name, selector, UUID, or reference. Only use semantic labels and human-visible evidence explicitly supplied in the frozen input.

Evidence and assessment are fixed context, not fields you may return or alter. When evidenceSource is "AI analysis only", describe a possible suggestion rather than an established condition. Do not use words such as confirmed, definitely, proven, or verified.

Final frozen input:
${JSON.stringify(input, null, 2)}`;
}

export const generateExploratoryHumanNarrative: HumanNarrativeGenerator = async (
  input,
  options = {}
) => {
  const ai = new GoogleGenAI({
    apiKey: requireGeminiApiKey(options.geminiApiKey)
  });
  const response = await runGeminiRequest(
    'generating human report narrative',
    requestOptions =>
      ai.models.generateContent({
        model: options.model ?? aiConfig.model,
        contents: buildNarrativePrompt(input),
        config: {
          responseMimeType: 'application/json',
          abortSignal: requestOptions.abortSignal,
          httpOptions: {
            timeout: requestOptions.timeout_ms,
            retryOptions: { attempts: 1 }
          }
        }
      }),
    { onEvent: options.onEvent, signal: options.signal }
  );

  return parseModelJsonResponse(
    response.text,
    'human-report-narrative-response',
    exploratoryHumanNarrativeSchema
  );
};

function normalizeFrozenCanonicalProse(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();

  if (normalized.length === 0 || /[.!?]["'’”)]?$/.test(normalized)) {
    return normalized;
  }

  return `${normalized}.`;
}

function buildDeterministicExploratoryStatements(
  finding: UnifiedFinding,
  generated: ExploratoryHumanNarrativeOutput
): Pick<PersistedExploratoryHumanNarrative, 'impactStatement' | 'whatToCheck'> {
  const canonicalImpact = normalizeFrozenCanonicalProse(finding.description);
  const normalizedTitle = normalizeFrozenCanonicalProse(finding.title);
  const normalizedCondition = normalizeFrozenCanonicalProse(generated.plainCondition);
  const impactStatement =
    canonicalImpact.length === 0 ||
    normalizedValue(canonicalImpact) === normalizedValue(normalizedTitle) ||
    normalizedValue(canonicalImpact) === normalizedValue(normalizedCondition)
      ? 'CheckQuest has not established any further user impact yet.'
      : canonicalImpact;
  const whatToCheck =
    finding.verification.state === 'verified'
      ? 'Review the confirmed condition and decide how the affected value or behavior should be corrected.'
      : 'Confirm whether the reported condition is present and unintended. If confirmed, review the affected value or behavior and decide whether it should be corrected.';

  return { impactStatement, whatToCheck };
}

function validateNarrativeCollection(
  report: SiteAgentReportV4
): Set<UnifiedFinding['findingReference']> {
  const findingReferences = new Set(report.findings.map(finding => finding.findingReference));
  const seen = new Set<UnifiedFinding['findingReference']>();

  for (const narrative of report.humanNarratives.exploratory) {
    if (seen.has(narrative.findingReference)) {
      throw new CheckQuestError(
        'REPORTING',
        'A report contains duplicate human narrative references.',
        {
          phase: 'human-narrative-integrity',
          runId: report.runId
        }
      );
    }

    seen.add(narrative.findingReference);

    if (!findingReferences.has(narrative.findingReference)) {
      throw new CheckQuestError(
        'REPORTING',
        'A human narrative points to no eligible report item.',
        {
          phase: 'human-narrative-integrity',
          runId: report.runId
        }
      );
    }
  }

  return seen;
}

function validateCompleteNarratives(report: SiteAgentReportV4): void {
  const requiredReferences = report.findings
    .filter(requiresPersistedHumanNarrative)
    .map(finding => finding.findingReference);
  const required = new Set(requiredReferences);
  const seen = validateNarrativeCollection(report);

  if (required.size !== requiredReferences.length) {
    throw new CheckQuestError(
      'REPORTING',
      'Multiple report items share one human narrative reference.',
      {
        phase: 'human-narrative-integrity',
        runId: report.runId
      }
    );
  }

  for (const reference of seen) {
    if (!required.has(reference)) {
      throw new CheckQuestError(
        'REPORTING',
        'A persisted exploratory narrative was assigned to a deterministic report item.',
        {
          phase: 'human-narrative-integrity',
          runId: report.runId
        }
      );
    }
  }

  if (required.size !== seen.size || [...required].some(reference => !seen.has(reference))) {
    throw new CheckQuestError('REPORTING', 'A required exploratory human narrative is missing.', {
      phase: 'human-narrative-integrity',
      runId: report.runId
    });
  }
}

export function getPersistedHumanNarrative(
  report: SiteAgentReport,
  findingReference: UnifiedFinding['findingReference']
): PersistedExploratoryHumanNarrative | null {
  if (report.reportSchemaVersion === '3') {
    return null;
  }

  if (report.humanNarratives.state !== 'complete') {
    throw new CheckQuestError('REPORTING', 'Schema-v4 human narratives are not complete.', {
      phase: 'human-narrative-integrity',
      runId: report.runId
    });
  }

  validateNarrativeCollection(report);

  return (
    report.humanNarratives.exploratory.find(
      narrative => narrative.findingReference === findingReference
    ) ?? null
  );
}

export async function enrichSiteAgentReportWithHumanNarratives(
  report: SiteAgentReport,
  options: HumanNarrativeEnrichmentOptions = {}
): Promise<SiteAgentReportV4> {
  if (report.reportSchemaVersion !== '4') {
    throw new CheckQuestError('REPORTING', 'Only new schema-v4 reports can be enriched.', {
      phase: 'human-narrative-enrichment',
      runId: report.runId
    });
  }

  if (report.humanNarratives.state === 'complete') {
    validateCompleteNarratives(report);
    return report;
  }

  if (report.humanNarratives.exploratory.length !== 0) {
    throw new CheckQuestError('REPORTING', 'A pending report contains partial human narratives.', {
      phase: 'human-narrative-integrity',
      runId: report.runId
    });
  }

  const generator = options.generateNarrative ?? generateExploratoryHumanNarrative;
  const narratives: PersistedExploratoryHumanNarrative[] = [];
  const routes = report.findings.map(finding => ({
    finding,
    route: determineHumanNarrativeRoute(finding)
  }));

  const partial = routes.find(item => item.route.kind === 'partial-recognized-structured');

  if (partial !== undefined && partial.route.kind === 'partial-recognized-structured') {
    throw new CheckQuestError(
      'REPORTING',
      `A recognized ${partial.route.mechanism} narrative mechanism is incomplete.`,
      {
        phase: 'human-narrative-routing',
        runId: report.runId
      }
    );
  }

  for (const { finding, route } of routes.filter(item => item.route.kind === 'exploratory')) {
    if (route.kind !== 'exploratory') {
      continue;
    }

    let generated: ExploratoryHumanNarrativeOutput;

    try {
      generated = exploratoryHumanNarrativeSchema.parse(
        await generator(buildExploratoryHumanNarrativeInput(report, finding), options)
      );
      validateGeneratedHumanNarrative(finding, generated);
    } catch (error: unknown) {
      if (error instanceof CheckQuestError && error.code === 'CANCELLED') {
        throw error;
      }

      throw new CheckQuestError(
        'REPORTING',
        'Required exploratory human narrative generation failed.',
        {
          phase: 'human-narrative-generation',
          runId: report.runId,
          cause: error
        }
      );
    }

    narratives.push({
      findingReference: finding.findingReference,
      ...generated,
      ...buildDeterministicExploratoryStatements(finding, generated)
    });
  }

  const enriched: SiteAgentReportV4 = {
    ...report,
    humanNarratives: {
      state: 'complete',
      exploratory: narratives
    }
  };

  validateCompleteNarratives(enriched);
  return enriched;
}
