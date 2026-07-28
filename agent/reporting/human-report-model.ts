import {
  basename
} from 'node:path';
import {
  findingStructuredIdentitySchema,
  type FindingStructuredIdentity
} from '../analysis/exploratory-qa-schema';

import type {
  FindingVerificationState,
  UnifiedFinding
} from '../findings/finding-model';
import type {
  PassiveSecurityEvidence,
  PassiveSecurityObservation
} from '../security/passive-security-model';
import type {
  FindingPresentationEvidence,
  SiteAgentReport
} from './report-types';
import {
  buildReconciledRunSummaryProjection,
  isHumanTechnicalObservation,
  isPrimaryHumanFinding
} from './run-summary-projection';

export const humanReportDetailedFindingLimit =
  15;

export type HumanFindingStatus =
  | 'Confirmed issue'
  | 'Needs review';

export interface HumanFocusedEvidence {
  sourcePath:
    string;
  relativePath:
    string;
}

export interface HumanFindingPresentation {
  displayId:
    string;
  anchor:
    string;
  findingReference:
    string;
  title:
    string;
  severity:
    UnifiedFinding['severity'];
  status:
    HumanFindingStatus;
  category:
    UnifiedFinding['category'];
  pages:
    HumanPageReference[];
  observation:
    string;
  whyItMayMatter:
    string | null;
  whatToCheck:
    string | null;
  focusedEvidence:
    HumanFocusedEvidence[];
  visualTargetCount:
    number;
  visuallyShownTargetCount:
    number;
  visualEvidenceExpected:
    boolean;
}

export interface HumanTechnicalObservation {
  displayId:
    string;
  anchor:
    string;
  title:
    string;
  severity:
    UnifiedFinding['severity'];
  pages:
    HumanPageReference[];
  observation:
    string;
  evidencePath:
    string;
}

export interface HumanSecurityObservation {
  displayId:
    string;
  anchor:
    string;
  title:
    string;
  severity:
    PassiveSecurityObservation['severity'];
  scope:
    string;
  description:
    string;
  evidence:
    string[];
  whatToCheck:
    string | null;
  pages:
    HumanPageReference[];
  evidencePath:
    string;
}

export interface HumanIndexItem {
  displayId:
    string;
  anchor:
    string;
  title:
    string;
  type:
    'Finding' |
    'Technical';
  severity:
    UnifiedFinding['severity'];
  pages:
    HumanPageReference[];
  status:
    string;
}

export interface HumanPageReference {
  title:
    string;
  url:
    string;
  label:
    string;
}

export interface HumanInspectedPage {
  page:
    HumanPageReference;
  reachedVia:
    'Start URL' |
    'Exploration';
  result:
    string;
  relatedItems:
    {
      displayId:
        string;
      anchor:
        string;
    }[];
}

export interface HumanReportPresentation {
  siteName:
    string;
  startUrl:
    string;
  pagesInspected:
    number;
  duration:
    string;
  confirmedIssueCount:
    number;
  needsReviewCount:
    number;
  technicalObservationCount:
    number;
  outcomeNote:
    string | null;
  notableSummary:
    string | null;
  atAGlance:
    HumanIndexItem[];
  detailedFindings:
    HumanFindingPresentation[];
  additionalFindings:
    HumanFindingPresentation[];
  technicalObservations:
    HumanTechnicalObservation[];
  securityDisclaimer:
    string;
  securityObservations:
    HumanSecurityObservation[];
  inspectedPages:
    HumanInspectedPage[];
}

const severityRank = {
  high:
    0,
  medium:
    1,
  low:
    2
} as const;

export function getHumanFindingStatus(
  state:
    FindingVerificationState
): HumanFindingStatus | null {
  switch (
    state
  ) {
    case 'verified':
      return 'Confirmed issue';

    case 'inconclusive':
      return 'Needs review';

    case 'not-verified':
      return null;
  }
}

function formatDuration(
  startedAt:
    string,
  finishedAt:
    string
): string {
  const durationSeconds =
    Math.max(
      0,
      Math.round(
        (
          Date.parse(
            finishedAt
          ) -
          Date.parse(
            startedAt
          )
        ) /
          1_000
      )
    );
  const hours =
    Math.floor(
      durationSeconds /
        3_600
    );
  const minutes =
    Math.floor(
      (
        durationSeconds %
          3_600
      ) /
        60
    );
  const seconds =
    durationSeconds %
      60;

  if (
    hours >
    0
  ) {
    return (
      `${hours}h ${minutes}m ${seconds}s`
    );
  }

  if (
    minutes >
    0
  ) {
    return (
      `${minutes}m ${seconds}s`
    );
  }

  return `${seconds}s`;
}

function getSiteName(
  report:
    SiteAgentReport
): string {
  if (
    !report.site.name
      .toLowerCase()
      .startsWith(
        'runtime exploration:'
      )
  ) {
    return report.site.name;
  }

  try {
    return new URL(
      report.site.startUrl
    ).hostname.replace(
      /^www\./,
      ''
    );
  } catch {
    return report.site.name;
  }
}

function createPageReference(
  title:
    string,
  url:
    string
): HumanPageReference {
  let label =
    url;

  try {
    const parsed =
      new URL(
        url
      );

    label =
      `${parsed.pathname}${parsed.search}` ||
      '/';
  } catch {
    // Retain the original URL when it cannot be parsed.
  }

  return {
    title,
    url,
    label
  };
}

function uniquePages(
  pages:
    readonly HumanPageReference[]
): HumanPageReference[] {
  const seen =
    new Set<
      string
    >();

  return pages.filter(
    page => {
      if (
        seen.has(
          page.url
        )
      ) {
        return false;
      }

      seen.add(
        page.url
      );
      return true;
    }
  );
}

function getRawObservation(
  finding:
    UnifiedFinding
): string {
  for (
    const occurrence of
      finding.occurrences
  ) {
    for (
      const evidence of
        occurrence.evidence
  ) {
      if (
        evidence.kind ===
          'screenshot' ||
        evidence.kind ===
          'investigation-outcome'
      ) {
        continue;
      }

      const rawValue =
        evidence.rawSource
          ?.value;

      if (
        typeof rawValue ===
          'object' &&
        rawValue !==
          null &&
        'evidence' in
          rawValue &&
        typeof rawValue
          .evidence ===
          'string'
      ) {
        return rawValue
          .evidence;
      }

      return evidence.summary;
    }
  }

  return finding.description;
}

function cleanFindingTitle(
  title:
    string
): string {
  return title
    .replace(
      /^(?:verified|inconclusive|not verified)\s*[-:]\s*/i,
      ''
    )
    .trim();
}

function getStructuredIdentity(
  finding:
    UnifiedFinding
): FindingStructuredIdentity | null {
  for (
    const occurrence of
      finding.occurrences
  ) {
    for (
      const evidence of
        occurrence.evidence
    ) {
      const rawValue =
        evidence.rawSource
          ?.value;

      if (
        typeof rawValue !==
          'object' ||
        rawValue ===
          null ||
        !(
          'structuredIdentity' in
          rawValue
        )
      ) {
        continue;
      }

      const parsed =
        findingStructuredIdentitySchema
          .safeParse(
            rawValue
              .structuredIdentity
          );

      if (
        parsed.success
      ) {
        return parsed.data;
      }
    }
  }

  return null;
}

function getWhyItMayMatter(
  identity:
    FindingStructuredIdentity | null
): string | null {
  if (
    identity?.source ===
      'accessible-name'
  ) {
    return 'People using assistive technology may hear this value as the control name instead of a meaningful label.';
  }

  return null;
}

function getWhatToCheck(
  identity:
    FindingStructuredIdentity | null
): string | null {
  if (
    identity ===
      null
  ) {
    return null;
  }

  return (
    `Review the accessible-name source for the ${identity.subject.controlType} control with id "${identity.subject.controlId}" and confirm that "${identity.observedValue}" is intended.`
  );
}

function slugifyEvidenceName(
  title:
    string
): string {
  return title
    .normalize(
      'NFKD'
    )
    .replace(
      /[^\p{L}\p{N}]+/gu,
      '-'
    )
    .replace(
      /^-|-$/g,
      ''
    )
    .slice(
      0,
      70
    )
    .toUpperCase() ||
    'ITEM';
}

function getPresentationEvidenceForFinding(
  report:
    SiteAgentReport,
  finding:
    UnifiedFinding
): FindingPresentationEvidence[] {
  const candidateReferences =
    new Set(
      finding.occurrences
        .flatMap(
          occurrence =>
            occurrence.evidence
        )
        .map(
          evidence =>
            evidence
              .rawReference
              ?.candidateReference
        )
        .filter(
          (
            reference
          ): reference is string =>
            reference !==
            undefined
        )
    );

  if (
    candidateReferences.size ===
    0
  ) {
    return [];
  }

  const occurrenceUrls =
    new Set(
      finding.occurrences.map(
        occurrence =>
          occurrence.pageUrl
      )
    );

  return report.inspectedPages
    .flatMap(
      page =>
        page
          .presentationEvidence ??
        []
    )
    .filter(
      evidence =>
        candidateReferences.has(
          evidence
            .candidateReference
        ) &&
        occurrenceUrls.has(
          evidence.pageUrl
        )
    );
}

function buildHumanFinding(
  report:
    SiteAgentReport,
  finding:
    UnifiedFinding,
  status:
    HumanFindingStatus,
  displayId:
    string
): HumanFindingPresentation {
  const presentationEvidence =
    getPresentationEvidenceForFinding(
      report,
      finding
    );
  const focusedEvidence:
    HumanFocusedEvidence[] =
      [];
  let visuallyShownTargetCount =
    0;

  for (
    const evidence of
      presentationEvidence
  ) {
    const selectedPaths =
      evidence.screenshotPaths
        .slice(
          0,
          Math.max(
            0,
            3 -
              focusedEvidence
                .length
          )
        );

    if (
      selectedPaths.length ===
        0
    ) {
      continue;
    }

    visuallyShownTargetCount +=
      Math.min(
        evidence.shownTargetCount,
        Math.ceil(
          evidence.shownTargetCount *
          (
            selectedPaths.length /
            Math.max(
              1,
              evidence
                .screenshotPaths
                .length
            )
          )
        )
      );

    for (
      const screenshotPath of
        selectedPaths
    ) {
      const index =
        focusedEvidence.length;

      focusedEvidence.push({
          sourcePath:
            screenshotPath,
          relativePath:
            `evidence/${displayId}-${slugifyEvidenceName(
              finding.title
            )}-evidence-${String(
              index +
                1
            ).padStart(
              2,
              '0'
            )}${basename(
              screenshotPath
            ).toLowerCase().endsWith(
              '.jpg'
            )
              ? '.jpg'
              : '.png'}`
        });
    }
  }
  const structuredIdentity =
    getStructuredIdentity(
      finding
    );

  return {
    displayId,
    anchor:
      `item-${displayId.toLowerCase()}`,
    findingReference:
      finding.findingReference,
    title:
      cleanFindingTitle(
        finding.title
      ),
    severity:
      finding.severity,
    status,
    category:
      finding.category,
    pages:
      uniquePages(
        finding.occurrences
          .map(
            occurrence =>
              createPageReference(
                occurrence.pageTitle,
                occurrence.pageUrl
              )
          )
      ),
    observation:
      getRawObservation(
        finding
      ),
    whyItMayMatter:
      getWhyItMayMatter(
        structuredIdentity
      ),
    whatToCheck:
      getWhatToCheck(
        structuredIdentity
      ),
    focusedEvidence,
    visualTargetCount:
      presentationEvidence
        .reduce(
          (
            total,
            evidence
          ) =>
            total +
            evidence.totalTargetCount,
          0
        ),
    visuallyShownTargetCount:
      visuallyShownTargetCount,
    visualEvidenceExpected:
      focusedEvidence.length >
      0
  };
}

function sortFindings<
  Finding extends {
    severity:
      UnifiedFinding['severity'];
    stableIndex:
      number;
  }
>(
  findings:
    readonly Finding[]
): Finding[] {
  return [
    ...findings
  ].sort(
    (
      left,
      right
    ) =>
      severityRank[
        left.severity
      ] -
        severityRank[
          right.severity
        ] ||
      left.stableIndex -
        right.stableIndex
  );
}

function formatPassiveEvidence(
  evidence:
    PassiveSecurityEvidence
): string {
  const values =
    evidence.headerValues ??
    [];

  if (
    values.length ===
    0
  ) {
    return evidence.summary;
  }

  return (
    `${evidence.summary} Values: ${values.join(', ')}.`
  );
}

function getSecurityScope(
  observation:
    PassiveSecurityObservation,
  totalPages:
    number
): string {
  const pageCount =
    new Set(
      observation.occurrences
        .map(
          occurrence =>
            occurrence.pageUrl
        )
    ).size;

  if (
    totalPages >
      0 &&
    pageCount ===
      totalPages
  ) {
    return (
      `All ${totalPages} page${totalPages === 1 ? '' : 's'}`
    );
  }

  return (
    `${pageCount} page${pageCount === 1 ? '' : 's'}`
  );
}

function getPageFindingCounts(
  findings:
    readonly HumanFindingPresentation[],
  technicalObservations:
    readonly HumanTechnicalObservation[],
  pageUrl:
    string
): {
  findings:
    number;
  technical:
    number;
} {
  return {
    findings:
      findings.filter(
        finding =>
          finding.pages.some(
            page =>
              page.url ===
              pageUrl
          )
      ).length,
    technical:
      technicalObservations.filter(
        observation =>
          observation.pages.some(
            page =>
              page.url ===
              pageUrl
          )
      ).length
  };
}

function getPageResult(
  counts: {
    findings:
      number;
    technical:
      number;
  }
): string {
  const parts: string[] =
    [];

  if (
    counts.findings >
    0
  ) {
    parts.push(
      `${counts.findings} item${counts.findings === 1 ? '' : 's'} worth review`
    );
  }

  if (
    counts.technical >
    0
  ) {
    parts.push(
      `${counts.technical} technical observation${counts.technical === 1 ? '' : 's'}`
    );
  }

  return parts.length >
    0
    ? parts.join(
      ', '
    )
    : 'No reportable items';
}

function createNotableSummary(
  findings:
    readonly HumanFindingPresentation[]
): string | null {
  const notable =
    findings.slice(
      0,
      2
    );

  if (
    notable.length ===
    0
  ) {
    return null;
  }

  if (
    notable.length ===
    1
  ) {
    const title =
      notable[0]
        ?.title;

    return (
      `The most notable item was ${title?.charAt(0).toLowerCase()}${title?.slice(1)}.`
    );
  }

  const firstTitle =
    notable[0]
      ?.title;
  const secondTitle =
    notable[1]
      ?.title;

  return (
    `The most notable items were ${firstTitle?.charAt(0).toLowerCase()}${firstTitle?.slice(1)} and ${secondTitle?.charAt(0).toLowerCase()}${secondTitle?.slice(1)}.`
  );
}

function buildTechnicalObservation(
  finding:
    UnifiedFinding,
  displayId:
    string
): HumanTechnicalObservation {
  return {
    displayId,
    anchor:
      `item-${displayId.toLowerCase()}`,
    title:
      cleanFindingTitle(
        finding.title
      ),
    severity:
      finding.severity,
    pages:
      uniquePages(
        finding.occurrences
          .map(
            occurrence =>
              createPageReference(
                occurrence.pageTitle,
                occurrence.pageUrl
              )
          )
      ),
    observation:
      getRawObservation(
        finding
      ),
    evidencePath:
      `evidence/${displayId}-${slugifyEvidenceName(
        finding.title
      )}-evidence.json`
  };
}

function buildSecurityObservation(
  observation:
    PassiveSecurityObservation,
  totalPages:
    number,
  displayId:
    string
): HumanSecurityObservation {
  const evidence =
    new Set<
      string
    >();

  for (
    const occurrence of
      observation.occurrences
  ) {
    for (
      const item of
        occurrence.evidence
    ) {
      evidence.add(
        formatPassiveEvidence(
          item
        )
      );
    }
  }

  return {
    displayId,
    anchor:
      `security-${displayId.toLowerCase()}`,
    title:
      observation.title,
    severity:
      observation.severity,
    scope:
      getSecurityScope(
        observation,
        totalPages
      ),
    description:
      observation.description,
    evidence:
      [
        ...evidence
      ],
    whatToCheck:
      observation.remediation,
    pages:
      uniquePages(
        observation.occurrences
          .map(
            occurrence =>
              createPageReference(
                occurrence.pageTitle,
                occurrence.pageUrl
              )
          )
      ),
    evidencePath:
      `evidence/${displayId}-${slugifyEvidenceName(
        observation.title
      )}-evidence.txt`
  };
}

export function buildHumanReportPresentation(
  report:
    SiteAgentReport
): HumanReportPresentation {
  const eligibleFindings =
    report.findings
      .map(
        (
          finding,
          stableIndex
        ) => ({
          finding,
          stableIndex,
          status:
            getHumanFindingStatus(
              finding
                .verification
                .state
            )
        }))
      .filter(
        item =>
          item.status !==
          null
      )
      .map(
        item => ({
          ...item,
          status:
            item.status as
              HumanFindingStatus
        })
      );
  const sortedEligible =
    sortFindings(
      eligibleFindings.map(
        item => ({
          ...item,
          severity:
            item.finding
              .severity
        })
      )
    );
  let displayIndex =
    0;
  const primaryFindings:
    HumanFindingPresentation[] =
      [];
  const technicalObservations:
    HumanTechnicalObservation[] =
      [];

  for (
    const item of
      sortedEligible.filter(
        candidate =>
          isPrimaryHumanFinding(
            candidate.finding
          )
      )
  ) {
    displayIndex +=
      1;
    primaryFindings.push(
      buildHumanFinding(
        report,
        item.finding,
        item.status,
        String(
          displayIndex
        ).padStart(
          2,
          '0'
        )
      )
    );
  }

  for (
    const item of
      sortedEligible.filter(
        candidate =>
          isHumanTechnicalObservation(
            candidate.finding
          )
      )
  ) {
    displayIndex +=
      1;
    technicalObservations.push(
      buildTechnicalObservation(
        item.finding,
        String(
          displayIndex
        ).padStart(
          2,
          '0'
        )
      )
    );
  }

  const summary =
    buildReconciledRunSummaryProjection(
      report
    );
  const indexItems:
    HumanIndexItem[] =
      [
        ...primaryFindings.map(
          finding => ({
            displayId:
              finding.displayId,
            anchor:
              finding.anchor,
            title:
              finding.title,
            type:
              'Finding' as const,
            severity:
              finding.severity,
            pages:
              finding.pages,
            status:
              finding.status
          })
        ),
        ...technicalObservations.map(
          observation => ({
            displayId:
              observation.displayId,
            anchor:
              observation.anchor,
            title:
              observation.title,
            type:
              'Technical' as const,
            severity:
              observation.severity,
            pages:
              observation.pages,
            status:
              'Technical observation'
          })
        )
      ].sort(
        (
          left,
          right
        ) =>
          Number(
            left.displayId
          ) -
          Number(
            right.displayId
          )
      );
  const inspectedPages =
    report.inspectedPages.map(
      page => {
        const pageReference =
          createPageReference(
            page.observation.title,
            page.observation.finalUrl
          );
        const relatedItems =
          indexItems
            .filter(
              item =>
                item.pages.some(
                  itemPage =>
                    itemPage.url ===
                    page.observation
                      .finalUrl
                )
            )
            .map(
              item => ({
                displayId:
                  item.displayId,
                anchor:
                  item.anchor
              })
            );

        return {
          page:
            pageReference,
          reachedVia:
            page.selection.type ===
              'start-url'
              ? 'Start URL' as const
              : 'Exploration' as const,
          result:
            getPageResult(
              getPageFindingCounts(
                primaryFindings,
                technicalObservations,
                page.observation
                  .finalUrl
              )
            ),
          relatedItems
        };
      }
    );

  return {
    siteName:
      getSiteName(
        report
      ),
    startUrl:
      report.site.startUrl,
    pagesInspected:
      report.inspectedPages
        .length,
    duration:
      formatDuration(
        report.startedAt,
        report.finishedAt
      ),
    confirmedIssueCount:
      summary
        .confirmedFindingCount,
    needsReviewCount:
      summary
        .reviewFindingCount,
    technicalObservationCount:
      summary
        .technicalObservationCount,
    outcomeNote:
      report.outcome.type ===
        'finished'
        ? report.outcome
            .summary
        : null,
    notableSummary:
      createNotableSummary(
        primaryFindings
      ),
    atAGlance:
      indexItems,
    detailedFindings:
      primaryFindings.slice(
        0,
        humanReportDetailedFindingLimit
      ),
    additionalFindings:
      primaryFindings.slice(
        humanReportDetailedFindingLimit
      ),
    technicalObservations,
    securityDisclaimer:
      report.passiveSecurity
        .disclaimer,
    securityObservations:
      report.passiveSecurity
        .observations
        .map(
          (
            observation,
            index
          ) =>
            buildSecurityObservation(
              observation,
              report.inspectedPages
                .length,
              `S${String(
                index +
                  1
              ).padStart(
                2,
                '0'
              )}`
            )
        ),
    inspectedPages
  };
}
