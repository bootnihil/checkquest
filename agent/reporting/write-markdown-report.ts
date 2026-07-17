import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SiteAgentReport } from './report-types';

export interface WrittenMarkdownReport {
  directoryPath: string;
  filePath: string;
}

function formatStatus(status: number | null): string {
  return status === null ? 'Unknown' : String(status);
}

export async function writeMarkdownReport(
  report: SiteAgentReport
): Promise<WrittenMarkdownReport> {
  const directoryPath = join(
    'agent-results',
    report.runId
  );

  const filePath = join(
    directoryPath,
    'report.md'
  );

  const lines: string[] = [
    `# Web QA Agent Report`,
    '',
    `**Site:** ${report.site.name}`,
    `**Run ID:** ${report.runId}`,
    `**Started:** ${report.startedAt}`,
    `**Finished:** ${report.finishedAt}`,
    '',
    '## Summary',
    '',
    `- Pages inspected: ${report.summary.pagesInspected}`,
    `- Findings: ${report.summary.findingsCount}`,
    `- Highest severity: ${report.summary.highestSeverity}`,
    '',
    '## Homepage',
    '',
    `- Requested URL: ${report.homepage.requestedUrl}`,
    `- Final URL: ${report.homepage.finalUrl}`,
    `- HTTP status: ${formatStatus(report.homepage.httpStatus)}`,
    `- Title: ${report.homepage.title || '(empty)'}`,
    ''
  ];

  if (report.selection === null) {
    lines.push(
      '## Agent Decision',
      '',
      'No navigation target was selected.',
      ''
    );
  } else {
    lines.push(
      '## Agent Selection',
      '',
      `- Link text: ${report.selection.link.text}`,
      `- URL: ${report.selection.link.url}`,
      `- Reason: ${report.selection.reason}`,
      ''
    );
  }

  report.inspectedPages.forEach((pageResult, index) => {
    const pageNumber = index + 1;
    const { observation, findings } = pageResult;

    lines.push(
      `## Inspected Page ${pageNumber}`,
      '',
      `- Requested URL: ${observation.requestedUrl}`,
      `- Final URL: ${observation.finalUrl}`,
      `- HTTP status: ${formatStatus(observation.httpStatus)}`,
      `- Title: ${observation.title || '(empty)'}`,
      '',
      '### Headings',
      ''
    );

    if (observation.headings.length === 0) {
      lines.push('No H1 or H2 headings were found.', '');
    } else {
      observation.headings.forEach((heading) => {
        lines.push(`- ${heading}`);
      });

      lines.push('');
    }

    lines.push('### Findings', '');

    if (findings.length === 0) {
      lines.push('No obvious issues were detected.', '');
    } else {
      findings.forEach((finding) => {
        lines.push(
          `#### ${finding.severity.toUpperCase()} — ${finding.title}`,
          '',
          `- Code: ${finding.code}`,
          `- URL: ${finding.url}`,
          `- Evidence: ${finding.evidence}`,
          ''
        );
      });
    }
  });

  await mkdir(directoryPath, {
    recursive: true
  });

  await writeFile(
    filePath,
    `${lines.join('\n')}\n`,
    'utf8'
  );

  return {
    directoryPath,
    filePath
  };
}
