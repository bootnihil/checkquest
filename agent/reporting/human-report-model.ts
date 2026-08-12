import { isAbsolute, relative, resolve, sep } from 'node:path';
import { exploratoryQaFindingSchema } from '../analysis/exploratory-qa-schema';
import { isCrossOriginDnsFailureIdentity } from '../analysis/technical-observation-reconciliation';

import type {
  FindingTarget,
  FindingVerificationState,
  UnifiedFinding
} from '../findings/finding-model';
import type {
  PassiveSecurityEvidence,
  PassiveSecurityObservation
} from '../security/passive-security-model';
import type { FindingPresentationEvidence } from '../inspection/inspected-page-result';
import type { SiteAgentReport } from './report-types';
import {
  getPersistedHumanNarrative,
  getStructuredAccessibilityNarrativeFacts
} from './human-narrative-generation';
import {
  createHumanReportUrlContext,
  createHumanReportUrlPresentation,
  type HumanReportUrlContext
} from './human-report-url';
import {
  buildReconciledRunSummaryProjection,
  getRuntimeTechnicalIdentity,
  hasRuntimeTechnicalGrounding,
  isHumanTechnicalObservation,
  isPrimaryHumanFinding
} from './run-summary-projection';

export const humanReportDetailedFindingLimit = 15;

export type HumanItemType = 'Possible issue' | 'Technical note' | 'Security note';

export type HumanEvidenceSource = 'Observed directly' | 'Seen in browser data' | 'AI analysis only';

export type HumanAssessment = 'Confirmed issue' | 'Confirmed observation' | 'Needs human review';

export type HumanReaderStatus = 'Confirmed issue' | 'Confirmed observation' | 'Needs review';

export type HumanFindingStatus = Extract<HumanAssessment, 'Confirmed issue' | 'Needs human review'>;

export type HumanFindingConfirmationCoverage = 'none' | 'partial' | 'all';

export interface HumanFocusedEvidence {
  relativePath: string;
}

export interface HumanFindingPresentation {
  displayId: string;
  anchor: string;
  findingReference: string;
  title: string;
  severity: UnifiedFinding['severity'];
  itemType: Extract<HumanItemType, 'Possible issue'>;
  evidenceSource: HumanEvidenceSource;
  assessment: HumanFindingStatus;
  status: HumanReaderStatus;
  category: UnifiedFinding['category'];
  pages: HumanPageReference[];
  observation: string;
  whatHappened: string;
  whyItMayMatter: string;
  whatStillNeedsChecking: string;
  whereThisCameFrom: string;
  technicalDetails: string[];
  focusedEvidence: HumanFocusedEvidence[];
  confirmationCoverage: HumanFindingConfirmationCoverage;
  visualTargetCount: number;
  visuallyShownTargetCount: number;
  visualEvidenceExpected: boolean;
  modelCandidateProvenance: boolean;
}

export interface HumanTechnicalObservation {
  displayId: string;
  anchor: string;
  findingReference: string;
  title: string;
  itemType: Extract<HumanItemType, 'Technical note'>;
  evidenceSource: HumanEvidenceSource;
  assessment: Exclude<HumanAssessment, 'Confirmed issue'>;
  status: HumanReaderStatus;
  severity: UnifiedFinding['severity'];
  pages: HumanPageReference[];
  observation: string;
  whatHappened: string;
  whyItMayMatter: string;
  whatStillNeedsChecking: string;
  whereThisCameFrom: string;
  technicalDetails: string[];
  evidencePath: string;
}

export interface HumanSecurityObservation {
  displayId: string;
  anchor: string;
  title: string;
  itemType: Extract<HumanItemType, 'Security note'>;
  evidenceSource: Extract<HumanEvidenceSource, 'Seen in browser data'>;
  assessment: Extract<HumanAssessment, 'Confirmed observation'>;
  status: HumanReaderStatus;
  severity: PassiveSecurityObservation['severity'];
  scope: string;
  description: string;
  whatHappened: string;
  whyItMayMatter: string;
  whatStillNeedsChecking: string;
  whereThisCameFrom: string;
  technicalDetails: string[];
  evidence: string[];
  whatToCheck: string | null;
  pages: HumanPageReference[];
  evidencePath: string;
}

export interface HumanIndexItem {
  displayId: string;
  anchor: string;
  title: string;
  type: HumanItemType;
  evidenceSource: HumanEvidenceSource;
  severity: UnifiedFinding['severity'] | PassiveSecurityObservation['severity'];
  pages: HumanPageReference[];
  assessment: HumanAssessment;
  status: HumanReaderStatus;
}

export interface HumanPageReference {
  title: string | null;
  url: string;
  label: string;
  href: string | null;
}

export interface HumanInspectedPage {
  page: HumanPageReference;
  reachedVia: 'Start URL' | 'Exploration';
  result: string;
  relatedItems: {
    displayId: string;
    anchor: string;
  }[];
}

export interface HumanReportPresentation {
  siteName: string;
  startUrl: string;
  pagesInspected: number;
  duration: string;
  confirmedIssueCount: number;
  needsReviewCount: number;
  technicalObservationCount: number;
  securityObservationCount: number;
  outcomeNote: string | null;
  notableSummary: string | null;
  atAGlance: HumanIndexItem[];
  detailedFindings: HumanFindingPresentation[];
  additionalFindings: HumanFindingPresentation[];
  technicalObservations: HumanTechnicalObservation[];
  securityDisclaimer: string;
  securityObservations: HumanSecurityObservation[];
  inspectedPages: HumanInspectedPage[];
}

const severityRank = {
  high: 0,
  medium: 1,
  low: 2
} as const;

export function getHumanFindingStatus(state: FindingVerificationState): HumanFindingStatus | null {
  switch (state) {
    case 'verified':
      return 'Confirmed issue';

    case 'inconclusive':
      return 'Needs human review';

    case 'not-verified':
      return null;
  }
}

export function getHumanReaderStatus(
  evidenceSource: HumanEvidenceSource,
  assessment: HumanAssessment
): HumanReaderStatus {
  if (assessment === 'Confirmed issue') {
    if (evidenceSource === 'AI analysis only') {
      throw new Error('AI-only evidence cannot produce a confirmed issue status.');
    }

    return 'Confirmed issue';
  }

  if (assessment === 'Confirmed observation') {
    if (evidenceSource !== 'Seen in browser data') {
      throw new Error('Confirmed observations require browser-data evidence.');
    }

    return 'Confirmed observation';
  }

  return 'Needs review';
}

function getHumanObservationAssessment(
  state: FindingVerificationState
): Exclude<HumanAssessment, 'Confirmed issue'> | null {
  switch (state) {
    case 'verified':
      return 'Confirmed observation';

    case 'inconclusive':
      return 'Needs human review';

    case 'not-verified':
      return null;
  }
}

function formatDuration(startedAt: string, finishedAt: string): string {
  const durationSeconds = Math.max(
    0,
    Math.round((Date.parse(finishedAt) - Date.parse(startedAt)) / 1_000)
  );
  const hours = Math.floor(durationSeconds / 3_600);
  const minutes = Math.floor((durationSeconds % 3_600) / 60);
  const seconds = durationSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

function getSiteName(report: SiteAgentReport): string {
  if (!report.site.name.toLowerCase().startsWith('runtime exploration:')) {
    return report.site.name;
  }

  try {
    return new URL(report.site.startUrl).hostname.replace(/^www\./, '');
  } catch {
    return report.site.name;
  }
}

const commonHtmlCharacterReferences: Readonly<Record<string, string>> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: '\u00a0',
  quot: '"'
};

function decodeHtmlCharacterReferences(value: string): string {
  return value.replace(/&(#(?:x[0-9a-f]+|[0-9]+)|[a-z]+);/gi, (reference, name: string) => {
    if (!name.startsWith('#')) {
      return commonHtmlCharacterReferences[name.toLowerCase()] ?? reference;
    }

    const isHexadecimal = name[1]?.toLowerCase() === 'x';
    const codePoint = Number.parseInt(name.slice(isHexadecimal ? 2 : 1), isHexadecimal ? 16 : 10);

    if (
      !Number.isInteger(codePoint) ||
      codePoint <= 0 ||
      codePoint > 0x10ffff ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff)
    ) {
      return reference;
    }

    return String.fromCodePoint(codePoint);
  });
}

function createPageDisplayTitle(title: string): string | null {
  const normalized = decodeHtmlCharacterReferences(title).replace(/\s+/g, ' ').trim();

  if (normalized.length === 0) {
    return null;
  }

  return normalized.length <= 96 ? normalized : `${normalized.slice(0, 95)}…`;
}

function createPageReference(
  title: string,
  url: string,
  urlContext: HumanReportUrlContext
): HumanPageReference {
  const presentation = createHumanReportUrlPresentation(url, urlContext);

  return {
    title: createPageDisplayTitle(title),
    url,
    label: presentation.displayText,
    href: presentation.href
  };
}

function uniquePages(pages: readonly HumanPageReference[]): HumanPageReference[] {
  const seen = new Set<string>();

  return pages.filter(page => {
    if (seen.has(page.url)) {
      return false;
    }

    seen.add(page.url);
    return true;
  });
}

function getRawObservation(finding: UnifiedFinding): string {
  for (const occurrence of finding.occurrences) {
    for (const evidence of occurrence.evidence) {
      const rawValue =
        evidence.rawSource?.type === 'exploratory-qa-finding' ? evidence.rawSource.value : null;

      if (
        typeof rawValue === 'object' &&
        rawValue !== null &&
        'evidence' in rawValue &&
        typeof rawValue.evidence === 'string'
      ) {
        return rawValue.evidence;
      }
    }
  }

  for (const occurrence of finding.occurrences) {
    const browserEvidence = occurrence.evidence.find(
      evidence => evidence.source === 'browser' && evidence.kind === 'browser-observation'
    );

    if (browserEvidence !== undefined) {
      return browserEvidence.summary;
    }
  }

  for (const occurrence of finding.occurrences) {
    for (const evidence of occurrence.evidence) {
      if (evidence.kind === 'screenshot' || evidence.kind === 'investigation-outcome') {
        continue;
      }

      const rawValue = evidence.rawSource?.value;

      if (
        typeof rawValue === 'object' &&
        rawValue !== null &&
        'evidence' in rawValue &&
        typeof rawValue.evidence === 'string'
      ) {
        return rawValue.evidence;
      }

      return evidence.summary;
    }
  }

  return finding.description;
}

function cleanFindingTitle(title: string): string {
  return title
    .trim()
    .replace(/^(?:verified|inconclusive|not verified)\s*[-:]\s*/i, '')
    .replace(/^model candidate:\s+/i, '')
    .trim();
}

function slugifyEvidenceName(title: string): string {
  return (
    title
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 70)
      .toUpperCase() || 'ITEM'
  );
}

function getFocusedEvidenceRelativePath(report: SiteAgentReport, screenshotPath: string): string {
  const reportDirectory = resolve('agent-results', report.runId);
  const evidenceDirectory = resolve(reportDirectory, 'evidence');
  const evidenceRelativePath = relative(evidenceDirectory, resolve(screenshotPath));

  if (
    evidenceRelativePath.length === 0 ||
    evidenceRelativePath === '..' ||
    evidenceRelativePath.startsWith(`..${sep}`) ||
    isAbsolute(evidenceRelativePath)
  ) {
    throw new Error('Focused screenshot does not belong to the current report evidence directory.');
  }

  return `evidence/${evidenceRelativePath.split(sep).join('/')}`;
}

function getPresentationEvidenceForFinding(
  report: SiteAgentReport,
  finding: UnifiedFinding
): FindingPresentationEvidence[] {
  const createPairKey = (pageNumber: number, candidateReference: string): string =>
    JSON.stringify([pageNumber, candidateReference]);
  const occurrencePairs = new Set<string>();

  for (const occurrence of finding.occurrences) {
    for (const evidence of occurrence.evidence) {
      const candidateReference = evidence.rawReference?.candidateReference;
      const pageNumber = evidence.rawReference?.pageNumber;

      if (candidateReference === undefined || pageNumber === undefined) {
        continue;
      }

      const pairKey = createPairKey(pageNumber, candidateReference);

      occurrencePairs.add(pairKey);
    }
  }

  if (occurrencePairs.size === 0) {
    return [];
  }

  return report.inspectedPages
    .flatMap(page => page.presentationEvidence ?? [])
    .filter(evidence => {
      const pairKey = createPairKey(evidence.pageNumber, evidence.candidateReference);

      return occurrencePairs.has(pairKey);
    });
}

function hasLinkedBrowserData(finding: UnifiedFinding): boolean {
  if (
    getRuntimeTechnicalIdentity(finding) !== null ||
    getStructuredAccessibilityNarrativeFacts(finding) !== null
  ) {
    return true;
  }

  return finding.occurrences.some(occurrence =>
    occurrence.evidence.some(evidence => evidence.source !== 'model')
  );
}

function getHumanEvidenceSource(
  finding: UnifiedFinding,
  presentationEvidence: readonly FindingPresentationEvidence[]
): HumanEvidenceSource {
  if (
    presentationEvidence.some(
      evidence => evidence.screenshotPaths.length > 0 && evidence.shownTargetCount > 0
    )
  ) {
    return 'Observed directly';
  }

  return hasLinkedBrowserData(finding) ? 'Seen in browser data' : 'AI analysis only';
}

function getWhereThisCameFrom(
  evidenceSource: HumanEvidenceSource,
  _finding: UnifiedFinding,
  pageCount: number
): string {
  if (evidenceSource === 'Observed directly') {
    return pageCount === 1
      ? 'Focused screenshot evidence captured on the inspected page.'
      : `Focused screenshot evidence captured on ${pageCount} inspected pages.`;
  }

  return pageCount === 1
    ? 'Recorded during this CheckQuest inspection.'
    : `Recorded by CheckQuest on ${pageCount} inspected pages.`;
}

interface PlainHumanNarrative {
  title: string;
  condition: string;
  impact: string;
  check: string;
  technicalDetails: string[];
}

function getPageRuleCode(finding: UnifiedFinding): string | null {
  for (const occurrence of finding.occurrences) {
    for (const evidence of occurrence.evidence) {
      const raw = evidence.rawSource?.type === 'page-finding' ? evidence.rawSource.value : null;

      if (
        typeof raw === 'object' &&
        raw !== null &&
        'code' in raw &&
        typeof raw.code === 'string'
      ) {
        return raw.code;
      }
    }
  }

  return null;
}

function getTechnicalNarrative(finding: UnifiedFinding): PlainHumanNarrative | null {
  const identity = getRuntimeTechnicalIdentity(finding);

  if (identity === null) {
    return null;
  }

  switch (identity.kind) {
    case 'failed-request': {
      const resource = identity.resourceType.toLowerCase();
      const resourceName = getResourceDisplayName(resource);

      if (isCrossOriginDnsFailureIdentity(identity)) {
        return {
          title: 'A connection to an external service failed',
          condition:
            'The browser could not find the address of an external service requested by the page.',
          impact:
            'The external service may not have loaded, but the failure may have come from CheckQuest’s test environment rather than the website.',
          check:
            'Repeat the check from another environment before attributing the failure to the website.',
          technicalDetails: [
            `Request URL: ${identity.resourceUrl}`,
            `Method: ${identity.method}`,
            `Browser failure: ${identity.failureText}`,
            `Origin relationship: ${identity.originRelation}`
          ]
        };
      }

      return {
        title: `${getIndefiniteArticle(resourceName)} ${resourceName} failed to load`,
        condition: `${getIndefiniteArticle(resourceName)} ${resourceName} requested by the page failed to load.`,
        impact: `The ${resource} request failed, but CheckQuest did not capture a visible consequence, so we do not yet know whether visitors can actually see or experience a problem.`,
        check: `Open the page and check whether the failed ${resourceName} affects anything visitors need to see or use.`,
        technicalDetails: [
          `Request URL: ${identity.resourceUrl}`,
          `Method: ${identity.method}`,
          `Resource type: ${identity.resourceType}`,
          `Browser failure: ${identity.failureText}`,
          `Origin relationship: ${identity.originRelation}`
        ]
      };
    }

    case 'console-error': {
      const resourceType =
        identity.sourceUrl === null ? 'page resource' : getResourceKind(identity.sourceUrl);
      const resourceName = getResourceDisplayName(resourceType);
      const statusText =
        identity.httpStatus === null ? '' : ` returned a ${identity.httpStatus} error`;

      return {
        title:
          identity.httpStatus !== null && resourceType !== 'page resource'
            ? `${getIndefiniteArticle(resourceName)} ${resourceName} failed to load`
            : 'Browser reported a page error',
        condition:
          identity.httpStatus !== null && identity.source === 'resource'
            ? `${getIndefiniteArticle(resourceName)} ${resourceName} requested by the page${statusText}.`
            : 'The browser recorded an error while the page was open.',
        impact:
          identity.source === 'resource'
            ? `The ${resourceType} request failed, but CheckQuest did not capture a visible consequence, so we do not yet know whether visitors can actually see or experience a problem.`
            : 'CheckQuest has not established that this browser error affected what visitors see or can do.',
        check:
          identity.source === 'resource'
            ? `Open the page and check whether the failed ${resourceName} affects anything visitors need to see or use.`
            : 'Identify what produced the error and check whether it affects a visitor-facing feature.',
        technicalDetails: [
          `Console message: ${identity.message}`,
          `Console source: ${identity.source}`,
          `Resource type: ${resourceType}`,
          ...(identity.sourceUrl === null ? [] : [`Resource URL: ${identity.sourceUrl}`]),
          ...(identity.httpStatus === null ? [] : [`HTTP status: ${identity.httpStatus}`])
        ]
      };
    }

    case 'cors':
      return {
        title: 'A request to an external service was blocked',
        condition: 'The browser blocked a request to an external service while the page was open.',
        impact:
          'CheckQuest has not established that the blocked request affected a feature visitors use.',
        check:
          'Check whether the blocked request supports a visitor-facing feature and whether the access policy is intentional.',
        technicalDetails: [
          `Request URL: ${identity.resourceUrl}`,
          `Requesting origin: ${identity.requestingOrigin}`,
          `Method: ${identity.method}`,
          `Resource type: ${identity.resourceType}`,
          `Origin relationship: ${identity.originRelation}`,
          `Browser mechanism: ${identity.mechanism}`
        ]
      };
  }
}

function formatTitleWord(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function getResourceKind(url: string): string {
  try {
    const extension = /\.([a-z0-9]+)$/i.exec(new URL(url).pathname)?.[1]?.toLowerCase();

    if (extension !== undefined) {
      if (['avif', 'gif', 'jpeg', 'jpg', 'png', 'svg', 'webp'].includes(extension)) {
        return 'image';
      }

      if (['js', 'mjs', 'cjs'].includes(extension)) {
        return 'script';
      }

      if (extension === 'css') {
        return 'stylesheet';
      }

      if (['eot', 'otf', 'ttf', 'woff', 'woff2'].includes(extension)) {
        return 'font';
      }
    }
  } catch {
    // The trusted runtime identity has already validated the URL.
  }

  return 'page resource';
}

function getResourceDisplayName(resourceType: string): string {
  const normalized = resourceType.toLowerCase();

  return ['font', 'image', 'media', 'script', 'stylesheet'].includes(normalized)
    ? `${normalized} file`
    : normalized;
}

function getIndefiniteArticle(value: string): 'A' | 'An' {
  return /^[aeiou]/i.test(value) ? 'An' : 'A';
}

function getGenericFindingNarrative(finding: UnifiedFinding): PlainHumanNarrative {
  return {
    title: cleanFindingTitle(finding.title),
    condition: getRawObservation(finding),
    impact: 'CheckQuest has not established a user-visible impact yet.',
    check: 'Check whether this behavior is intentional. If not, correct the affected part.',
    technicalDetails: []
  };
}

function formatStructuredFactValue(value: string | boolean | null): string {
  return typeof value === 'string' ? `“${value}”` : String(value);
}

function getStructuredEvidenceTechnicalDetails(
  basis: NonNullable<ReturnType<typeof getStructuredAccessibilityNarrativeFacts>>['defectBasis']
): string[] {
  if (basis === null) {
    return [];
  }

  return basis.supportingEvidence.map(
    fact =>
      `Structured evidence: ${fact.controlType} control ${fact.controlId}, ${fact.property} = ${formatStructuredFactValue(fact.value)}`
  );
}

function getTargetTechnicalDetails(target: FindingTarget): string[] {
  if (target === null) {
    return [];
  }

  switch (target.kind) {
    case 'select-option':
      return [
        'Target type: select option',
        ...(target.controlLabel === null ? [] : [`Control label: ${target.controlLabel}`]),
        ...(target.controlName === null ? [] : [`Control name: ${target.controlName}`]),
        ...(target.controlId === null ? [] : [`Control id: ${target.controlId}`]),
        `Option text: ${target.optionText}`
      ];

    case 'disclosure-state':
      return [
        'Target type: disclosure state',
        `Accessible name: ${target.accessibleName}`,
        `Control id: ${target.controlId}`,
        `Controlled region id: ${target.controlledRegionId}`,
        `Requested state: ${target.desiredState}`
      ];

    case 'tab-state':
      return [
        'Target type: tab state',
        `Accessible name: ${target.accessibleName}`,
        `Control id: ${target.controlId}`,
        `Tab list id: ${target.tabListId}`,
        `Controlled panel id: ${target.controlledPanelId}`,
        `Requested state: ${target.desiredState}`
      ];
  }
}

function getExploratoryFindingTechnicalDetails(finding: UnifiedFinding): string[] {
  const details = new Set<string>();

  for (const occurrence of finding.occurrences) {
    for (const detail of getTargetTechnicalDetails(occurrence.target)) {
      details.add(detail);
    }

    for (const evidence of occurrence.evidence) {
      if (evidence.rawReference?.candidateReference !== undefined) {
        details.add(`Candidate reference: ${evidence.rawReference.candidateReference}`);
      }

      if (evidence.rawSource?.type !== 'exploratory-qa-finding') {
        continue;
      }

      const parsed = exploratoryQaFindingSchema.safeParse(evidence.rawSource.value);

      if (parsed.success && parsed.data.presentationTarget !== null) {
        const presentationTarget = parsed.data.presentationTarget;

        if (presentationTarget !== undefined) {
          details.add(
            `Presentation evidence: ${presentationTarget.elementKind} text “${presentationTarget.text}”`
          );
        }
      }
    }
  }

  return [...details];
}

function getDeterministicFindingNarrative(finding: UnifiedFinding): PlainHumanNarrative | null {
  const technical = getTechnicalNarrative(finding);

  if (technical !== null) {
    return {
      ...technical,
      title: usesResourceSpecificTitle(finding) ? technical.title : cleanFindingTitle(finding.title)
    };
  }

  const structured = getStructuredAccessibilityNarrativeFacts(finding);

  if (structured?.identity !== null && structured?.identity !== undefined) {
    const rawValue = `“${structured.identity.observedValue}”`;

    return {
      title:
        structured.identity.mechanism === 'unresolved-token'
          ? 'Accessibility tools may announce placeholder text instead of the control’s name'
          : 'Accessibility tools may receive an unclear name for a control',
      condition:
        structured.identity.mechanism === 'unresolved-token'
          ? `Accessibility tools receive the placeholder text ${rawValue} as this control’s name instead of a clear description.`
          : `Accessibility tools receive ${rawValue} as this control’s name, which does not clearly describe it.`,
      impact: 'People using a screen reader may not understand what this control does.',
      check:
        'Check the control’s name and replace the unclear value with wording that explains what the control does.',
      technicalDetails: [
        `Structured control type: ${structured.identity.subject.controlType}`,
        `Control id: ${structured.identity.subject.controlId}`,
        ...(structured.identity.subject.componentId === null
          ? []
          : [`Component id: ${structured.identity.subject.componentId}`]),
        ...(structured.identity.subject.locator === null
          ? []
          : [`Locator: ${structured.identity.subject.locator}`]),
        `Accessible-name value: ${structured.identity.observedValue}`,
        `Identity mechanism: ${structured.identity.mechanism}`,
        ...getStructuredEvidenceTechnicalDetails(structured.defectBasis)
      ]
    };
  }

  if (structured?.defectBasis !== null && structured?.defectBasis !== undefined) {
    const controlTypes = [
      ...new Set(structured.defectBasis.supportingEvidence.map(fact => fact.controlType))
    ];
    const oneControlType = controlTypes.length === 1 ? controlTypes[0]! : null;
    const subject = oneControlType === null ? 'semantic controls' : `a ${oneControlType}`;

    return {
      title:
        oneControlType === null
          ? 'Accessibility information is inconsistent'
          : `${formatTitleWord(oneControlType)} has inconsistent accessibility information`,
      condition: `Browser-backed facts for ${subject} show missing or conflicting accessibility information.`,
      impact:
        'People using assistive technology may receive incomplete or inconsistent information about the control.',
      check:
        'Review the control’s accessibility information and confirm that it agrees with what is visible and how the control behaves.',
      technicalDetails: [
        'Structured mechanism: admitted accessibility defect basis',
        ...getStructuredEvidenceTechnicalDetails(structured.defectBasis)
      ]
    };
  }

  const ruleCode = getPageRuleCode(finding);
  const byRule: Record<string, Omit<PlainHumanNarrative, 'technicalDetails'>> = {
    HTTP_STATUS_UNKNOWN: {
      title: 'Page response status could not be checked',
      condition: 'CheckQuest could not determine the page’s response status.',
      impact:
        'Without that status, CheckQuest cannot tell whether the server delivered the page normally.',
      check: 'Reload the page and confirm that it returns a successful response.'
    },
    HTTP_SERVER_ERROR: {
      title: 'Page returned a server error',
      condition:
        'The page returned a server-error response instead of a normal successful response.',
      impact: 'Visitors may be unable to open or use the page.',
      check: 'Investigate the server response and restore normal page loading.'
    },
    HTTP_CLIENT_ERROR: {
      title: 'Page returned a client error',
      condition: 'The page returned an error response instead of a normal successful response.',
      impact: 'Visitors following this link may reach an error page.',
      check: 'Check the page URL and restore a successful response where the error is unintended.'
    },
    EMPTY_PAGE_TITLE: {
      title: 'Page has no browser title',
      condition: 'The page does not provide a title for the browser tab.',
      impact:
        'People may have difficulty identifying the page in browser tabs, bookmarks, and assistive tools.',
      check: 'Add a short title that identifies the page and its purpose.'
    },
    NO_PRIMARY_HEADINGS: {
      title: 'Page has no main headings',
      condition: 'The page does not contain a visible main or section heading.',
      impact: 'Visitors may find it harder to understand and scan the page structure.',
      check: 'Review the page structure and add clear headings for its main content and sections.'
    },
    VISIBLE_ERROR_PAGE: {
      title: 'Page appears to show an error',
      condition: 'The page title or main headings contain wording commonly shown on an error page.',
      impact: 'Visitors may have reached an error instead of the content they expected.',
      check: 'Open the page and confirm whether the intended content is available.'
    }
  };
  const selected = ruleCode === null ? undefined : byRule[ruleCode];

  if (selected !== undefined) {
    return {
      ...selected,
      technicalDetails: [
        `Rule code: ${ruleCode}`,
        `Recorded evidence: ${getRawObservation(finding)}`
      ]
    };
  }

  if (ruleCode !== null) {
    return {
      title: cleanFindingTitle(finding.title),
      condition: getRawObservation(finding),
      impact: 'CheckQuest has not established a user-visible impact yet.',
      check: 'Check whether this behavior is intentional. If not, correct the affected part.',
      technicalDetails: [`Rule code: ${ruleCode}`]
    };
  }

  return null;
}

function usesResourceSpecificTitle(finding: UnifiedFinding): boolean {
  const identity = getRuntimeTechnicalIdentity(finding);

  return (
    identity?.kind === 'failed-request' ||
    (identity?.kind === 'console-error' && identity.source === 'resource')
  );
}

interface ReaderSafeNarrative {
  title: string;
  condition: string;
  impact: string;
  check: string;
}

function getSelectOptionReaderNarrative(finding: UnifiedFinding): ReaderSafeNarrative | null {
  const optionTexts = new Set<string>();
  const controlLabels = new Set<string>();

  for (const occurrence of finding.occurrences) {
    if (occurrence.target?.kind !== 'select-option') {
      continue;
    }

    const optionText = occurrence.target.optionText.trim();
    const controlLabel = occurrence.target.controlLabel?.trim();

    if (optionText.length > 0) {
      optionTexts.add(optionText);
    }

    if (controlLabel !== undefined && controlLabel.length > 0) {
      controlLabels.add(controlLabel);
    }
  }

  if (optionTexts.size !== 1) {
    return null;
  }

  const optionText = [...optionTexts][0]!;
  const controlLabel = controlLabels.size === 1 ? [...controlLabels][0]! : null;
  const listName = controlLabel === null ? 'The list' : `The “${controlLabel}” list`;

  return {
    title: `Visible option “${optionText}” may need review`,
    condition: `${listName} includes the visible option “${optionText}”.`,
    impact: 'CheckQuest has not established any further user impact yet.',
    check:
      controlLabel === null
        ? `Check whether “${optionText}” is intentional. If not, correct or remove it.`
        : `Check whether “${optionText}” is intentional in “${controlLabel}”. If not, correct or remove it.`
  };
}

function createNeedsReviewExploratoryNarrative(
  finding: UnifiedFinding,
  title: string,
  condition: string
): ReaderSafeNarrative {
  const selectOptionNarrative = getSelectOptionReaderNarrative(finding);

  if (selectOptionNarrative !== null) {
    return selectOptionNarrative;
  }

  return {
    title: /^possible\b/i.test(title) ? title : `Possible issue: ${title}`,
    condition: `The available evidence suggests: ${condition}`,
    impact: 'CheckQuest has not established any further user impact yet.',
    check: 'Check whether this behavior is intentional. If not, correct the affected part.'
  };
}

function createNeedsReviewStructuredCheck(finding: UnifiedFinding, fallback: string): string {
  const structured = getStructuredAccessibilityNarrativeFacts(finding);

  if (structured?.identity === null || structured?.identity === undefined) {
    return fallback;
  }

  const rawValue = `“${structured.identity.observedValue}”`;

  return `Check whether the control name ${rawValue} is intentional. If not, replace it with wording that explains what the control does.`;
}

function buildHumanFinding(
  report: SiteAgentReport,
  finding: UnifiedFinding,
  status: HumanFindingStatus,
  displayId: string,
  urlContext: HumanReportUrlContext
): HumanFindingPresentation {
  const presentationEvidence = getPresentationEvidenceForFinding(report, finding);
  const focusedEvidence: HumanFocusedEvidence[] = [];
  let visuallyShownTargetCount = 0;

  for (const evidence of presentationEvidence) {
    const selectedPaths = evidence.screenshotPaths.slice(
      0,
      Math.max(0, 3 - focusedEvidence.length)
    );

    if (selectedPaths.length === 0) {
      continue;
    }

    visuallyShownTargetCount += Math.min(
      evidence.shownTargetCount,
      Math.ceil(
        evidence.shownTargetCount *
          (selectedPaths.length / Math.max(1, evidence.screenshotPaths.length))
      )
    );

    for (const screenshotPath of selectedPaths) {
      focusedEvidence.push({
        relativePath: getFocusedEvidenceRelativePath(report, screenshotPath)
      });
    }
  }
  const confirmedOccurrenceCount = finding.occurrences.filter(
    occurrence => occurrence.verification.state === 'verified'
  ).length;
  const confirmationCoverage: HumanFindingConfirmationCoverage =
    confirmedOccurrenceCount === 0
      ? 'none'
      : confirmedOccurrenceCount < finding.occurrences.length
        ? 'partial'
        : 'all';
  const pages = uniquePages(
    finding.occurrences.map(occurrence =>
      createPageReference(occurrence.pageTitle, occurrence.pageUrl, urlContext)
    )
  );
  const evidenceSource = getHumanEvidenceSource(finding, presentationEvidence);
  const itemType = 'Possible issue' as const;
  const readerStatus = getHumanReaderStatus(evidenceSource, status);
  const persistedNarrative = getPersistedHumanNarrative(report, finding.findingReference);
  const deterministicSpecificNarrative =
    persistedNarrative === null ? getDeterministicFindingNarrative(finding) : null;
  const usesGenericNarrative =
    persistedNarrative === null &&
    deterministicSpecificNarrative === null &&
    report.reportSchemaVersion === '3';
  const deterministicNarrative = usesGenericNarrative
    ? getGenericFindingNarrative(finding)
    : deterministicSpecificNarrative;

  if (
    report.reportSchemaVersion === '4' &&
    persistedNarrative === null &&
    deterministicNarrative === null
  ) {
    throw new Error('A required exploratory human narrative is missing.');
  }

  const acceptedNarrative = persistedNarrative ?? deterministicNarrative!;
  const plainTitle =
    'plainTitle' in acceptedNarrative ? acceptedNarrative.plainTitle : acceptedNarrative.title;
  const plainCondition =
    'plainCondition' in acceptedNarrative
      ? acceptedNarrative.plainCondition
      : acceptedNarrative.condition;
  const impactStatement =
    'impactStatement' in acceptedNarrative
      ? acceptedNarrative.impactStatement
      : acceptedNarrative.impact;
  const checkStatement =
    'whatToCheck' in acceptedNarrative ? acceptedNarrative.whatToCheck : acceptedNarrative.check;
  const readerSafeNarrative =
    status === 'Needs human review' && (persistedNarrative !== null || usesGenericNarrative)
      ? createNeedsReviewExploratoryNarrative(finding, plainTitle, plainCondition)
      : null;
  const readerTitle = readerSafeNarrative?.title ?? plainTitle;
  const readerCondition = readerSafeNarrative?.condition ?? plainCondition;
  const readerImpact = readerSafeNarrative?.impact ?? impactStatement;
  const readerCheck =
    readerSafeNarrative?.check ??
    (status === 'Needs human review'
      ? createNeedsReviewStructuredCheck(finding, checkStatement)
      : checkStatement);
  const modelCandidateProvenance =
    finding.category === 'technical' &&
    finding.verification.state === 'inconclusive' &&
    evidenceSource === 'AI analysis only';

  return {
    displayId,
    anchor: `item-${displayId.toLowerCase()}`,
    findingReference: finding.findingReference,
    title: readerTitle,
    itemType,
    evidenceSource,
    assessment: status,
    status: readerStatus,
    severity: finding.severity,
    category: finding.category,
    pages,
    observation: getRawObservation(finding),
    whatHappened: readerCondition,
    whyItMayMatter: readerImpact,
    whatStillNeedsChecking: readerCheck,
    whereThisCameFrom: getWhereThisCameFrom(evidenceSource, finding, pages.length),
    technicalDetails: [
      ...(deterministicNarrative?.technicalDetails ?? []),
      ...getExploratoryFindingTechnicalDetails(finding),
      `Verification state: ${finding.verification.state}`
    ],
    focusedEvidence,
    confirmationCoverage,
    visualTargetCount: presentationEvidence.reduce(
      (total, evidence) => total + evidence.totalTargetCount,
      0
    ),
    visuallyShownTargetCount: visuallyShownTargetCount,
    visualEvidenceExpected: focusedEvidence.length > 0,
    modelCandidateProvenance: modelCandidateProvenance
  };
}

function sortFindings<
  Finding extends {
    severity: UnifiedFinding['severity'];
    stableIndex: number;
  }
>(findings: readonly Finding[]): Finding[] {
  return [...findings].sort(
    (left, right) =>
      severityRank[left.severity] - severityRank[right.severity] ||
      left.stableIndex - right.stableIndex
  );
}

function formatPassiveEvidence(evidence: PassiveSecurityEvidence): string {
  const values = evidence.headerValues ?? [];

  if (values.length === 0) {
    return evidence.summary;
  }

  return `${evidence.summary} Values: ${values.join(', ')}.`;
}

function getSecurityScope(observation: PassiveSecurityObservation, totalPages: number): string {
  const pageCount = new Set(observation.occurrences.map(occurrence => occurrence.pageUrl)).size;

  if (totalPages > 0 && pageCount === totalPages) {
    return totalPages === 1 ? '1 page' : `All ${totalPages} pages`;
  }

  return `${pageCount} page${pageCount === 1 ? '' : 's'}`;
}

function getPageFindingCounts(
  findings: readonly HumanFindingPresentation[],
  technicalObservations: readonly HumanTechnicalObservation[],
  pageUrl: string
): {
  findings: number;
  technical: number;
} {
  return {
    findings: findings.filter(finding => finding.pages.some(page => page.url === pageUrl)).length,
    technical: technicalObservations.filter(observation =>
      observation.pages.some(page => page.url === pageUrl)
    ).length
  };
}

function getPageResult(counts: { findings: number; technical: number }): string {
  const parts: string[] = [];

  if (counts.findings > 0) {
    parts.push(`${counts.findings} item${counts.findings === 1 ? '' : 's'} worth review`);
  }

  if (counts.technical > 0) {
    parts.push(`${counts.technical} technical note${counts.technical === 1 ? '' : 's'}`);
  }

  return parts.length > 0 ? parts.join(', ') : 'No reportable items';
}

type HumanNotableTier = 1 | 2 | 3 | 4 | 5 | 6;

function isEnvironmentSensitiveTechnicalObservation(finding: UnifiedFinding): boolean {
  const identity = getRuntimeTechnicalIdentity(finding);

  return identity !== null && isCrossOriginDnsFailureIdentity(identity);
}

function getHumanNotableTier(report: SiteAgentReport, finding: UnifiedFinding): HumanNotableTier {
  if (isPrimaryHumanFinding(finding)) {
    if (finding.verification.state === 'verified') {
      return 1;
    }

    if (
      getPresentationEvidenceForFinding(report, finding).some(
        evidence => evidence.screenshotPaths.length > 0 && evidence.shownTargetCount > 0
      )
    ) {
      return 2;
    }

    if (finding.category === 'technical' && hasRuntimeTechnicalGrounding(finding)) {
      return 3;
    }

    return 5;
  }

  if (isEnvironmentSensitiveTechnicalObservation(finding)) {
    return 6;
  }

  return hasRuntimeTechnicalGrounding(finding) ? 4 : 5;
}

function assessmentRank(finding: UnifiedFinding): number {
  return finding.verification.state === 'verified' ? 0 : 1;
}

function affectedPageCount(finding: UnifiedFinding): number {
  return new Set(finding.occurrences.map(occurrence => occurrence.pageUrl)).size;
}

export function rankHumanReportNotableItems(report: SiteAgentReport): UnifiedFinding[] {
  return report.findings
    .map((finding, stableIndex) => ({
      finding,
      stableIndex,
      tier: getHumanNotableTier(report, finding),
      pageCount: affectedPageCount(finding)
    }))
    .filter(
      item =>
        item.finding.verification.state !== 'not-verified' &&
        (isPrimaryHumanFinding(item.finding) || isHumanTechnicalObservation(item.finding))
    )
    .sort(
      (left, right) =>
        left.tier - right.tier ||
        assessmentRank(left.finding) - assessmentRank(right.finding) ||
        right.pageCount - left.pageCount ||
        severityRank[left.finding.severity] - severityRank[right.finding.severity] ||
        left.stableIndex - right.stableIndex
    )
    .map(item => item.finding);
}

function buildTechnicalObservation(
  finding: UnifiedFinding,
  displayId: string,
  urlContext: HumanReportUrlContext
): HumanTechnicalObservation {
  const pages = uniquePages(
    finding.occurrences.map(occurrence =>
      createPageReference(occurrence.pageTitle, occurrence.pageUrl, urlContext)
    )
  );
  const evidenceSource = getHumanEvidenceSource(finding, []);
  const itemType = 'Technical note' as const;
  const assessment = getHumanObservationAssessment(finding.verification.state);

  if (assessment === null) {
    throw new Error('Ineligible technical observation reached the human report projection.');
  }
  const narrative =
    getTechnicalNarrative(finding) ??
    getDeterministicFindingNarrative(finding) ??
    getGenericFindingNarrative(finding);

  return {
    displayId,
    anchor: `item-${displayId.toLowerCase()}`,
    findingReference: finding.findingReference,
    title: narrative.title,
    itemType,
    evidenceSource,
    assessment,
    status: getHumanReaderStatus(evidenceSource, assessment),
    severity: finding.severity,
    pages,
    observation: getRawObservation(finding),
    whatHappened: narrative.condition,
    whyItMayMatter: narrative.impact,
    whatStillNeedsChecking: narrative.check,
    whereThisCameFrom: getWhereThisCameFrom(evidenceSource, finding, pages.length),
    technicalDetails: [
      ...narrative.technicalDetails,
      ...getExploratoryFindingTechnicalDetails(finding),
      `Verification state: ${finding.verification.state}`
    ],
    evidencePath: `evidence/${displayId}-${slugifyEvidenceName(finding.title)}-evidence.json`
  };
}

function getSecurityNarrative(observation: PassiveSecurityObservation): PlainHumanNarrative {
  switch (observation.code) {
    case 'PS_CSP_RESPONSE_HEADER_NOT_OBSERVED':
      return {
        title: 'A restriction on what the browser may load was not enforced',
        condition: 'The site did not send an enforcing Content Security Policy (CSP).',
        impact:
          'CSP can restrict which resources and content the browser is allowed to load or run. Its absence does not prove the site is vulnerable.',
        check: 'Consider restricting which resources and content browsers may load or run.',
        technicalDetails: []
      };

    case 'PS_TECHNOLOGY_DISCLOSURE': {
      const isServer = observation.title.startsWith('Server');

      return {
        title: isServer
          ? 'The site publicly identifies its server technology'
          : 'The site publicly identifies its software platform',
        condition: isServer
          ? 'The site tells browsers some information about the server technology it uses.'
          : 'The site exposes information about the software or platform serving the page.',
        impact: 'This is informational and is not a problem by itself.',
        check:
          'Consider whether this technology information needs to be included in public responses.',
        technicalDetails: []
      };
    }

    case 'PS_HTTP_DOCUMENT':
      return {
        title: 'The page was delivered without a secure connection',
        condition: 'The page was delivered over an unencrypted HTTP connection.',
        impact:
          'Information sent between a visitor and the site may be easier for others on the network to read or alter.',
        check: 'Consider requiring this page to redirect to a secure HTTPS connection.',
        technicalDetails: []
      };

    case 'PS_HSTS_NOT_OBSERVED':
    case 'PS_HSTS_NOT_ENFORCING':
    case 'HSTS_NOT_OBSERVED':
      return {
        title: 'Future visits were not required to use a secure connection',
        condition: 'The site did not tell browsers to keep future visits on HTTPS.',
        impact:
          'This removes a browser safeguard against accidental or forced connections over unencrypted HTTP, but does not prove an attack is possible.',
        check: 'Consider requiring browsers to keep future visits on a secure connection.',
        technicalDetails: []
      };

    case 'PS_NOSNIFF_NOT_ENFORCING':
      return {
        title: 'A safeguard against misidentified file types was not enabled',
        condition: 'The site did not tell browsers to strictly follow declared file types.',
        impact:
          'This removes one browser safeguard against interpreting a file as the wrong content type, but does not prove the site is vulnerable.',
        check:
          'Consider enabling the browser safeguard that prevents files from being treated as a different type.',
        technicalDetails: []
      };

    case 'PS_FRAME_POLICY_NOT_OBSERVED':
      return {
        title: 'A safeguard against displaying pages inside other sites was not observed',
        condition:
          'The site did not send a policy that restricts other sites from placing its pages inside their own interfaces.',
        impact:
          'Without an appropriate restriction, some pages may be easier to imitate or overlay in deceptive interfaces. This observation does not prove an attack is possible.',
        check:
          'Consider restricting other sites from displaying these pages within their own interfaces.',
        technicalDetails: []
      };

    default:
      return {
        title: observation.title,
        condition: observation.description,
        impact:
          observation.posture === 'informational'
            ? 'This is informational and is not a problem by itself.'
            : 'This may remove a browser protection, but the observation does not prove the site is vulnerable.',
        check:
          observation.remediation ??
          'Review whether this response behavior matches the site’s intended security configuration.',
        technicalDetails: []
      };
  }
}

function buildSecurityObservation(
  observation: PassiveSecurityObservation,
  totalPages: number,
  displayId: string,
  urlContext: HumanReportUrlContext
): HumanSecurityObservation {
  const evidence = new Set<string>();

  for (const occurrence of observation.occurrences) {
    for (const item of occurrence.evidence) {
      evidence.add(formatPassiveEvidence(item));
    }
  }
  const pages = uniquePages(
    observation.occurrences.map(occurrence =>
      createPageReference(occurrence.pageTitle, occurrence.pageUrl, urlContext)
    )
  );
  const narrative = getSecurityNarrative(observation);

  return {
    displayId,
    anchor: `security-${displayId.toLowerCase()}`,
    title: narrative.title,
    itemType: 'Security note',
    evidenceSource: 'Seen in browser data',
    assessment: 'Confirmed observation',
    status: 'Confirmed observation',
    severity: observation.severity,
    scope: getSecurityScope(observation, totalPages),
    description: observation.description,
    whatHappened: narrative.condition,
    whyItMayMatter: narrative.impact,
    whatStillNeedsChecking: narrative.check,
    whereThisCameFrom:
      pages.length === 1
        ? 'Passive browser response data captured on the inspected page.'
        : `Passive browser response data captured on ${pages.length} inspected pages.`,
    technicalDetails: [
      `Security code: ${observation.code}`,
      `Security category: ${observation.category}`,
      `Security posture: ${observation.posture}`,
      `Evidence source: Seen in browser data`
    ],
    evidence: [...evidence],
    whatToCheck: observation.remediation,
    pages,
    evidencePath: `evidence/${displayId}-${slugifyEvidenceName(observation.title)}-evidence.txt`
  };
}

export function buildHumanReportPresentation(report: SiteAgentReport): HumanReportPresentation {
  const urlContext = createHumanReportUrlContext(report.homepage?.finalUrl ?? report.site.startUrl);
  const eligibleFindings = report.findings
    .map((finding, stableIndex) => ({
      finding,
      stableIndex,
      status: getHumanFindingStatus(finding.verification.state)
    }))
    .filter(item => item.status !== null)
    .map(item => ({
      ...item,
      status: item.status as HumanFindingStatus
    }));
  const sortedEligible = sortFindings(
    eligibleFindings.map(item => ({
      ...item,
      severity: item.finding.severity
    }))
  );
  let displayIndex = 0;
  const primaryFindings: HumanFindingPresentation[] = [];
  const technicalObservations: HumanTechnicalObservation[] = [];

  for (const item of sortedEligible.filter(candidate => isPrimaryHumanFinding(candidate.finding))) {
    displayIndex += 1;
    primaryFindings.push(
      buildHumanFinding(
        report,
        item.finding,
        item.status,
        String(displayIndex).padStart(2, '0'),
        urlContext
      )
    );
  }

  for (const item of sortedEligible.filter(candidate =>
    isHumanTechnicalObservation(candidate.finding)
  )) {
    displayIndex += 1;
    technicalObservations.push(
      buildTechnicalObservation(item.finding, String(displayIndex).padStart(2, '0'), urlContext)
    );
  }

  const summary = buildReconciledRunSummaryProjection(report);
  const securityObservations = report.passiveSecurity.observations.map((observation, index) =>
    buildSecurityObservation(
      observation,
      report.inspectedPages.length,
      `S${String(index + 1).padStart(2, '0')}`,
      urlContext
    )
  );
  const indexItems: HumanIndexItem[] = [
    ...primaryFindings.map(finding => ({
      displayId: finding.displayId,
      anchor: finding.anchor,
      title: finding.title,
      type: finding.itemType,
      evidenceSource: finding.evidenceSource,
      severity: finding.severity,
      pages: finding.pages,
      assessment: finding.assessment,
      status: finding.status
    })),
    ...technicalObservations.map(observation => ({
      displayId: observation.displayId,
      anchor: observation.anchor,
      title: observation.title,
      type: observation.itemType,
      evidenceSource: observation.evidenceSource,
      severity: observation.severity,
      pages: observation.pages,
      assessment: observation.assessment,
      status: observation.status
    })),
    ...securityObservations.map(observation => ({
      displayId: observation.displayId,
      anchor: observation.anchor,
      title: observation.title,
      type: observation.itemType,
      evidenceSource: observation.evidenceSource,
      severity: observation.severity,
      pages: observation.pages,
      assessment: observation.assessment,
      status: observation.status
    }))
  ];
  const inspectedPages = [...report.inspectedPages]
    .sort((left, right) => {
      const leftRank = left.selection.type === 'start-url' ? 0 : 1;
      const rightRank = right.selection.type === 'start-url' ? 0 : 1;

      return leftRank - rightRank;
    })
    .map(page => {
      const pageReference = createPageReference(
        page.observation.title,
        page.observation.finalUrl,
        urlContext
      );
      const relatedItems = indexItems
        .filter(item => item.pages.some(itemPage => itemPage.url === page.observation.finalUrl))
        .map(item => ({
          displayId: item.displayId,
          anchor: item.anchor
        }));

      return {
        page: pageReference,
        reachedVia:
          page.selection.type === 'start-url' ? ('Start URL' as const) : ('Exploration' as const),
        result: getPageResult(
          getPageFindingCounts(primaryFindings, technicalObservations, page.observation.finalUrl)
        ),
        relatedItems
      };
    });

  return {
    siteName: getSiteName(report),
    startUrl: report.site.startUrl,
    pagesInspected: report.inspectedPages.length,
    duration: formatDuration(report.startedAt, report.finishedAt),
    confirmedIssueCount: summary.confirmedFindingCount,
    needsReviewCount: summary.reviewFindingCount,
    technicalObservationCount: summary.technicalObservationCount,
    securityObservationCount: report.passiveSecurity.observations.length,
    outcomeNote: report.outcome.type === 'finished' ? report.outcome.summary : null,
    notableSummary: null,
    atAGlance: indexItems,
    detailedFindings: primaryFindings.slice(0, humanReportDetailedFindingLimit),
    additionalFindings: primaryFindings.slice(humanReportDetailedFindingLimit),
    technicalObservations,
    securityDisclaimer: report.passiveSecurity.disclaimer,
    securityObservations,
    inspectedPages
  };
}
