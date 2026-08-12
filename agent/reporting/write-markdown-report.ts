import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  buildHumanReportPresentation,
  type HumanFindingPresentation,
  type HumanIndexItem,
  type HumanPageReference,
  type HumanReportPresentation,
  type HumanReaderStatus,
  type HumanTechnicalObservation
} from './human-report-model';
import type { SiteAgentReport } from './report-types';

export interface WrittenMarkdownReport {
  directoryPath: string;
  filePath: string;
}

function escapeMarkdownInlineText(value: string): string {
  return value
    .replace(/\r?\n/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\|/g, '\\|')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatMarkdownProse(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .split('\n')
    .map(line => line.replace(/^(\s*)(#{1,6})(?=\s|$)/, '$1\\$2'))
    .join('\n');
}

function escapeTableCell(value: string): string {
  return escapeMarkdownInlineText(value);
}

function escapeMarkdownLinkDestination(value: string): string {
  return value.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');
}

function formatSeverity(severity: string): string {
  return `${severity.charAt(0).toUpperCase()}${severity.slice(1)}`;
}

function formatMarkdownInlineCode(value: string): string {
  const tableSafeValue = value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\|/g, '&#124;');
  const longestBacktickRun = Math.max(
    0,
    ...(tableSafeValue.match(/`+/g) ?? []).map(run => run.length)
  );
  const fence = '`'.repeat(longestBacktickRun + 1);
  const needsPadding =
    tableSafeValue.startsWith('`') ||
    tableSafeValue.endsWith('`') ||
    tableSafeValue.startsWith(' ') ||
    tableSafeValue.endsWith(' ');

  return `${fence}${needsPadding ? ` ${tableSafeValue} ` : tableSafeValue}${fence}`;
}

function createPageLink(page: HumanPageReference): string {
  const displayLocation = formatMarkdownInlineCode(page.label);

  if (page.href === null) {
    return page.title === null
      ? displayLocation
      : `${escapeMarkdownInlineText(page.title)} — ${displayLocation}`;
  }

  const href = escapeMarkdownLinkDestination(page.href);

  return page.title === null
    ? `[${escapeMarkdownInlineText(page.label)}](${href})`
    : `[${escapeMarkdownInlineText(page.title)}](${href}) — ${displayLocation}`;
}

function coversEveryInspectedPage(
  pages: readonly HumanPageReference[],
  inspectedPages: readonly HumanPageReference[]
): boolean {
  if (pages.length < 2 || pages.length !== inspectedPages.length) {
    return false;
  }

  const findingPageUrls = new Set(pages.map(page => page.url));

  return inspectedPages.every(page => findingPageUrls.has(page.url));
}

function pushFindingLocation(
  lines: string[],
  pages: readonly HumanPageReference[],
  inspectedPages: readonly HumanPageReference[]
): void {
  if (pages.length === 1) {
    lines.push(`**Found on:** ${createPageLink(pages[0] as HumanPageReference)}`, '');
    return;
  }

  if (coversEveryInspectedPage(pages, inspectedPages)) {
    lines.push(`**Found on all ${pages.length} inspected pages**`, '');
    return;
  }

  lines.push('<details>', `<summary>Found on ${pages.length} pages</summary>`, '');

  for (const page of pages) {
    lines.push(`- ${createPageLink(page)}`);
  }

  lines.push('', '</details>', '');
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function createAtAGlancePageLabel(pages: readonly HumanPageReference[]): string {
  return pluralize(pages.length, 'page');
}

function createFindingCountSummary(report: HumanReportPresentation): string[] {
  const readerItems = report.atAGlance;
  const confirmedIssues = readerItems.filter(item => item.status === 'Confirmed issue').length;
  const needsReview = readerItems.filter(item => item.status === 'Needs review').length;
  const confirmedObservations = readerItems.filter(
    item => item.status === 'Confirmed observation'
  ).length;
  const counts = [
    ...(confirmedIssues > 0
      ? [
          `- **${confirmedIssues}** ${confirmedIssues === 1 ? 'confirmed issue' : 'confirmed issues'}`
        ]
      : []),
    ...(needsReview > 0
      ? [`- **${needsReview}** ${needsReview === 1 ? 'needs review' : 'need review'}`]
      : []),
    ...(confirmedObservations > 0
      ? [
          `- **${confirmedObservations}** ${confirmedObservations === 1 ? 'confirmed observation' : 'confirmed observations'}`
        ]
      : [])
  ];

  return [
    `CheckQuest inspected ${pluralize(report.pagesInspected, 'page')} in ${report.duration} and identified ${pluralize(readerItems.length, 'item')}:`,
    '',
    ...(counts.length > 0 ? counts : ['- No issues or observations to report'])
  ];
}

function pushReportVocabulary(lines: string[]): void {
  lines.push(
    '### How to read this report',
    '',
    '**Status — how sure CheckQuest is**',
    '',
    '- **Confirmed issue** — CheckQuest confirmed that the problem is present.',
    '- **Needs review** — CheckQuest found a possible problem that should be checked.',
    '- **Confirmed observation** — CheckQuest confirmed a technical condition, but it may not be a problem by itself.',
    '',
    '**Severity — how important it may be**',
    '',
    '- **High** — Review promptly.',
    '- **Medium** — Worth addressing.',
    '- **Low** — Minor; usually not urgent.',
    '- **Info** — Informational only.',
    ''
  );
}

function pushAtAGlanceTable(lines: string[], findings: readonly HumanIndexItem[]): void {
  lines.push('| # | Finding | Status | Severity | Found on |', '| --- | --- | --- | --- | --- |');

  for (const finding of findings) {
    lines.push(
      `| [${finding.displayId}](#${finding.anchor}) | [${escapeTableCell(finding.title)}](#${finding.anchor}) | ${finding.status} | ${formatSeverity(finding.severity)} | ${createAtAGlancePageLabel(finding.pages)} |`
    );
  }

  lines.push('');
}

function pushAtAGlance(lines: string[], findings: readonly HumanIndexItem[]): void {
  lines.push('## Findings: At a Glance', '');

  if (findings.length === 0) {
    lines.push('No findings were identified.', '');
    return;
  }

  if (findings.length <= 30) {
    pushAtAGlanceTable(lines, findings);
    return;
  }

  pushAtAGlanceTable(lines, findings);
}

function pushBackToSummary(lines: string[]): void {
  lines.push('[Back to summary](#findings-at-a-glance)', '');
}

function pushFocusedEvidence(lines: string[], finding: HumanFindingPresentation): void {
  if (finding.focusedEvidence.length === 0) {
    return;
  }

  if (finding.focusedEvidence.length > 0) {
    for (const [index, evidence] of finding.focusedEvidence.entries()) {
      const suffix = finding.focusedEvidence.length > 1 ? `, region ${index + 1}` : '';

      lines.push(
        `![Focused evidence for ${escapeMarkdownInlineText(finding.title)}${suffix}](${escapeMarkdownLinkDestination(evidence.relativePath)})`,
        ''
      );
    }

    if (finding.visualTargetCount > finding.visuallyShownTargetCount) {
      lines.push(
        `${finding.visuallyShownTargetCount} of ${finding.visualTargetCount} observed instances are shown.`,
        ''
      );
    }

    return;
  }
}

function getConditionHeading(status: HumanReaderStatus): string {
  switch (status) {
    case 'Confirmed issue':
      return 'What’s wrong';
    case 'Needs review':
      return 'What CheckQuest found';
    case 'Confirmed observation':
      return 'What CheckQuest observed';
  }
}

function getNextStepHeading(status: HumanReaderStatus): string {
  switch (status) {
    case 'Confirmed issue':
      return 'What to do';
    case 'Needs review':
      return 'What to check';
    case 'Confirmed observation':
      return 'What to consider';
  }
}

function pushItemExplanation(
  lines: string[],
  item: {
    status: HumanReaderStatus;
    whatHappened: string;
    whyItMayMatter: string;
    whatStillNeedsChecking: string;
    whereThisCameFrom: string;
    technicalDetails: string[];
    technicalLinks?: { label: string; href: string }[];
    technicalEvidence?: string[];
  }
): void {
  lines.push(
    `**${getConditionHeading(item.status)}**`,
    '',
    formatMarkdownProse(item.whatHappened),
    '',
    '**Why it matters**',
    '',
    formatMarkdownProse(item.whyItMayMatter),
    '',
    `**${getNextStepHeading(item.status)}**`,
    '',
    formatMarkdownProse(item.whatStillNeedsChecking),
    '',
    '<details>',
    '<summary>Technical details</summary>',
    '',
    formatMarkdownProse(item.whereThisCameFrom),
    ''
  );

  for (const detail of item.technicalDetails) {
    lines.push(`- ${formatMarkdownProse(detail)}`);
  }

  for (const evidence of item.technicalEvidence ?? []) {
    lines.push(`- ${formatMarkdownProse(evidence)}`);
  }

  for (const link of item.technicalLinks ?? []) {
    lines.push(
      `[${escapeMarkdownInlineText(link.label)}](${escapeMarkdownLinkDestination(link.href)})`
    );
  }

  lines.push('', '</details>', '');
}

function pushDetailedFinding(
  lines: string[],
  finding: HumanFindingPresentation,
  inspectedPages: readonly HumanPageReference[]
): void {
  lines.push(
    `<a id="${finding.anchor}"></a>`,
    `### ${finding.displayId} — ${escapeMarkdownInlineText(finding.title)}`,
    '',
    `**Status: ${finding.status} · Severity: ${formatSeverity(finding.severity)}**`,
    ''
  );
  pushFindingLocation(lines, finding.pages, inspectedPages);
  pushItemExplanation(lines, finding);
  pushFocusedEvidence(lines, finding);
  pushBackToSummary(lines);

  lines.push('---', '');
}

function pushAdditionalFinding(
  lines: string[],
  finding: HumanFindingPresentation,
  inspectedPages: readonly HumanPageReference[]
): void {
  lines.push(
    `<a id="${finding.anchor}"></a>`,
    `### ${finding.displayId} — ${escapeMarkdownInlineText(finding.title)}`,
    '',
    `**Status: ${finding.status} · Severity: ${formatSeverity(finding.severity)}**`,
    ''
  );
  pushFindingLocation(lines, finding.pages, inspectedPages);
  pushItemExplanation(lines, finding);

  if (finding.focusedEvidence.length > 0) {
    for (const evidence of finding.focusedEvidence) {
      lines.push(
        `![Focused evidence for ${escapeMarkdownInlineText(finding.title)}](${escapeMarkdownLinkDestination(evidence.relativePath)})`,
        ''
      );
    }
  }

  pushBackToSummary(lines);

  lines.push('---', '');
}

function pushTechnicalObservationDetails(
  lines: string[],
  observation: HumanTechnicalObservation,
  heading: string,
  inspectedPages: readonly HumanPageReference[]
): void {
  lines.push(
    `<a id="${observation.anchor}"></a>`,
    heading,
    '',
    `**Status: ${observation.status} · Severity: ${formatSeverity(observation.severity)}**`,
    ''
  );
  pushFindingLocation(lines, observation.pages, inspectedPages);
  pushItemExplanation(lines, {
    ...observation,
    technicalLinks: [
      {
        label: 'Structured technical evidence',
        href: observation.evidencePath
      }
    ]
  });
  pushBackToSummary(lines);
}

function pushTechnicalObservations(
  lines: string[],
  observations: readonly HumanTechnicalObservation[],
  inspectedPages: readonly HumanPageReference[]
): void {
  for (const observation of observations) {
    pushTechnicalObservationDetails(
      lines,
      observation,
      `### ${observation.displayId} — ${escapeMarkdownInlineText(observation.title)}`,
      inspectedPages
    );
    lines.push('---', '');
  }
}

function createInspectedPageCell(page: HumanPageReference, isStartUrl: boolean): string {
  const title = page.title ?? page.label;
  const primary =
    page.href === null
      ? escapeTableCell(title)
      : `[${escapeTableCell(title)}](${escapeMarkdownLinkDestination(page.href)})`;
  const secondary = isStartUrl
    ? `Start URL<br>${escapeTableCell(page.label)}`
    : escapeTableCell(page.label);

  return `${primary}<br><small>${secondary}</small>`;
}

export function renderHumanMarkdownReport(report: SiteAgentReport): string {
  const presentation = buildHumanReportPresentation(report);
  const inspectedPages = presentation.inspectedPages.map(item => item.page);
  const lines: string[] = [
    `# CheckQuest report — ${escapeMarkdownInlineText(presentation.siteName)}`,
    '',
    ...createFindingCountSummary(presentation),
    ''
  ];

  pushReportVocabulary(lines);
  pushAtAGlance(lines, presentation.atAGlance);

  lines.push('## Findings: In Detail', '');

  if (
    presentation.detailedFindings.length === 0 &&
    presentation.additionalFindings.length === 0 &&
    presentation.technicalObservations.length === 0
  ) {
    lines.push('No findings were identified.', '');
  } else {
    for (const finding of presentation.detailedFindings) {
      pushDetailedFinding(lines, finding, inspectedPages);
    }
  }

  if (presentation.additionalFindings.length > 0) {
    lines.push('## Findings: Additional', '');

    for (const finding of presentation.additionalFindings) {
      pushAdditionalFinding(lines, finding, inspectedPages);
    }
  }

  if (presentation.technicalObservations.length > 0) {
    pushTechnicalObservations(lines, presentation.technicalObservations, inspectedPages);
  }

  lines.push(
    '## Security testing scope',
    '',
    'CheckQuest only reports security-related signals it encounters during normal browsing. It does not perform penetration testing or actively probe for vulnerabilities.',
    ''
  );

  if (presentation.securityObservations.length === 0) {
    lines.push('No security-related signals were observed during normal browsing.', '');
  } else {
    for (const observation of presentation.securityObservations) {
      lines.push(
        `<a id="${observation.anchor}"></a>`,
        `### ${observation.displayId} — ${escapeMarkdownInlineText(observation.title)}`,
        '',
        `**Status: ${observation.status} · Severity: ${formatSeverity(observation.severity)}**`,
        ''
      );
      pushFindingLocation(lines, observation.pages, inspectedPages);
      pushItemExplanation(lines, {
        ...observation,
        technicalEvidence: observation.evidence,
        technicalLinks: [
          {
            label: 'Security evidence file',
            href: observation.evidencePath
          }
        ]
      });

      pushBackToSummary(lines);

      lines.push('---', '');
    }
  }

  lines.push('## Pages inspected', '', '| # | Page |', '| --- | --- |');

  if (presentation.inspectedPages.length === 0) {
    lines.push('| - | No pages were inspected |');
  } else {
    for (const [index, page] of presentation.inspectedPages.entries()) {
      lines.push(`| ${index + 1} | ${createInspectedPageCell(page.page, index === 0)} |`);
    }
  }

  lines.push(
    '',
    'Full machine-readable evidence, diagnostics, assessments, and execution details are available in `report.json`.',
    ''
  );

  return `${lines.join('\n')}\n`;
}

export async function writeMarkdownReport(report: SiteAgentReport): Promise<WrittenMarkdownReport> {
  const directoryPath = join('agent-results', report.runId);
  const filePath = join(directoryPath, 'report.md');
  const presentation = buildHumanReportPresentation(report);
  const evidenceDirectoryPath = join(directoryPath, 'evidence');

  await mkdir(directoryPath, {
    recursive: true
  });
  await mkdir(evidenceDirectoryPath, {
    recursive: true
  });

  for (const observation of presentation.technicalObservations) {
    await writeFile(
      join(directoryPath, observation.evidencePath),
      `${JSON.stringify(
        {
          id: observation.displayId,
          title: observation.title,
          severity: observation.severity,
          pages: observation.pages.map(page => page.url),
          observation: observation.observation
        },
        null,
        2
      )}\n`,
      'utf8'
    );
  }

  for (const observation of presentation.securityObservations) {
    await writeFile(
      join(directoryPath, observation.evidencePath),
      [
        `${observation.displayId} — ${observation.title}`,
        `Severity: ${formatSeverity(observation.severity)}`,
        `Scope: ${observation.scope}`,
        '',
        observation.description,
        '',
        ...observation.evidence
      ].join('\n'),
      'utf8'
    );
  }

  await writeFile(filePath, renderHumanMarkdownReport(report), 'utf8');

  return {
    directoryPath,
    filePath
  };
}
