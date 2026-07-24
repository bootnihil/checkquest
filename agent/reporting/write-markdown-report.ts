import {
  mkdir,
  writeFile
} from 'node:fs/promises';

import {
  join
} from 'node:path';

import type {
  SiteAgentReport
} from './report-types';

export interface WrittenMarkdownReport {
  directoryPath: string;
  filePath: string;
}

function formatHttpStatus(
  status: number | null
): string {
  return status === null
    ? 'Unknown'
    : String(status);
}

function formatVerificationState(
  state:
    SiteAgentReport[
      'findings'
    ][number][
      'verification'
    ][
      'state'
    ]
): string {
  return state ===
    'not-verified'
    ? 'NOT VERIFIED'
    : state.toUpperCase();
}

function describeVerificationState(
  state:
    SiteAgentReport[
      'findings'
    ][number][
      'verification'
    ][
      'state'
    ]
): string {
  switch (
    state
  ) {
    case 'verified':
      return 'The issue was deterministically demonstrated.';

    case 'not-verified':
      return 'Deterministic evidence contradicted the asserted issue.';

    case 'inconclusive':
      return 'The observation exists, but CheckQuest does not have sufficient deterministic evidence to confirm or disprove it.';
  }
}

function formatSeverity(
  severity: string
): string {
  return severity.toUpperCase();
}

function escapeTableCell(
  value: string
): string {
  return value
    .replace(
      /\|/g,
      '\\|'
    )
    .replace(
      /\r?\n/g,
      ' '
    );
}

function createPageLink(
  title: string,
  url: string
): string {
  const displayTitle =
    title.trim().length >
    0
      ? title
      : url;

  return (
    `[${escapeTableCell(displayTitle)}](${url})`
  );
}

function createScreenshotLink(
  screenshotPath:
    string | null
): string {
  if (
    screenshotPath ===
    null
  ) {
    return 'Not captured';
  }

  const parts =
    screenshotPath.split(
      /[\\/]/
    );

  const filename =
    parts.at(-1);

  if (
    !filename
  ) {
    return escapeTableCell(
      screenshotPath
    );
  }

  return (
    `[${escapeTableCell(filename)}](evidence/${filename})`
  );
}

function getPageTechnicalStatus(
  report:
    SiteAgentReport,
  pageIndex:
    number
): string {
  const page =
    report.inspectedPages[
      pageIndex
    ];

  const actionableCount =
    page
      .classifiedDiagnostics
      .failedRequests
      .filter(
        item =>
          item.disposition ===
          'actionable'
      )
      .length;

  const needsReviewCount =
    page
      .classifiedDiagnostics
      .failedRequests
      .filter(
        item =>
          item.disposition ===
          'needs-review'
      )
      .length;

  if (
    actionableCount >
    0
  ) {
    return (
      `ACTIONABLE (${actionableCount})`
    );
  }

  if (
    needsReviewCount >
    0
  ) {
    return (
      `REVIEW (${needsReviewCount})`
    );
  }

  return 'OK';
}

export async function writeMarkdownReport(
  report: SiteAgentReport
): Promise<WrittenMarkdownReport> {
  const directoryPath =
    join(
      'agent-results',
      report.runId
    );

  const filePath =
    join(
      directoryPath,
      'report.md'
    );

  const lines: string[] = [
    '# CheckQuest Report',
    '',
    `**Site:** ${report.site.name}  `,
    `**Start URL:** ${report.site.startUrl}  `,
    `**Run ID:** ${report.runId}  `,
    `**Started:** ${report.startedAt}  `,
    `**Finished:** ${report.finishedAt}`,
    '',
    '## Summary',
    '',
    '| Metric | Result |',
    '| --- | --- |',
    `| Pages inspected | ${report.summary.pagesInspected} |`,
    `| Logical findings | ${report.summary.logicalFindingsCount} |`,
    `| Finding occurrences | ${report.summary.findingOccurrencesCount} |`,
    `| New candidate findings | ${report.summary.newCandidateFindingsCount} |`,
    `| Known finding occurrences | ${report.summary.knownFindingOccurrencesCount} |`,
    `| Known context items supplied | ${report.summary.knownFindingsSuppliedToAnalysisCount} |`,
    `| Redundant investigations skipped | ${report.summary.redundantInvestigationsSkippedCount} |`,
    `| Highest exploratory severity | ${formatSeverity(report.summary.highestExploratoryQaSeverity)} |`,
    `| Actionable diagnostics | ${report.summary.actionableDiagnosticsCount} |`,
    `| Diagnostics needing review | ${report.summary.diagnosticsNeedingReviewCount} |`,
    `| Run outcome | ${report.outcome.type.toUpperCase()} |`,
    '',
    report.outcome.summary,
    '',
    '## Findings',
    ''
  ];

  if (
    report
      .findings
      .length ===
    0
  ) {
    lines.push(
      'No canonical findings were identified.',
      ''
    );
  } else {
    report
      .findings
      .forEach(
        (
          finding,
          findingIndex
        ) => {
          const occurrenceCount =
            finding
              .occurrences
              .length;

          const affectedPageCount =
            new Set(
              finding
                .occurrences
                .map(
                  occurrence =>
                    occurrence.pageUrl
                )
            ).size;

          lines.push(
            `### ${findingIndex + 1}. ${formatVerificationState(finding.verification.state)} - ${finding.title}`,
            '',
            `**Severity:** ${formatSeverity(finding.severity)}  `,
            `**Category:** ${finding.category}  `,
            `**Observed on:** ${affectedPageCount} page${affectedPageCount === 1 ? '' : 's'} (${occurrenceCount} occurrence${occurrenceCount === 1 ? '' : 's'})`,
            '',
            finding.description,
            '',
            `**Verification:** ${formatVerificationState(finding.verification.state)} - ${describeVerificationState(finding.verification.state)}`,
            '',
            `**Derivation:** ${finding.verification.reason}`,
            ''
          );

          if (
            finding.suggestedCheck !==
            null
          ) {
            lines.push(
              `**Recommended next step:** ${finding.suggestedCheck}`,
              ''
            );
          }

          lines.push(
            '#### Occurrences',
            ''
          );

          finding
            .occurrences
            .forEach(
              occurrence => {
                const suppressedLabel =
                  occurrence
                    .redundantInvestigationSkipped
                    ? ' — KNOWN, NOT REINVESTIGATED'
                    : '';

              lines.push(
                `##### ${createPageLink(occurrence.pageTitle, occurrence.pageUrl)}`,
                '',
                `**Occurrence status:** ${formatVerificationState(occurrence.verification.state)}${suppressedLabel}  `,
                `**Derivation:** ${occurrence.verification.reason}  `,
                `**Screenshot:** ${createScreenshotLink(occurrence.screenshotReferences[0] ?? null)}`,
                '',
                '**Evidence:**',
                ''
              );

                occurrence
                  .evidence
                  .forEach(
                    evidence => {
                      const capability =
                        evidence
                          .verificationCapable
                          ? 'verification-capable'
                          : 'context only';

                      lines.push(
                        `- **${evidence.source} / ${evidence.relation} / ${capability}:** ${evidence.summary}`
                      );
                    }
                  );

                lines.push(
                  ''
                );
              }
            );

          lines.push(
            ''
          );
        }
      );
  }

  lines.push(
    '## Pages Inspected',
    '',
    '| Page | Reached via | Predicted area / route family | Observed template | HTTP | Exploratory occurrences | Rule-based findings | Technical health |',
    '| --- | --- | --- | --- | ---: | ---: | ---: | --- |'
  );

  report.inspectedPages.forEach(
    (
      pageResult,
      pageIndex
    ) => {
      const predictedIdentity =
        pageResult
          .pageNovelty
          .predictedIdentity;

      const predictedIdentityLabel =
        escapeTableCell(
          `${predictedIdentity.areaKey} / ${predictedIdentity.routeFamilyKey}`
        );

      const observedTemplateKey =
        escapeTableCell(
          pageResult
            .pageNovelty
            .observedTemplateKey
        );

      const inspectionSource =
        pageResult.selection.type ===
          'start-url'
          ? 'Configured start URL'
          : pageResult
              .selection
              .navigationAudit
            ? `Agent-selected navigation (depth ${pageResult.selection.navigationAudit.traversalDepth}, ${pageResult.selection.navigationAudit.policyBand})`
            : 'Agent-selected navigation';

      lines.push(
        `| ${createPageLink(pageResult.observation.title, pageResult.observation.finalUrl)} | ${inspectionSource} | ${predictedIdentityLabel} | ${observedTemplateKey} | ${formatHttpStatus(pageResult.observation.httpStatus)} | ${pageResult.exploratoryQaAnalysis.findings.length + pageResult.knownFindingOccurrences.length} | ${pageResult.findings.length} | ${getPageTechnicalStatus(report, pageIndex)} |`
      );
    }
  );

  if (
    report.inspectedPages.length ===
    0
  ) {
    lines.push(
      '| No pages were inspected | - | - | - | - | - | - | - |'
    );
  }

  lines.push(
    '',
    '## Technical Health',
    ''
  );

  if (
    report.summary
      .actionableDiagnosticsCount ===
      0 &&
    report.summary
      .diagnosticsNeedingReviewCount ===
      0
  ) {
    lines.push(
      'No actionable browser or network diagnostics were detected.'
    );
  } else {
    lines.push(
      `- Actionable diagnostics: ${report.summary.actionableDiagnosticsCount}`,
      `- Diagnostics needing review: ${report.summary.diagnosticsNeedingReviewCount}`
    );
  }

  if (
    report.summary
      .ignoredDiagnosticNoiseCount >
    0
  ) {
    lines.push(
      '',
      `${report.summary.ignoredDiagnosticNoiseCount} diagnostic event${report.summary.ignoredDiagnosticNoiseCount === 1 ? '' : 's'} were classified as ignored browser, telemetry, advertising, or third-party noise.`
    );
  }

  lines.push(
    '',
    'Full execution details, raw diagnostics, exploratory analysis, investigation steps, and deterministic evidence are retained in `report.json`.',
    ''
  );

  await mkdir(
    directoryPath,
    {
      recursive:
        true
    }
  );

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
