import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  buildHumanReportPresentation,
  type HumanFindingPresentation,
  type HumanIndexItem,
  type HumanPageReference,
  type HumanReportPresentation,
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

function pushAffectedScope(lines: string[], pages: readonly HumanPageReference[]): void {
  if (pages.length === 1) {
    lines.push(`**Page:** ${createPageLink(pages[0] as HumanPageReference)}`, '');
    return;
  }

  lines.push(`**Affected:** ${pages.length} pages`, '');
}

function pushCollapsedAffectedPages(lines: string[], pages: readonly HumanPageReference[]): void {
  if (pages.length < 2) {
    return;
  }

  lines.push('<details>', `<summary>Affected pages (${pages.length})</summary>`, '');

  for (const page of pages) {
    lines.push(`- ${createPageLink(page)}`);
  }

  lines.push('', '</details>', '');
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function createAtAGlancePageLabel(pages: readonly HumanPageReference[]): string {
  return pages.length === 1
    ? createPageLink(pages[0] as HumanPageReference)
    : `${pages.length} pages`;
}

function createFindingCountSummary(report: HumanReportPresentation): string[] {
  const counts = [
    ...(report.confirmedIssueCount > 0
      ? [
          `- **${report.confirmedIssueCount}** ${report.confirmedIssueCount === 1 ? 'confirmed issue' : 'confirmed issues'}`
        ]
      : []),
    ...(report.needsReviewCount > 0
      ? [
          `- **${report.needsReviewCount}** ${report.needsReviewCount === 1 ? 'finding needs review' : 'findings need review'}`
        ]
      : []),
    ...(report.technicalObservationCount > 0
      ? [
          `- **${report.technicalObservationCount}** ${report.technicalObservationCount === 1 ? 'technical observation' : 'technical observations'}`
        ]
      : []),
    ...(report.securityObservationCount > 0
      ? [
          `- **${report.securityObservationCount}** ${report.securityObservationCount === 1 ? 'security observation' : 'security observations'}`
        ]
      : [])
  ];

  return [
    '**CheckQuest found:**',
    '',
    ...(counts.length > 0 ? counts : ['- No issues or observations to report'])
  ];
}

function pushReportVocabulary(lines: string[]): void {
  lines.push(
    '### How to read this report',
    '',
    '> - **Confirmed issue:** The available evidence supports the reported problem.',
    '> - **Confirmed observation:** CheckQuest confirmed what the browser reported, but that does not automatically mean visitors were affected.',
    '> - **Evidence found — needs review:** CheckQuest found supporting evidence, but a person still needs to decide what it means.',
    '> - **AI suggestion — needs review:** AI suggested a possible issue, but no matching browser or screenshot evidence confirmed it.',
    '> - **Severity** indicates the potential priority; it does not change how certain the item is.',
    ''
  );
}

function pushAtAGlanceTable(lines: string[], findings: readonly HumanIndexItem[]): void {
  lines.push('| # | Item | Status | Severity | Page(s) |', '| --- | --- | --- | --- | --- |');

  for (const finding of findings) {
    lines.push(
      `| [${finding.displayId}](#${finding.anchor}) | [${escapeTableCell(finding.title)}](#${finding.anchor}) | ${finding.status} | ${formatSeverity(finding.severity)} | ${createAtAGlancePageLabel(finding.pages)} |`
    );
  }

  lines.push('');
}

function pushAtAGlance(lines: string[], findings: readonly HumanIndexItem[]): void {
  lines.push('## At a glance', '');

  if (findings.length === 0) {
    lines.push('No possible issues or technical notes were identified.', '');
    return;
  }

  if (findings.length <= 30) {
    pushAtAGlanceTable(lines, findings);
    return;
  }

  pushAtAGlanceTable(lines, findings);
}

function pushContents(lines: string[], report: HumanReportPresentation): void {
  const links = [
    '[At a glance](#at-a-glance)',
    '[Findings](#findings)',
    ...(report.additionalFindings.length > 0
      ? ['[Additional findings](#additional-findings)']
      : []),
    ...(report.technicalObservations.length > 0 ? ['[Technical notes](#technical-notes)'] : []),
    '[Security notes](#security-notes)',
    '[Pages inspected](#pages-inspected)'
  ];

  lines.push(`**Contents:** ${links.join(' · ')}`, '');
}

function pushBackToSummary(lines: string[]): void {
  lines.push('[Back to summary](#at-a-glance)', '');
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

function pushItemExplanation(
  lines: string[],
  item: {
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
    '**What’s wrong**',
    '',
    formatMarkdownProse(item.whatHappened),
    '',
    '**Why it matters**',
    '',
    formatMarkdownProse(item.whyItMayMatter),
    '',
    '**What to check**',
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

function pushDetailedFinding(lines: string[], finding: HumanFindingPresentation): void {
  lines.push(
    `<a id="${finding.anchor}"></a>`,
    `### ${finding.displayId} — ${escapeMarkdownInlineText(finding.title)}`,
    '',
    `**${formatSeverity(finding.severity)} severity · ${finding.status}**`,
    ''
  );
  pushAffectedScope(lines, finding.pages);
  pushItemExplanation(lines, finding);
  pushCollapsedAffectedPages(lines, finding.pages);
  pushFocusedEvidence(lines, finding);
  pushBackToSummary(lines);

  lines.push('---', '');
}

function pushAdditionalFinding(lines: string[], finding: HumanFindingPresentation): void {
  lines.push(
    `<a id="${finding.anchor}"></a>`,
    `### ${finding.displayId} — ${escapeMarkdownInlineText(finding.title)}`,
    '',
    `**${formatSeverity(finding.severity)} severity · ${finding.status}**`,
    ''
  );
  pushAffectedScope(lines, finding.pages);
  pushItemExplanation(lines, finding);
  pushCollapsedAffectedPages(lines, finding.pages);

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
  heading: string
): void {
  lines.push(
    `<a id="${observation.anchor}"></a>`,
    heading,
    '',
    `**${formatSeverity(observation.severity)} severity · ${observation.status}**`,
    ''
  );
  pushAffectedScope(lines, observation.pages);
  pushItemExplanation(lines, {
    ...observation,
    technicalLinks: [
      {
        label: 'Structured technical evidence',
        href: observation.evidencePath
      }
    ]
  });
  pushCollapsedAffectedPages(lines, observation.pages);
  pushBackToSummary(lines);
}

function pushTechnicalObservations(
  lines: string[],
  observations: readonly HumanTechnicalObservation[]
): void {
  for (const observation of observations) {
    pushTechnicalObservationDetails(
      lines,
      observation,
      `### ${observation.displayId} — ${escapeMarkdownInlineText(observation.title)}`
    );
    lines.push('---', '');
  }
}

export function renderHumanMarkdownReport(report: SiteAgentReport): string {
  const presentation = buildHumanReportPresentation(report);
  const lines: string[] = [
    `# CheckQuest report — ${escapeMarkdownInlineText(presentation.siteName)}`,
    '',
    `CheckQuest inspected ${pluralize(presentation.pagesInspected, 'page')} in ${presentation.duration}.`,
    '',
    ...createFindingCountSummary(presentation),
    ''
  ];

  pushContents(lines, presentation);
  pushReportVocabulary(lines);

  if (presentation.notableSummary !== null) {
    lines.push(formatMarkdownProse(presentation.notableSummary), '');
  }

  if (presentation.outcomeNote !== null) {
    lines.push(formatMarkdownProse(presentation.outcomeNote), '');
  }

  pushAtAGlance(lines, presentation.atAGlance);

  lines.push('## Findings', '');

  if (presentation.detailedFindings.length === 0) {
    lines.push('No findings were identified.', '');
  } else {
    for (const finding of presentation.detailedFindings) {
      pushDetailedFinding(lines, finding);
    }
  }

  if (presentation.additionalFindings.length > 0) {
    lines.push('## Additional findings', '');

    for (const finding of presentation.additionalFindings) {
      pushAdditionalFinding(lines, finding);
    }
  }

  if (presentation.technicalObservations.length > 0) {
    lines.push('## Technical notes', '');
    pushTechnicalObservations(lines, presentation.technicalObservations);

    lines.push('Additional browser and diagnostic details are available in `report.json`.', '');
  }

  lines.push('## Security notes', '', formatMarkdownProse(presentation.securityDisclaimer), '');

  if (presentation.securityObservations.length === 0) {
    lines.push('No security notes were produced.', '');
  } else {
    lines.push('| # | Item | Status | Severity | Scope |', '| --- | --- | --- | --- | --- |');

    for (const observation of presentation.securityObservations) {
      lines.push(
        `| [${observation.displayId}](#${observation.anchor}) | [${escapeTableCell(observation.title)}](#${observation.anchor}) | ${observation.status} | ${formatSeverity(observation.severity)} | ${escapeTableCell(observation.scope)} |`
      );
    }

    lines.push('');

    for (const observation of presentation.securityObservations) {
      lines.push(
        `<a id="${observation.anchor}"></a>`,
        `### ${observation.displayId} — ${escapeMarkdownInlineText(observation.title)}`,
        '',
        `**${formatSeverity(observation.severity)} severity · ${observation.status} · ${observation.scope}**`,
        ''
      );
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

  lines.push(
    '## Pages inspected',
    '',
    '| Page | Reached via | Related items |',
    '| --- | --- | --- |'
  );

  if (presentation.inspectedPages.length === 0) {
    lines.push('| No pages were inspected | - | - |');
  } else {
    for (const page of presentation.inspectedPages) {
      lines.push(
        `| ${createPageLink(page.page)} | ${page.reachedVia} | ${
          page.relatedItems.length === 0
            ? 'None'
            : page.relatedItems.map(item => `[${item.displayId}](#${item.anchor})`).join(', ')
        } |`
      );
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
