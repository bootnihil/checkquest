import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SiteAgentReport } from './report-types';

export interface WrittenReport {
  directoryPath: string;
  filePath: string;
}

export async function writeJsonReport(report: SiteAgentReport): Promise<WrittenReport> {
  const directoryPath = join('agent-results', report.runId);

  const filePath = join(directoryPath, 'report.json');

  await mkdir(directoryPath, {
    recursive: true
  });

  await writeFile(filePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  return {
    directoryPath,
    filePath
  };
}
