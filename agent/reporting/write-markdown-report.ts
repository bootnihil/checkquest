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
    '> - **Possible issue:** Something that may affect users.',
    '> - **Technical note:** Browser, network, or runtime information that may help explain the run. It is not automatically a product problem.',
    '> - **Security note:** A security-related observation that may deserve review.',
    '> - **Observed directly:** Visible evidence such as a focused screenshot was captured.',
    '> - **Seen in browser data:** The observation was matched to browser, console, network, or runtime data.',
    '> - **AI analysis only:** The AI suggested the item, but no matching browser or screenshot evidence was linked.',
    '> - **Confirmed issue:** The available evidence supports the user-facing issue.',
    '> - **Confirmed observation:** The browser or security observation itself is supported, but this does not automatically mean users were affected.',
    '> - **Needs human review:** The observation is relevant, but its meaning or impact still needs a person to check.',
    ''
  );
}

function pushAtAGlanceTable(lines: string[], findings: readonly HumanIndexItem[]): void {
  lines.push(
    '| # | Item | Type | Evidence | Assessment | Severity | Page(s) |',
    '| --- | --- | --- | --- | --- | --- | --- |'
  );

  for (const finding of findings) {
    lines.push(
      `| [${finding.displayId}](#${finding.anchor}) | [${escapeTableCell(finding.title)}](#${finding.anchor}) | ${finding.type} | ${finding.evidenceSource} | ${finding.assessment} | ${formatSeverity(finding.severity)} | ${createAtAGlancePageLabel(finding.pages)} |`
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
  }
): void {
  lines.push(
    '**What happened**',
    '',
    formatMarkdownProse(item.whatHappened),
    '',
    '**Why it may matter**',
    '',
    formatMarkdownProse(item.whyItMayMatter),
    '',
    '**What still needs checking**',
    '',
    formatMarkdownProse(item.whatStillNeedsChecking),
    '',
    '**Where this came from**',
    '',
    formatMarkdownProse(item.whereThisCameFrom),
    ''
  );
}

function pushDetailedFinding(lines: string[], finding: HumanFindingPresentation): void {
  lines.push(
    `<a id="${finding.anchor}"></a>`,
    `### ${finding.displayId} — ${escapeMarkdownInlineText(finding.title)}`,
    '',
    `**${finding.itemType} · ${finding.evidenceSource} · ${finding.assessment} · ${formatSeverity(finding.severity)}**  `,
    `**${finding.pages.length === 1 ? 'Page' : 'Pages'}:** ${createPagesLabel(finding.pages)}`,
    ''
  );
  pushItemExplanation(lines, finding);
  pushFocusedEvidence(lines, finding);

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
    `**${finding.itemType} · ${finding.evidenceSource} · ${finding.assessment} · ${formatSeverity(finding.severity)} · ${pageLabel}**`,
    ''
  );
  pushItemExplanation(lines, finding);

  if (finding.focusedEvidence.length > 0) {
    for (const evidence of finding.focusedEvidence) {
      lines.push(
        `![Focused evidence for ${escapeMarkdownInlineText(finding.title)}](${escapeMarkdownLinkDestination(evidence.relativePath)})`,
        ''
      );
    }
  }

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
    `**${observation.itemType} · ${observation.evidenceSource} · ${observation.assessment} · ${formatSeverity(observation.severity)}**  `,
    `**${observation.pages.length === 1 ? 'Page' : 'Pages'}:** ${createPagesLabel(observation.pages)}`,
    ''
  );
  pushItemExplanation(lines, observation);
  lines.push(
    `[Structured technical evidence](${escapeMarkdownLinkDestination(observation.evidencePath)})`,
    ''
  );
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

  lines.push('## Possible issues', '');

  if (presentation.detailedFindings.length === 0) {
    lines.push('No possible issues were identified.', '');
  } else {
    for (const finding of presentation.detailedFindings) {
      pushDetailedFinding(lines, finding);
    }
  }

  if (presentation.additionalFindings.length > 0) {
    lines.push('## Additional possible issues', '');

    for (const finding of presentation.additionalFindings) {
      pushAdditionalFinding(lines, finding);
    }
  }

  lines.push('## Technical notes', '');

  if (presentation.technicalObservations.length === 0) {
    lines.push(
      'No technical notes were included in the human report.',
      '',
      'Additional browser and diagnostic details are available in `report.json`.',
      ''
    );
  } else {
    pushTechnicalObservations(lines, presentation.technicalObservations);

    lines.push('Additional browser and diagnostic details are available in `report.json`.', '');
  }

  lines.push('## Security notes', '', formatMarkdownProse(presentation.securityDisclaimer), '');

  if (presentation.securityObservations.length === 0) {
    lines.push('No security notes were produced.', '');
  } else {
    lines.push(
      '| # | Item | Type | Evidence | Assessment | Severity | Scope |',
      '| --- | --- | --- | --- | --- | --- | --- |'
    );

    for (const observation of presentation.securityObservations) {
      lines.push(
        `| [${observation.displayId}](#${observation.anchor}) | [${escapeTableCell(observation.title)}](#${observation.anchor}) | ${observation.itemType} | ${observation.evidenceSource} | ${observation.assessment} | ${formatSeverity(observation.severity)} | ${escapeTableCell(observation.scope)} |`
      );
    }

    lines.push('');

    for (const observation of presentation.securityObservations) {
      lines.push(
        `<a id="${observation.anchor}"></a>`,
        `### ${observation.displayId} — ${escapeMarkdownInlineText(observation.title)}`,
        '',
        `**${observation.itemType} · ${observation.evidenceSource} · ${observation.assessment} · ${formatSeverity(observation.severity)} · ${observation.scope}**`,
        ''
      );
      pushItemExplanation(lines, observation);
      lines.push(
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
