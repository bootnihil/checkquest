import type { ExploratoryQaFinding } from '../analysis/exploratory-qa-schema';
import {
  createDisclosureStateTargetFingerprint,
  createSelectOptionTargetFingerprint,
  createTabStateTargetFingerprint
} from '../investigation/finding-fingerprint';
import type { FindingInvestigationOutcome } from '../investigation/evaluate-finding-investigation-outcome';
import {
  adaptFindingInvestigationOutcomeEvidence,
  assessFindingInvestigationOutcome,
  type InvestigationEvidenceAssessment
} from './current-finding-adapters';
import {
  deriveLogicalFindingVerification,
  deriveOccurrenceVerification
} from './derive-verification-state';
import type {
  CandidateFindingRawReference,
  FindingEvidence,
  FindingOccurrence,
  FindingTarget,
  FindingVerificationState,
  UnifiedFinding
} from './finding-model';

export interface UnifiedFindingRegistry {
  findingsByFingerprint: Map<string, UnifiedFinding>;
  nextFindingNumber: number;
  nextOccurrenceNumber: number;
  nextEvidenceNumber: number;
}

export interface RegisterCompatibilityOccurrenceInput {
  fingerprint: string;
  finding: ExploratoryQaFinding;
  pageUrl: string;
  pageTitle: string;
  target: FindingTarget;
  evidenceSummaries: string[];
  screenshotPath: string | null;
  redundantInvestigationSkipped: boolean;
}

interface AttachInvestigationOutcomeBase {
  fingerprint: string;
  pageUrl: string;
  target: FindingTarget;
  finding: ExploratoryQaFinding;
  outcome: FindingInvestigationOutcome;

  /*
   * Optional only for trusted assertion-specific code. Model output and the
   * legacy outcome itself must never manufacture this assessment. When it is
   * absent, the adapter deliberately records contextual evidence only.
   */
  assessment?: InvestigationEvidenceAssessment;
}

export type AttachInvestigationOutcomeInput = AttachInvestigationOutcomeBase &
  (
    | CandidateFindingRawReference
    | {
        pageNumber?: undefined;
        candidateReference?: undefined;
      }
  );

export function createUnifiedFindingRegistry(): UnifiedFindingRegistry {
  return {
    findingsByFingerprint: new Map(),
    nextFindingNumber: 1,
    nextOccurrenceNumber: 1,
    nextEvidenceNumber: 1
  };
}

function targetIdentity(target: FindingTarget): string {
  if (target === null) {
    return 'target|null';
  }

  switch (target.kind) {
    case 'select-option':
      return createSelectOptionTargetFingerprint(target);

    case 'disclosure-state':
      return createDisclosureStateTargetFingerprint(target);

    case 'tab-state':
      return createTabStateTargetFingerprint(target);
  }
}

function evidenceIdentity(evidence: FindingEvidence): string {
  return JSON.stringify({
    source: evidence.source,
    kind: evidence.kind,
    relation: evidence.relation,
    verificationCapable: evidence.verificationCapable,
    summary: evidence.summary,
    rawSource: evidence.rawSource ?? null
  });
}

function assignEvidenceReference(
  registry: UnifiedFindingRegistry,
  evidence: FindingEvidence
): FindingEvidence {
  const numberedEvidence = {
    ...evidence,
    evidenceReference: `evidence-${registry.nextEvidenceNumber}`
  } satisfies FindingEvidence;

  registry.nextEvidenceNumber += 1;

  return numberedEvidence;
}

function mergeEvidence(
  registry: UnifiedFindingRegistry,
  occurrence: FindingOccurrence,
  evidenceItems: readonly FindingEvidence[]
): void {
  const identities = new Set(occurrence.evidence.map(evidenceIdentity));

  for (const evidence of evidenceItems) {
    const identity = evidenceIdentity(evidence);

    if (identities.has(identity)) {
      continue;
    }

    occurrence.evidence.push(assignEvidenceReference(registry, evidence));

    identities.add(identity);
  }

  occurrence.verification = deriveOccurrenceVerification(occurrence.evidence);
}

function addScreenshotContext(
  registry: UnifiedFindingRegistry,
  occurrence: FindingOccurrence,
  screenshotPath: string | null
): void {
  if (screenshotPath === null || occurrence.screenshotReferences.includes(screenshotPath)) {
    return;
  }

  occurrence.screenshotReferences.push(screenshotPath);

  mergeEvidence(registry, occurrence, [
    {
      evidenceReference: 'evidence-screenshot-context',
      source: 'browser',
      kind: 'screenshot',
      relation: 'inconclusive',
      verificationCapable: false,
      summary: `Full-page screenshot captured as contextual evidence: ${screenshotPath}. It does not independently verify the finding.`
    }
  ]);
}

function findOccurrence(
  finding: UnifiedFinding,
  pageUrl: string,
  target: FindingTarget
): FindingOccurrence | undefined {
  const identity = targetIdentity(target);

  return finding.occurrences.find(
    occurrence => occurrence.pageUrl === pageUrl && targetIdentity(occurrence.target) === identity
  );
}

function mergeOccurrence(
  registry: UnifiedFindingRegistry,
  finding: UnifiedFinding,
  incoming: FindingOccurrence,
  screenshotPath: string | null
): FindingOccurrence {
  let occurrence = findOccurrence(finding, incoming.pageUrl, incoming.target);

  if (occurrence === undefined) {
    occurrence = {
      ...incoming,
      occurrenceReference: `occurrence-${registry.nextOccurrenceNumber}`,
      evidence: [],
      screenshotReferences: [],
      verification: deriveOccurrenceVerification([])
    };

    registry.nextOccurrenceNumber += 1;

    finding.occurrences.push(occurrence);
  } else {
    occurrence.redundantInvestigationSkipped =
      occurrence.redundantInvestigationSkipped || incoming.redundantInvestigationSkipped;
  }

  mergeEvidence(registry, occurrence, incoming.evidence);

  for (const reference of incoming.screenshotReferences) {
    addScreenshotContext(registry, occurrence, reference);
  }

  addScreenshotContext(registry, occurrence, screenshotPath);

  finding.verification = deriveLogicalFindingVerification(finding.occurrences);

  return occurrence;
}

export function registerUnifiedPageFindings(
  registry: UnifiedFindingRegistry,
  findings: readonly UnifiedFinding[],
  screenshotPath: string | null = null
): void {
  for (const incomingFinding of findings) {
    let finding = registry.findingsByFingerprint.get(incomingFinding.fingerprint);

    if (finding === undefined) {
      finding = {
        ...incomingFinding,
        findingReference: `finding-${registry.nextFindingNumber}`,
        occurrences: [],
        verification: deriveLogicalFindingVerification([])
      };

      registry.nextFindingNumber += 1;

      registry.findingsByFingerprint.set(finding.fingerprint, finding);
    }

    for (const occurrence of incomingFinding.occurrences) {
      mergeOccurrence(registry, finding, occurrence, screenshotPath);
    }
  }
}

export function registerCompatibilityOccurrence(
  registry: UnifiedFindingRegistry,
  input: RegisterCompatibilityOccurrenceInput
): FindingOccurrence {
  const evidence = input.evidenceSummaries.map(
    (summary, index): FindingEvidence => ({
      evidenceReference: `evidence-compatibility-${index + 1}`,
      source: 'browser',
      kind: 'browser-observation',
      relation: 'supports',
      verificationCapable: false,
      summary: `${summary} This exact-target occurrence evidence is contextual and does not independently verify the semantic finding.`
    })
  );

  const occurrence: FindingOccurrence = {
    occurrenceReference: 'occurrence-1',
    pageUrl: input.pageUrl,
    pageTitle: input.pageTitle,
    target: input.target,
    evidence,
    verification: deriveOccurrenceVerification(evidence),
    screenshotReferences: [],
    redundantInvestigationSkipped: input.redundantInvestigationSkipped
  };

  registerUnifiedPageFindings(
    registry,
    [
      {
        findingReference: 'finding-1',
        fingerprint: input.fingerprint,
        category: input.finding.category,
        severity: input.finding.severity,
        title: input.finding.title,
        description: input.finding.reasoning,
        suggestedCheck: input.finding.suggestedCheck,
        occurrences: [occurrence],
        verification: deriveLogicalFindingVerification([occurrence])
      }
    ],
    input.screenshotPath
  );

  const finding = registry.findingsByFingerprint.get(input.fingerprint);

  const registeredOccurrence =
    finding === undefined ? undefined : findOccurrence(finding, input.pageUrl, input.target);

  if (registeredOccurrence === undefined) {
    throw new Error(`Unified occurrence registration failed for "${input.fingerprint}".`);
  }

  return registeredOccurrence;
}

export function attachInvestigationOutcome(
  registry: UnifiedFindingRegistry,
  input: AttachInvestigationOutcomeInput
): void {
  const finding = registry.findingsByFingerprint.get(input.fingerprint);

  const occurrence =
    finding === undefined ? undefined : findOccurrence(finding, input.pageUrl, input.target);

  if (finding === undefined || occurrence === undefined) {
    throw new Error(
      `Cannot attach investigation evidence to missing unified occurrence "${input.fingerprint}" on "${input.pageUrl}".`
    );
  }

  const assessment =
    input.assessment ?? assessFindingInvestigationOutcome(input.finding, input.outcome);
  const candidateRawReference: CandidateFindingRawReference | undefined =
    input.candidateReference === undefined || input.pageNumber === undefined
      ? undefined
      : {
          pageNumber: input.pageNumber,
          candidateReference: input.candidateReference
        };

  if (candidateRawReference !== undefined) {
    for (const evidence of occurrence.evidence) {
      if (evidence.kind !== 'model-observation' || evidence.source !== 'model') {
        continue;
      }

      evidence.rawReference = {
        ...evidence.rawReference,
        ...candidateRawReference
      };
    }
  }

  mergeEvidence(registry, occurrence, [
    adaptFindingInvestigationOutcomeEvidence(input.outcome, {
      occurrenceReference: occurrence.occurrenceReference,
      assessment,
      rawReference: candidateRawReference
    })
  ]);

  finding.verification = deriveLogicalFindingVerification(finding.occurrences);
}

export function markOccurrenceSuppressed(
  registry: UnifiedFindingRegistry,
  input: {
    fingerprint: string;
    pageUrl: string;
    target: FindingTarget;
  }
): void {
  const finding = registry.findingsByFingerprint.get(input.fingerprint);

  const occurrence =
    finding === undefined ? undefined : findOccurrence(finding, input.pageUrl, input.target);

  if (occurrence !== undefined) {
    occurrence.redundantInvestigationSkipped = true;
  }
}

export function getUnifiedFindings(registry: UnifiedFindingRegistry): UnifiedFinding[] {
  return Array.from(registry.findingsByFingerprint.values());
}

export function getUnifiedFindingVerificationState(
  registry: UnifiedFindingRegistry,
  fingerprint: string
): FindingVerificationState | null {
  return registry.findingsByFingerprint.get(fingerprint)?.verification.state ?? null;
}
