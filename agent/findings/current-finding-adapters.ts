import type { ExploratoryQaFinding } from '../analysis/exploratory-qa-schema';
import type { PageFinding } from '../analysis/evaluate-page';
import type { FindingInvestigationOutcome } from '../investigation/evaluate-finding-investigation-outcome';
import type { ExploratoryFindingResult } from '../inspection/inspected-page-result';
import type { TechnicalObservationDiagnostic } from '../analysis/technical-observation-reconciliation';
import {
  deriveLogicalFindingVerification,
  deriveOccurrenceVerification
} from './derive-verification-state';
import type {
  CandidateFindingRawReference,
  FindingEvidence,
  FindingEvidenceReference,
  FindingEvidenceRelation,
  FindingOccurrence,
  FindingOccurrenceReference,
  FindingRawReference,
  FindingReference,
  UnifiedFinding
} from './finding-model';

export type ExistingPageFindingCode =
  | 'HTTP_STATUS_UNKNOWN'
  | 'HTTP_SERVER_ERROR'
  | 'HTTP_CLIENT_ERROR'
  | 'EMPTY_PAGE_TITLE'
  | 'NO_PRIMARY_HEADINGS'
  | 'VISIBLE_ERROR_PAGE';

export interface PageFindingRuleEvidenceClassification {
  relation: FindingEvidenceRelation;

  verificationCapable: boolean;

  rationale: string;
}

/*
 * Explicit classification for every rule currently emitted by
 * evaluatePageObservation().
 *
 * These classifications concern the exact assertion in each PageFinding
 * title. They do not grant broader meaning to the observation.
 */
export const pageFindingRuleEvidenceClassifications = {
  HTTP_STATUS_UNKNOWN: {
    relation: 'inconclusive',
    verificationCapable: false,
    rationale:
      'Failure to observe a main-document status is a measurement limitation, not proof of a website defect.'
  },

  HTTP_SERVER_ERROR: {
    relation: 'supports',
    verificationCapable: true,
    rationale:
      'The observed main-document response status directly proves the specific server-error assertion.'
  },

  HTTP_CLIENT_ERROR: {
    relation: 'supports',
    verificationCapable: true,
    rationale:
      'The observed main-document response status directly proves the specific client-error assertion.'
  },

  EMPTY_PAGE_TITLE: {
    relation: 'supports',
    verificationCapable: true,
    rationale:
      'The deterministically observed empty document title directly proves the empty-title assertion.'
  },

  NO_PRIMARY_HEADINGS: {
    relation: 'supports',
    verificationCapable: true,
    rationale:
      'The deterministic H1/H2 observation directly proves the narrowly worded absence assertion.'
  },

  VISIBLE_ERROR_PAGE: {
    relation: 'supports',
    verificationCapable: false,
    rationale:
      'Matching common error-page wording is a deterministic heuristic, but it does not by itself prove that the page is defective.'
  }
} as const satisfies Record<ExistingPageFindingCode, PageFindingRuleEvidenceClassification>;

export interface FindingAdapterContext {
  findingReference: FindingReference;

  fingerprint: string;

  occurrenceReference: FindingOccurrenceReference;

  pageUrl: string;

  pageTitle: string;

  screenshotReferences?: string[];

  redundantInvestigationSkipped?: boolean;

  rawReference?: FindingRawReference;
}

export interface InvestigationEvidenceAssessment {
  relation: FindingEvidenceRelation;

  verificationCapable: boolean;

  /*
   * The assessment summary must describe how this outcome bears on the
   * exact finding assertion. The raw Stage 4 outcome is retained separately.
   */
  summary: string;
}

export function assessFindingInvestigationOutcome(
  finding: ExploratoryQaFinding,
  outcome: FindingInvestigationOutcome
): InvestigationEvidenceAssessment {
  if (finding.evidenceTarget === null || outcome.status === 'inconclusive') {
    return {
      relation: 'inconclusive',
      verificationCapable: false,
      summary: `${outcome.summary} The outcome does not deterministically prove or disprove this finding assertion.`
    };
  }

  return {
    relation: 'inconclusive',
    verificationCapable: false,
    summary: `${outcome.summary} The deterministic interaction outcome has no explicit trusted assessment tying it to the specific finding assertion, so it remains contextual and non-verifying.`
  };
}

function isExistingPageFindingCode(code: string): code is ExistingPageFindingCode {
  return code in pageFindingRuleEvidenceClassifications;
}

function createOccurrence(
  context: FindingAdapterContext,
  target: ExploratoryQaFinding['evidenceTarget'],
  evidence: FindingEvidence[]
): FindingOccurrence {
  return {
    occurrenceReference: context.occurrenceReference,

    pageUrl: context.pageUrl,

    pageTitle: context.pageTitle,

    target,

    evidence,

    verification: deriveOccurrenceVerification(evidence),

    screenshotReferences: [...(context.screenshotReferences ?? [])],

    redundantInvestigationSkipped: context.redundantInvestigationSkipped ?? false
  };
}

function createUnifiedFinding(input: {
  context: FindingAdapterContext;
  category: UnifiedFinding['category'];
  severity: UnifiedFinding['severity'];
  title: string;
  description: string;
  suggestedCheck: string | null;
  occurrence: FindingOccurrence;
}): UnifiedFinding {
  const occurrences = [input.occurrence];

  return {
    findingReference: input.context.findingReference,

    fingerprint: input.context.fingerprint,

    category: input.category,

    severity: input.severity,

    title: input.title,

    description: input.description,

    suggestedCheck: input.suggestedCheck,

    occurrences,

    verification: deriveLogicalFindingVerification(occurrences)
  };
}

export function adaptPageFinding(
  finding: PageFinding,
  context: Omit<FindingAdapterContext, 'pageUrl'>
): UnifiedFinding {
  const classification = isExistingPageFindingCode(finding.code)
    ? pageFindingRuleEvidenceClassifications[finding.code]
    : {
        relation: 'inconclusive' as const,
        verificationCapable: false,
        rationale:
          'Unknown rule codes remain non-verifying until they receive an explicit assertion-specific classification.'
      };

  const evidenceReference: FindingEvidenceReference = `evidence-${context.occurrenceReference}-rule`;

  const evidence: FindingEvidence[] = [
    {
      evidenceReference,
      source: 'deterministic-rule',
      kind: 'rule-observation',
      relation: classification.relation,
      verificationCapable: classification.verificationCapable,
      summary: `${finding.evidence} ${classification.rationale}`,
      rawReference: context.rawReference,
      rawSource: {
        type: 'page-finding',
        value: finding
      }
    }
  ];

  const completeContext: FindingAdapterContext = {
    ...context,
    pageUrl: finding.url
  };

  const occurrence = createOccurrence(completeContext, null, evidence);

  return createUnifiedFinding({
    context: completeContext,
    category: 'technical',
    severity: finding.severity,
    title: finding.title,
    description: finding.evidence,
    suggestedCheck: null,
    occurrence
  });
}

export function adaptExploratoryQaFinding(
  finding: ExploratoryQaFinding,
  context: FindingAdapterContext,
  browserDiagnostics: readonly TechnicalObservationDiagnostic[] = []
): UnifiedFinding {
  const evidenceReference: FindingEvidenceReference = `evidence-${context.occurrenceReference}-model`;

  const evidence: FindingEvidence[] = [
    {
      evidenceReference,
      source: 'model',
      kind: 'model-observation',
      relation: 'supports',

      /*
       * A model observation may identify a useful candidate, but it can
       * never independently establish verification.
       */
      verificationCapable: false,

      summary: finding.evidence,
      rawReference: context.rawReference,
      rawSource: {
        type: 'exploratory-qa-finding',
        value: finding
      }
    }
  ];

  browserDiagnostics.forEach((diagnostic, index) => {
    const summary =
      diagnostic.kind === 'console-error'
        ? `Console error: ${diagnostic.value.text} Source: ${diagnostic.value.sourceUrl ?? 'unknown'}; line ${diagnostic.value.lineNumber}, column ${diagnostic.value.columnNumber}.`
        : `Browser request: ${diagnostic.value.method} ${diagnostic.value.url} failed with ${diagnostic.value.failureText} (${diagnostic.value.resourceType}).`;

    evidence.push({
      evidenceReference: `evidence-${context.occurrenceReference}-browser-${index + 1}`,
      source: 'browser',
      kind: 'browser-observation',
      relation: 'inconclusive',
      verificationCapable: false,
      summary,
      rawReference: context.rawReference,
      rawSource: {
        type:
          diagnostic.kind === 'console-error'
            ? 'console-error-observation'
            : 'failed-request-observation',
        value: diagnostic.value
      }
    });
  });

  const occurrence = createOccurrence(context, finding.evidenceTarget, evidence);

  return createUnifiedFinding({
    context,
    category: finding.category,
    severity: finding.severity,
    title: finding.title,
    description: finding.reasoning,
    suggestedCheck: finding.suggestedCheck,
    occurrence
  });
}

export function adaptFindingInvestigationOutcomeEvidence(
  outcome: FindingInvestigationOutcome,
  input: {
    occurrenceReference: FindingOccurrenceReference;
    assessment: InvestigationEvidenceAssessment;
    rawReference?: FindingRawReference;
  }
): FindingEvidence {
  return {
    evidenceReference: `evidence-${input.occurrenceReference}-investigation`,
    source: 'investigation',
    kind: 'investigation-outcome',
    relation: input.assessment.relation,
    verificationCapable: input.assessment.verificationCapable,
    summary: input.assessment.summary,
    rawReference: input.rawReference,
    rawSource: {
      type: 'finding-investigation-outcome',
      value: outcome
    }
  };
}

export function adaptExploratoryFindingResult(
  result: ExploratoryFindingResult,
  context: FindingAdapterContext & {
    rawReference: Pick<CandidateFindingRawReference, 'pageNumber'>;
  },
  assessment: InvestigationEvidenceAssessment
): UnifiedFinding {
  const unifiedFinding = adaptExploratoryQaFinding(result.finding, {
    ...context,
    rawReference: {
      ...context.rawReference,
      candidateReference: result.candidateReference
    }
  });

  const occurrence = unifiedFinding.occurrences[0];

  occurrence.evidence.push(
    adaptFindingInvestigationOutcomeEvidence(result.outcome, {
      occurrenceReference: occurrence.occurrenceReference,
      assessment,
      rawReference: {
        ...context.rawReference,
        candidateReference: result.candidateReference
      }
    })
  );

  occurrence.verification = deriveOccurrenceVerification(occurrence.evidence);

  unifiedFinding.verification = deriveLogicalFindingVerification(unifiedFinding.occurrences);

  return unifiedFinding;
}
