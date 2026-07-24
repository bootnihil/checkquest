import type {
  ExploratoryQaFinding
} from '../analysis/exploratory-qa-schema';
import type {
  UnifiedFinding
} from '../findings/finding-model';
import type {
  FindingInvestigationOutcome
} from '../investigation/evaluate-finding-investigation-outcome';
import type {
  KnownFindingMatchingBasis
} from '../investigation/known-findings';

export interface SiteWideFindingOccurrence {
  pageNumber: number;
  findingNumber:
    number | null;
  pageUrl: string;
  pageTitle: string;
  screenshotPath:
    string | null;
  knownFindingReference:
    string | null;
  occurrenceEvidence:
    string[];
  matchingBases:
    KnownFindingMatchingBasis[];
  redundantInvestigationSkipped:
    boolean;
  verificationOutcome:
    FindingInvestigationOutcome | null;
}

export interface SiteWideExploratoryFinding {
  fingerprint: string;
  representativeFinding:
    ExploratoryQaFinding;
  occurrenceCount: number;
  affectedPageCount: number;
  occurrences:
    SiteWideFindingOccurrence[];
}

function getModelFinding(
  finding:
    UnifiedFinding
): ExploratoryQaFinding | null {
  for (
    const occurrence of
      finding.occurrences
  ) {
    for (
      const evidence of
        occurrence.evidence
    ) {
      if (
        evidence.rawSource
          ?.type ===
        'exploratory-qa-finding'
      ) {
        return evidence
          .rawSource
          .value as
            ExploratoryQaFinding;
      }
    }
  }

  return null;
}

function getInvestigationOutcome(
  occurrence:
    UnifiedFinding[
      'occurrences'
    ][number]
): FindingInvestigationOutcome | null {
  const evidence =
    occurrence.evidence.find(
      item =>
        item.rawSource
          ?.type ===
        'finding-investigation-outcome'
    );

  return (
    evidence?.rawSource
      ?.value as
        FindingInvestigationOutcome |
        undefined
  ) ?? null;
}

/**
 * Stage 3 compatibility projection.
 *
 * Canonical identity, occurrences, evidence, and verification are already
 * resolved in UnifiedFinding[]. This helper performs no grouping and cannot
 * disagree with the authoritative run-level collection.
 */
export function buildSiteWideExploratoryFindings(
  findings:
    readonly UnifiedFinding[],
  inspectedPageUrls:
    readonly string[]
): SiteWideExploratoryFinding[] {
  const pageNumbers =
    new Map<string, number>();

  inspectedPageUrls.forEach(
    (
      pageUrl,
      pageIndex
    ) => {
      if (
        !pageNumbers.has(
          pageUrl
        )
      ) {
        pageNumbers.set(
          pageUrl,
          pageIndex +
            1
        );
      }
    }
  );

  return findings.flatMap(
    finding => {
      const representativeFinding =
        getModelFinding(
          finding
        );

      if (
        representativeFinding ===
        null
      ) {
        return [];
      }

      const occurrences =
        finding.occurrences.map(
          occurrence => {
            const pageNumber =
              pageNumbers.get(
                occurrence.pageUrl
              );

            if (
              pageNumber ===
              undefined
            ) {
              throw new Error(
                `Cannot project occurrence for uninspected page URL "${occurrence.pageUrl}".`
              );
            }

            return {
              pageNumber,
              findingNumber:
                null,
              pageUrl:
                occurrence.pageUrl,
              pageTitle:
                occurrence.pageTitle,
              screenshotPath:
                occurrence
                  .screenshotReferences[0] ??
                null,
              knownFindingReference:
                finding
                  .findingReference
                  .startsWith(
                    'known-'
                  )
                  ? finding
                      .findingReference
                  : null,
              occurrenceEvidence:
                occurrence.evidence.map(
                  evidence =>
                    evidence.summary
                ),
              matchingBases: [
                'finding-fingerprint'
              ] as
                KnownFindingMatchingBasis[],
              redundantInvestigationSkipped:
                occurrence
                  .redundantInvestigationSkipped,
              verificationOutcome:
                getInvestigationOutcome(
                  occurrence
                )
            };
          }
        );

      return [
        {
          fingerprint:
            finding.fingerprint,
          representativeFinding,
          occurrenceCount:
            occurrences.length,
          affectedPageCount:
            new Set(
              occurrences.map(
                occurrence =>
                  occurrence.pageUrl
              )
            ).size,
          occurrences
        }
      ];
    }
  );
}
