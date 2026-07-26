import type {
  SiteAgentReport
} from './report-types';
import {
  writeJsonReport
} from './write-json-report';
import {
  writeMarkdownReport
} from './write-markdown-report';
import {
  CheckQuestError
} from '../errors/checkquest-error';

export interface PersistedSiteAgentReport {
  directoryPath:
    string;
  jsonReportPath:
    string;
  markdownReportPath:
    string;
}

export async function persistSiteAgentReport(
  report:
    SiteAgentReport
): Promise<PersistedSiteAgentReport> {
  try {
    const writtenJsonReport =
      await writeJsonReport(
        report
      );
    const writtenMarkdownReport =
      await writeMarkdownReport(
        report
      );

    return {
      directoryPath:
        writtenJsonReport
          .directoryPath,
      jsonReportPath:
        writtenJsonReport
          .filePath,
      markdownReportPath:
        writtenMarkdownReport
          .filePath
    };
  } catch (
    error:
      unknown
  ) {
    throw new CheckQuestError(
      'REPORTING',
      'The run completed, but its report files could not be persisted.',
      {
        phase:
          'report-persistence',
        runId:
          report.runId,
        cause:
          error
      }
    );
  }
}
