import type {
  ExploratoryQaFinding
} from '../analysis/exploratory-qa-schema';
import {
  createExploratoryFindingFingerprint
} from '../investigation/finding-fingerprint';
import type {
  KnownFindingMatchingBasis,
  KnownFindingOccurrence
} from '../investigation/known-findings';
import type {
  FindingInvestigationOutcome
} from '../investigation/evaluate-finding-investigation-outcome';

export interface ExploratoryFindingPageInput {
  pageUrl: string;

  pageTitle: string;

  screenshotPath:
    string | null;

  findings:
    ExploratoryQaFinding[];

  knownFindingOccurrences?:
    KnownFindingOccurrence[];
}

export interface SiteWideFindingOccurrence {
  /*
   * Human-readable, one-based positions.
   *
   * These point back to the original per-page findings
   * retained in the full report.
   */
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
  /*
   * Deterministic identity used to group equivalent
   * exploratory findings across multiple pages.
   */
  fingerprint: string;

  /*
   * The first finding placed in this group.
   *
   * The original findings remain available under
   * inspectedPages; this is only the representative
   * version displayed at site level.
   */
  representativeFinding:
    ExploratoryQaFinding;

  occurrenceCount: number;

  affectedPageCount: number;

  occurrences:
    SiteWideFindingOccurrence[];
}

export function buildSiteWideExploratoryFindings(
  pages:
    ExploratoryFindingPageInput[]
): SiteWideExploratoryFinding[] {
  const groupedOccurrences =
    new Map<
      string,
      {
        representativeFinding:
          ExploratoryQaFinding;

        occurrences:
          SiteWideFindingOccurrence[];
      }
    >();

  pages.forEach(
    (
      page,
      pageIndex
    ) => {
      page.findings.forEach(
        (
          finding,
          findingIndex
        ) => {
          const fingerprint =
            createExploratoryFindingFingerprint(
              finding
            );

          const occurrence:
            SiteWideFindingOccurrence = {
            pageNumber:
              pageIndex + 1,

            findingNumber:
              findingIndex + 1,

            pageUrl:
              page.pageUrl,

            pageTitle:
              page.pageTitle,

            screenshotPath:
              page.screenshotPath,

            knownFindingReference:
              null,

            occurrenceEvidence: [
              finding.evidence
            ],

            matchingBases: [
              'initial-finding'
            ],

            redundantInvestigationSkipped:
              false,

            verificationOutcome:
              null
          };

          const existingGroup =
            groupedOccurrences.get(
              fingerprint
            );

          if (
            existingGroup
          ) {
            existingGroup
              .occurrences
              .push(
                occurrence
              );

            return;
          }

          groupedOccurrences.set(
            fingerprint,
            {
              representativeFinding:
                finding,

              occurrences: [
                occurrence
              ]
            }
          );
        }
      );

      for (
        const knownOccurrence of
          page.knownFindingOccurrences ??
          []
      ) {
        const fingerprint =
          knownOccurrence.fingerprint;

        const occurrence:
          SiteWideFindingOccurrence = {
          pageNumber:
            pageIndex + 1,

          findingNumber:
            null,

          pageUrl:
            knownOccurrence.pageUrl,

          pageTitle:
            knownOccurrence.pageTitle,

          screenshotPath:
            knownOccurrence.screenshotPath,

          knownFindingReference:
            knownOccurrence
              .knownFindingReference,

          occurrenceEvidence: [
            ...knownOccurrence
              .occurrenceEvidence
          ],

          matchingBases: [
            ...knownOccurrence
              .matchingBases
          ],

          redundantInvestigationSkipped:
            knownOccurrence
              .redundantInvestigationSkipped,

          verificationOutcome:
            knownOccurrence
              .verificationOutcome
        };

        const existingGroup =
          groupedOccurrences.get(
            fingerprint
          );

        if (
          existingGroup
        ) {
          const existingPageOccurrence =
            existingGroup
              .occurrences
              .find(
                item =>
                  item.pageUrl ===
                  occurrence.pageUrl
              );

          if (
            existingPageOccurrence ===
            undefined
          ) {
            existingGroup
              .occurrences
              .push(
                occurrence
              );
          }

          continue;
        }

        groupedOccurrences.set(
          fingerprint,
          {
            representativeFinding:
              knownOccurrence
                .representativeFinding,

            occurrences: [
              occurrence
            ]
          }
        );
      }
    }
  );

  return Array.from(
    groupedOccurrences.entries()
  ).map(
    (
      [
        fingerprint,
        group
      ]
    ) => ({
      fingerprint,

      representativeFinding:
        group.representativeFinding,

      occurrenceCount:
        group.occurrences.length,

      affectedPageCount:
        new Set(
          group.occurrences.map(
            occurrence =>
              occurrence.pageUrl
          )
        ).size,

      occurrences:
        group.occurrences
    })
  );
}
