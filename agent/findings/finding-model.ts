import type { ExploratoryQaFinding } from '../analysis/exploratory-qa-schema';
import type { FindingSeverity } from '../analysis/evaluate-page';

export type FindingVerificationState = 'verified' | 'not-verified' | 'inconclusive';

export type FindingEvidenceRelation = 'supports' | 'contradicts' | 'inconclusive';

export type FindingEvidenceSource = 'deterministic-rule' | 'model' | 'browser' | 'investigation';

export type FindingEvidenceKind =
  | 'rule-observation'
  | 'model-observation'
  | 'browser-observation'
  | 'investigation-outcome'
  | 'screenshot';

export type FindingReference = `finding-${number}` | `known-${number}`;

export type FindingOccurrenceReference = `occurrence-${number}`;

export type FindingEvidenceReference = `evidence-${string}`;

export type FindingCategory = ExploratoryQaFinding['category'];

export type FindingTarget = ExploratoryQaFinding['evidenceTarget'];

export interface FindingRawReference {
  pageNumber?: number;
  candidateReference?: string;
  investigationStep?: number;
}

export interface CandidateFindingRawReference extends FindingRawReference {
  pageNumber: number;
  candidateReference: string;
}

export interface FindingRawSource {
  type:
    | 'page-finding'
    | 'exploratory-qa-finding'
    | 'finding-investigation-outcome'
    | 'console-error-observation'
    | 'failed-request-observation';

  /*
   * Compatibility adapters retain the exact existing source object here.
   * The unified model does not interpret this value when deriving status.
   */
  value: unknown;
}

export interface FindingEvidence {
  evidenceReference: FindingEvidenceReference;

  source: FindingEvidenceSource;

  kind: FindingEvidenceKind;

  relation: FindingEvidenceRelation;

  /*
   * Deterministic provenance alone is not enough.
   *
   * This is true only when the evidence is capable of proving or
   * disproving the exact assertion made by this logical finding.
   */
  verificationCapable: boolean;

  summary: string;

  rawReference?: FindingRawReference;

  rawSource?: FindingRawSource;
}

export interface FindingVerification {
  state: FindingVerificationState;

  reason: string;

  evidenceReferences: FindingEvidenceReference[];
}

export interface FindingOccurrence {
  occurrenceReference: FindingOccurrenceReference;

  pageUrl: string;

  pageTitle: string;

  target: FindingTarget;

  evidence: FindingEvidence[];

  verification: FindingVerification;

  screenshotReferences: string[];

  redundantInvestigationSkipped: boolean;
}

export interface UnifiedFinding {
  /*
   * The reference identifies this logical finding inside a run.
   * The fingerprint is the stable canonical identity used to recognize it.
   */
  findingReference: FindingReference;

  fingerprint: string;

  category: FindingCategory;

  severity: FindingSeverity;

  title: string;

  description: string;

  suggestedCheck: string | null;

  /*
   * A logical finding must contain at least one occurrence.
   * Adapters and future registries are responsible for preserving that
   * invariant when constructing this deliberately small data model.
   */
  occurrences: FindingOccurrence[];

  verification: FindingVerification;
}
