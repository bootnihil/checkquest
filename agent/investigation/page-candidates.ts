import type {
  ExploratoryQaFinding
} from '../analysis/exploratory-qa-schema';

export type PageCandidateReference =
  `candidate-${number}`;

export interface PageCandidate {
  reference: PageCandidateReference;
  finding: ExploratoryQaFinding;
}

export interface InvestigablePageCandidate
  extends PageCandidate {
  finding: ExploratoryQaFinding & {
    evidenceTarget: NonNullable<ExploratoryQaFinding['evidenceTarget']>;
  };
}

export function assignPageCandidateReferences(
  findings: ExploratoryQaFinding[]
): PageCandidate[] {
  return findings.map(
    (finding, index) => ({
      reference: `candidate-${index + 1}`,
      finding
    })
  );
}

export function isInvestigablePageCandidate(
  candidate: PageCandidate
): candidate is InvestigablePageCandidate {
  return candidate.finding.evidenceTarget !== null;
}
