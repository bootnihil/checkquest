import {
  mkdir,
  writeFile
} from 'node:fs/promises';

import {
  join
} from 'node:path';

import type {
  FindingInvestigationStatus
} from '../investigation/evaluate-finding-investigation-outcome';

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

function formatInvestigationStatus(
  status:
    FindingInvestigationStatus
): string {
  if (
    status ===
    'not-verified'
  ) {
    return 'NOT VERIFIED';
  }

  return status.toUpperCase();
}

function formatSeverity(
  severity: string
): string {
  return severity.toUpperCase();
}

function formatConfidence(
  confidence: string
): string {
  if (
    confidence.length ===
    0
  ) {
    return confidence;
  }

  return (
    confidence.charAt(0).toUpperCase() +
    confidence.slice(1)
  );
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

function getOccurrenceOutcome(
  report: SiteAgentReport,
  pageNumber: number,
  findingNumber:
    number | null
) {
  if (
    findingNumber ===
    null
  ) {
    return null;
  }

  const page =
    report.inspectedPages[
      pageNumber - 1
    ];

  if (
    !page
  ) {
    return null;
  }

  const result =
    page
      .exploratoryFindingResults[
        findingNumber - 1
      ];

  return (
    result?.outcome ??
    null
  );
}

function summarizeInvestigationStatuses(
  statuses:
    FindingInvestigationStatus[]
): string {
  if (
    statuses.length ===
    0
  ) {
    return 'NOT INVESTIGATED';
  }

  const uniqueStatuses =
    new Set(
      statuses
    );

  if (
    uniqueStatuses.size ===
    1
  ) {
    return formatInvestigationStatus(
      statuses[0]
    );
  }

  const verifiedCount =
    statuses.filter(
      status =>
        status ===
        'verified'
    ).length;

  const notVerifiedCount =
    statuses.filter(
      status =>
        status ===
        'not-verified'
    ).length;

  const inconclusiveCount =
    statuses.filter(
      status =>
        status ===
        'inconclusive'
    ).length;

  const parts: string[] = [];

  if (
    verifiedCount >
    0
  ) {
    parts.push(
      `${verifiedCount} verified`
    );
  }

  if (
    notVerifiedCount >
    0
  ) {
    parts.push(
      `${notVerifiedCount} not verified`
    );
  }

  if (
    inconclusiveCount >
    0
  ) {
    parts.push(
      `${inconclusiveCount} inconclusive`
    );
  }

  return (
    `MIXED (${parts.join(', ')})`
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
    `| Unique exploratory findings | ${report.summary.siteWideExploratoryFindingsCount} |`,
    `| Finding occurrences | ${report.summary.exploratoryQaFindingsCount} |`,
    `| New candidate findings | ${report.summary.newCandidateFindingsCount} |`,
    `| Known finding occurrences | ${report.summary.knownFindingOccurrencesCount} |`,
    `| Known context items supplied | ${report.summary.knownFindingsSuppliedToAnalysisCount} |`,
    `| Redundant investigations skipped | ${report.summary.redundantInvestigationsSkippedCount} |`,
    `| Highest exploratory severity | ${formatSeverity(report.summary.highestExploratoryQaSeverity)} |`,
    `| Rule-based findings | ${report.summary.findingsCount} |`,
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
      .siteWideExploratoryFindings
      .length ===
    0
  ) {
    lines.push(
      'No exploratory QA findings were identified.',
      ''
    );
  } else {
    report
      .siteWideExploratoryFindings
      .forEach(
        (
          siteWideFinding,
          siteWideFindingIndex
        ) => {
          const {
            representativeFinding,
            occurrenceCount,
            affectedPageCount,
            occurrences
          } =
            siteWideFinding;

          /*
           * Resolve all occurrence outcomes first.
           *
           * Keeping this outside a mutating forEach callback
           * also allows TypeScript to narrow the resulting
           * values correctly.
           */
          const outcomes =
            occurrences
              .map(
                occurrence =>
                  occurrence
                    .verificationOutcome ??
                  getOccurrenceOutcome(
                    report,
                    occurrence.pageNumber,
                    occurrence.findingNumber
                  )
              )
              .filter(
                (
                  outcome
                ): outcome is NonNullable<
                  typeof outcome
                > =>
                  outcome !== null
              );

          const statuses:
            FindingInvestigationStatus[] =
            outcomes.map(
              outcome =>
                outcome.status
            );

          const representativeOutcome =
            outcomes[0] ??
            null;

          const investigationStatus =
            summarizeInvestigationStatuses(
              statuses
            );

          lines.push(
            `### ${siteWideFindingIndex + 1}. ${formatSeverity(representativeFinding.severity)} - ${representativeFinding.title}`,
            '',
            `**Status:** ${investigationStatus}  `,
            `**Confidence:** ${formatConfidence(representativeFinding.confidence)}  `,
            `**Observed on:** ${affectedPageCount} page${affectedPageCount === 1 ? '' : 's'} (${occurrenceCount} occurrence${occurrenceCount === 1 ? '' : 's'})`,
            '',
            representativeFinding.evidence,
            ''
          );

          if (
            representativeOutcome !==
            null
          ) {
            lines.push(
              `**Investigation:** ${representativeOutcome.summary}`,
              ''
            );
          }

          lines.push(
            `**Recommended next step:** ${representativeFinding.suggestedCheck}`,
            '',
            '| Page | Verification | Evidence |',
            '| --- | --- | --- |'
          );

          occurrences.forEach(
            occurrence => {
              const outcome =
                occurrence
                  .verificationOutcome ??
                getOccurrenceOutcome(
                  report,
                  occurrence.pageNumber,
                  occurrence.findingNumber
                );

              const status =
                occurrence
                  .redundantInvestigationSkipped
                  ? 'KNOWN — NOT REINVESTIGATED'
                  : outcome ===
                      null
                    ? 'NOT INVESTIGATED'
                    : formatInvestigationStatus(
                        outcome.status
                      );

              lines.push(
                `| ${createPageLink(occurrence.pageTitle, occurrence.pageUrl)} | ${status} | ${createScreenshotLink(occurrence.screenshotPath)} |`
              );
            }
          );

          lines.push(
            ''
          );
        }
      );
  }

  if (
    report.summary.findingsCount >
    0
  ) {
    lines.push(
      '## Rule-Based Findings',
      ''
    );

    report.inspectedPages.forEach(
      pageResult => {
        pageResult.findings.forEach(
          finding => {
            lines.push(
              `- **${formatSeverity(finding.severity)} - ${finding.title}** on ${createPageLink(pageResult.observation.title, pageResult.observation.finalUrl)}: ${finding.evidence}`
            );
          }
        );
      }
    );

    lines.push(
      ''
    );
  }

  lines.push(
    '## Pages Inspected',
    '',
    '| Page | Predicted area / route family | Observed template | HTTP | Exploratory occurrences | Rule-based findings | Technical health |',
    '| --- | --- | --- | ---: | ---: | ---: | --- |'
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

      lines.push(
        `| ${createPageLink(pageResult.observation.title, pageResult.observation.finalUrl)} | ${predictedIdentityLabel} | ${observedTemplateKey} | ${formatHttpStatus(pageResult.observation.httpStatus)} | ${pageResult.exploratoryQaAnalysis.findings.length + pageResult.knownFindingOccurrences.length} | ${pageResult.findings.length} | ${getPageTechnicalStatus(report, pageIndex)} |`
      );
    }
  );

  if (
    report.inspectedPages.length ===
    0
  ) {
    lines.push(
      '| No additional pages were inspected | - | - | - | - | - | - |'
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
