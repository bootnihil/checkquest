import { copyFile, mkdir, writeFile } from 'node:fs/promises';
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

function createPageLink(page: HumanPageReference): string {
  return `[${escapeMarkdownInlineText(page.label)}](${escapeMarkdownLinkDestination(page.url)})`;
}

function createPagesLabel(pages: readonly HumanPageReference[]): string {
  return pages.map(createPageLink).join(', ');
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
  const confirmedLabel =
    report.confirmedIssueCount === 1 ? 'confirmed finding' : 'confirmed findings';
  const reviewLabel =
    report.needsReviewCount === 1 ? 'finding needing review' : 'findings needing review';
  const technicalLabel =
    report.technicalObservationCount === 1 ? 'technical observation' : 'technical observations';

  return [
    '**CheckQuest found:**',
    '',
    `- **${report.confirmedIssueCount}** ${confirmedLabel}`,
    `- **${report.needsReviewCount}** ${reviewLabel}`,
    `- **${report.technicalObservationCount}** ${technicalLabel}`
  ];
}

function pushReportVocabulary(lines: string[]): void {
  lines.push(
    '### How to read this report',
    '',
    '> - **Finding:** a potential product issue worth human attention. Item type is separate from evidence status.',
    '> - **Technical observation:** browser, network, or runtime diagnostic context; an item type, not a confidence level or automatic product defect.',
    '> - **Security observation:** passive security or configuration information; not automatically a vulnerability.',
    '> - **Confirmed issue / Verified:** sufficient evidence under CheckQuest’s verification rules.',
    '> - **Needs review / Inconclusive:** relevant observation, but insufficient evidence to prove the full claim.',
    ''
  );
}

function pushAtAGlanceTable(lines: string[], findings: readonly HumanIndexItem[]): void {
  lines.push(
    '| # | Finding / observation | Type | Severity | Page(s) | Status |',
    '| --- | --- | --- | --- | --- | --- |'
  );

  for (const finding of findings) {
    lines.push(
      `| [${finding.displayId}](#${finding.anchor}) | [${escapeTableCell(finding.title)}](#${finding.anchor}) | ${finding.type} | ${formatSeverity(finding.severity)} | ${createAtAGlancePageLabel(finding.pages)} | ${finding.status} |`
    );
  }

  lines.push('');
}

function pushAtAGlance(lines: string[], findings: readonly HumanIndexItem[]): void {
  lines.push('## At a glance', '');

  if (findings.length === 0) {
    lines.push('No reportable findings or technical observations were identified.', '');
    return;
  }

  if (findings.length <= 30) {
    pushAtAGlanceTable(lines, findings);
    return;
  }

  pushAtAGlanceTable(lines, findings);
}

function pushObservation(lines: string[], observation: string): void {
  const formatted = formatMarkdownProse(observation);

  for (const line of formatted.split('\n')) {
    lines.push(`> ${line}`);
  }

  lines.push('');
}

function pushFocusedEvidence(lines: string[], finding: HumanFindingPresentation): void {
  if (finding.focusedEvidence.length === 0) {
    return;
  }

  lines.push('**Evidence**', '');

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

function pushFindingEvidenceStatus(lines: string[], finding: HumanFindingPresentation): void {
  switch (finding.confirmationCoverage) {
    case 'none':
      lines.push(
        '**Evidence status**',
        '',
        'CheckQuest did not gather enough evidence to confirm this finding.',
        ''
      );
      return;

    case 'partial':
      lines.push(
        '**Evidence status**',
        '',
        'CheckQuest confirmed some occurrences of this finding, but not all.',
        ''
      );
      return;

    case 'all':
      return;
  }
}

function pushFindingProvenance(lines: string[], finding: HumanFindingPresentation): void {
  if (!finding.modelCandidateProvenance) {
    return;
  }

  lines.push(
    '**Evidence provenance**',
    '',
    'This item originated as a model candidate and was not matched to browser, network, console, or runtime diagnostics.',
    ''
  );
}

function pushDetailedFinding(lines: string[], finding: HumanFindingPresentation): void {
  lines.push(
    `<a id="${finding.anchor}"></a>`,
    `### ${finding.displayId} — ${escapeMarkdownInlineText(finding.title)}`,
    '',
    `**${formatSeverity(finding.severity)} · ${finding.status}**  `,
    `**${finding.pages.length === 1 ? 'Page' : 'Pages'}:** ${createPagesLabel(finding.pages)}`,
    '',
    '**What I saw**',
    ''
  );
  pushObservation(lines, finding.observation);
  pushFocusedEvidence(lines, finding);
  pushFindingEvidenceStatus(lines, finding);
  pushFindingProvenance(lines, finding);
  if (finding.whyItMayMatter !== null) {
    lines.push('**Why it may matter**', '', formatMarkdownProse(finding.whyItMayMatter), '');
  }

  if (finding.whatToCheck !== null) {
    lines.push('**What to check**', '', formatMarkdownProse(finding.whatToCheck), '');
  }

  lines.push('---', '');
}

function pushAdditionalFinding(lines: string[], finding: HumanFindingPresentation): void {
  const pageLabel =
    finding.pages.length === 1
      ? createPageLink(finding.pages[0] as HumanPageReference)
      : `${finding.pages.length} pages`;

  lines.push(
    `<a id="${finding.anchor}"></a>`,
    `### ${finding.displayId} — ${escapeMarkdownInlineText(finding.title)}`,
    '',
    `**${formatSeverity(finding.severity)} · ${finding.status} · ${pageLabel}**`,
    ''
  );
  pushObservation(lines, finding.observation);

  if (finding.focusedEvidence.length > 0) {
    for (const evidence of finding.focusedEvidence) {
      lines.push(
        `![Focused evidence for ${escapeMarkdownInlineText(finding.title)}](${escapeMarkdownLinkDestination(evidence.relativePath)})`,
        ''
      );
    }
  }

  pushFindingEvidenceStatus(lines, finding);
  pushFindingProvenance(lines, finding);

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
    `**${formatSeverity(observation.severity)} · Technical observation**  `,
    `**${observation.pages.length === 1 ? 'Page' : 'Pages'}:** ${createPagesLabel(observation.pages)}`,
    '',
    `[Structured technical evidence](${escapeMarkdownLinkDestination(observation.evidencePath)})`,
    ''
  );
  pushObservation(lines, observation.observation);
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
    lines.push('No confirmed issues or items needing review were identified.', '');
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

  lines.push('## Technical observations', '');

  if (presentation.technicalObservations.length === 0) {
    lines.push(
      'No lower-level technical observations were promoted into the human report.',
      '',
      'Additional browser and diagnostic details are available in `report.json`.',
      ''
    );
  } else {
    pushTechnicalObservations(lines, presentation.technicalObservations);

    lines.push('Additional browser and diagnostic details are available in `report.json`.', '');
  }

  lines.push(
    '## Security observations',
    '',
    formatMarkdownProse(presentation.securityDisclaimer),
    ''
  );

  if (presentation.securityObservations.length === 0) {
    lines.push('No passive security observations were produced.', '');
  } else {
    lines.push('| # | Observation | Severity | Scope |', '| --- | --- | --- | --- |');

    for (const observation of presentation.securityObservations) {
      lines.push(
        `| [${observation.displayId}](#${observation.anchor}) | [${escapeTableCell(observation.title)}](#${observation.anchor}) | ${formatSeverity(observation.severity)} | ${escapeTableCell(observation.scope)} |`
      );
    }

    lines.push('');

    for (const observation of presentation.securityObservations) {
      lines.push(
        `<a id="${observation.anchor}"></a>`,
        `### ${observation.displayId} — ${escapeMarkdownInlineText(observation.title)}`,
        '',
        `**${formatSeverity(observation.severity)} · Security observation · ${observation.scope}**`,
        '',
        formatMarkdownProse(observation.description),
        '',
        `[Security evidence file](${escapeMarkdownLinkDestination(observation.evidencePath)})`,
        '',
        '<details>',
        '<summary>Technical header evidence</summary>',
        ''
      );

      for (const evidence of observation.evidence) {
        lines.push(`- ${formatMarkdownProse(evidence)}`);
      }

      lines.push('', '</details>', '');

      if (observation.whatToCheck !== null) {
        lines.push('**What to check:**', '', formatMarkdownProse(observation.whatToCheck), '');
      }

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
    'Full machine-readable evidence, diagnostics, verification states, and execution details are available in `report.json`.',
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

  for (const finding of presentation.atAGlance) {
    const detailedFinding = [
      ...presentation.detailedFindings,
      ...presentation.additionalFindings
    ].find(item => item.displayId === finding.displayId);

    for (const evidence of detailedFinding?.focusedEvidence ?? []) {
      await copyFile(evidence.sourcePath, join(directoryPath, evidence.relativePath));
    }
  }

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
