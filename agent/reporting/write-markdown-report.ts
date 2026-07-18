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
    '# Web QA Agent Report',
    '',
    `**Site:** ${report.site.name}`,
    `**Run ID:** ${report.runId}`,
    `**Started:** ${report.startedAt}`,
    `**Finished:** ${report.finishedAt}`,
    '',
    '## Summary',
    '',
    `- Pages inspected: ${report.summary.pagesInspected}`,
    `- Rule-based findings: ${report.summary.findingsCount}`,
    `- Highest finding severity: ${report.summary.highestSeverity}`,
    `- Actionable diagnostics: ${report.summary.actionableDiagnosticsCount}`,
    `- Diagnostics needing review: ${report.summary.diagnosticsNeedingReviewCount}`,
    `- Ignored diagnostic noise: ${report.summary.ignoredDiagnosticNoiseCount}`,
    `- Outcome: ${report.outcome.type}`,
    `- Outcome summary: ${report.outcome.summary}`,
    '',
    '## Homepage',
    '',
    `- Requested URL: ${report.homepage.requestedUrl}`,
    `- Final URL: ${report.homepage.finalUrl}`,
    `- HTTP status: ${formatStatus(report.homepage.httpStatus)}`,
    `- Title: ${report.homepage.title || '(empty)'}`,
    ''
  ];

  if (report.inspectedPages.length === 0) {
    lines.push(
      '## Inspected Pages',
      '',
      'No additional pages were inspected.',
      ''
    );
  }

  report.inspectedPages.forEach((pageResult, index) => {
    const pageNumber = index + 1;

    const {
      selection,
      observation,
      diagnostics,
      classifiedDiagnostics,
      findings
    } = pageResult;

    const actionableCount =
      classifiedDiagnostics.failedRequests.filter(
        (item) =>
          item.disposition === 'actionable'
      ).length;

    const needsReviewCount =
      classifiedDiagnostics.failedRequests.filter(
        (item) =>
          item.disposition === 'needs-review'
      ).length;

    const ignoredNoiseCount =
      classifiedDiagnostics.failedRequests.filter(
        (item) =>
          item.disposition === 'ignored-noise'
      ).length;

    lines.push(
      `## Inspected Page ${pageNumber}`,
      '',
      '### Agent Selection',
      '',
      `- Link text: ${selection.link.text}`,
      `- Selected URL: ${selection.link.url}`,
      `- Reason: ${selection.reason}`,
      '',
      '### Page Observation',
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
      lines.push(
        'No H1 or H2 headings were found.',
        ''
      );
    } else {
      observation.headings.forEach((heading) => {
        lines.push(`- ${heading}`);
      });

      lines.push('');
    }

    lines.push(
      '### Browser Diagnostics',
      '',
      `- Console errors: ${diagnostics.consoleErrors.length}`,
      `- Failed network requests: ${diagnostics.failedRequests.length}`,
      '',
      '### Diagnostic Classification',
      '',
      `- Actionable failed requests: ${actionableCount}`,
      `- Needs review: ${needsReviewCount}`,
      `- Ignored noise: ${ignoredNoiseCount}`,
      '',
      '#### Console Errors',
      ''
    );

    if (diagnostics.consoleErrors.length === 0) {
      lines.push(
        'No browser console errors were recorded.',
        ''
      );
    } else {
      diagnostics.consoleErrors.forEach(
        (consoleError, errorIndex) => {
          lines.push(
            `**Console error ${errorIndex + 1}**`,
            '',
            `- Message: ${consoleError.text}`,
            `- Source URL: ${consoleError.sourceUrl ?? 'Unknown'}`,
            `- Line: ${consoleError.lineNumber ?? 'Unknown'}`,
            `- Column: ${consoleError.columnNumber ?? 'Unknown'}`,
            ''
          );
        }
      );
    }

    lines.push(
      '#### Classified Failed Network Requests',
      ''
    );

    if (
      classifiedDiagnostics.failedRequests.length === 0
    ) {
      lines.push(
        'No failed network requests were recorded.',
        ''
      );
    } else {
      classifiedDiagnostics.failedRequests.forEach(
        (classifiedRequest, requestIndex) => {
          const {
            request,
            disposition,
            reason
          } = classifiedRequest;

          lines.push(
            `**Failed request ${requestIndex + 1}**`,
            '',
            `- Disposition: ${disposition}`,
            `- Reason: ${reason}`,
            `- URL: ${request.url}`,
            `- Method: ${request.method}`,
            `- Resource type: ${request.resourceType}`,
            `- Failure: ${request.failureText}`,
            ''
          );
        }
      );
    }

    lines.push(
      '#### Raw Failed Network Requests',
      ''
    );

    if (diagnostics.failedRequests.length === 0) {
      lines.push(
        'No failed network requests were recorded.',
        ''
      );
    } else {
      diagnostics.failedRequests.forEach(
        (failedRequest, requestIndex) => {
          lines.push(
            `**Raw failed request ${requestIndex + 1}**`,
            '',
            `- URL: ${failedRequest.url}`,
            `- Method: ${failedRequest.method}`,
            `- Resource type: ${failedRequest.resourceType}`,
            `- Failure: ${failedRequest.failureText}`,
            ''
          );
        }
      );
    }

    lines.push(
      '### Rule-Based Findings',
      ''
    );

    if (findings.length === 0) {
      lines.push(
        'No rule-based page health issues were detected.',
        ''
      );
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
