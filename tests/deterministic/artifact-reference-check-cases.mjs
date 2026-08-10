import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';

import { analyze, runPackageCheck } from './artifact-reference-check.mjs';

const MARKDOWN = 'blocked-by-markdown-document-reference';
const REPORT_JSON = 'blocked-by-report-json-reference';
const TECHNICAL = 'blocked-by-technical-evidence-contract';
const SECURITY = 'blocked-by-security-evidence-contract';
const SAFE = 'safe-no-current-contract-reference';

function fixture(markdown, files, jsonPaths = []) {
  const repositoryRoot = resolve('synthetic-repository');
  const packageRoot = join(repositoryRoot, 'report-package');
  const evidenceRoot = join(packageRoot, 'evidence');
  const evidenceFiles = files.map(relativePath => ({
    absolutePath: join(evidenceRoot, relativePath),
    bytes: Buffer.from(relativePath),
    relativePath
  }));
  const existing = new Set(evidenceFiles.map(file => resolve(file.absolutePath).toLowerCase()));
  return analyze({
    evidenceFiles,
    evidenceRoot,
    exists: filePath => existing.has(resolve(filePath).toLowerCase()),
    markdown,
    packageRoot,
    report: { inspectedPages: [{ presentationEvidence: [{ screenshotPaths: jsonPaths }] }] },
    repositoryRoot
  });
}

function pass(name, condition) {
  assert.ok(condition, name);
  console.log(`PASS: ${name}`);
}

function hasError(result, pattern) {
  return pattern.test(result.errors.join('\n'));
}

function runSyntheticChecks() {
  const item = '<a id="item-01"></a>\n';
  let value = fixture(`${item}![proof](evidence/keep.png)`, ['keep.png']).artifacts[0];
  pass(
    'rendered existing artifact is retained',
    value.documentMarkdownReferenceCount === 1 &&
      value.renderedItemReferenceCount === 1 &&
      value.classification === 'retain'
  );
  value = fixture('[proof](evidence/orphan.png)', ['orphan.png']).artifacts[0];
  pass(
    'non-item Markdown reference blocks deletion',
    value.classification === 'remove' && value.deletionSafety.includes(MARKDOWN)
  );
  value = fixture('', ['orphan.png']).artifacts[0];
  pass(
    'fully unreferenced artifact is safe',
    value.deletionSafety.length === 1 && value.deletionSafety[0] === SAFE
  );
  pass(
    'rendered missing Markdown artifact fails integrity',
    hasError(
      fixture(`${item}![proof](evidence/missing.png)`, []),
      /Markdown local artifact is missing/
    )
  );
  pass(
    'non-item missing Markdown artifact fails integrity',
    hasError(fixture('[proof](evidence/missing.png)', []), /Markdown local artifact is missing/)
  );
  pass(
    'report.json missing artifact fails integrity',
    hasError(fixture('', [], ['evidence/missing.png']), /report\.json artifact is missing/)
  );
  pass(
    'technical missing artifact fails integrity',
    hasError(
      fixture('[Structured technical evidence](evidence/missing.json)', []),
      /Technical evidence contract is missing/
    )
  );
  pass(
    'security missing artifact fails integrity',
    hasError(
      fixture('[Security evidence file](evidence/missing.txt)', []),
      /Security evidence contract is missing/
    )
  );
  value = fixture(`${item}![proof](evidence/both.png)`, ['both.png'], ['evidence/both.png'])
    .artifacts[0];
  pass(
    'rendered and JSON referenced artifact is retained',
    value.renderedItemReferenceCount === 1 &&
      value.applicableReportJsonReferenceCount === 1 &&
      value.classification === 'retain'
  );
  value = fixture('', ['json.png'], ['evidence/json.png']).artifacts[0];
  pass(
    'unrendered JSON artifact blocks deletion',
    value.classification === 'remove' && value.deletionSafety.includes(REPORT_JSON)
  );
  value = fixture('[Structured technical evidence](evidence/tech.json)', ['tech.json'])
    .artifacts[0];
  pass(
    'unrendered technical contract blocks deletion',
    value.renderedItemReferenceCount === 0 && value.deletionSafety.includes(TECHNICAL)
  );
  value = fixture('[Security evidence file](evidence/security.txt)', ['security.txt']).artifacts[0];
  pass(
    'unrendered security contract blocks deletion',
    value.renderedItemReferenceCount === 0 && value.deletionSafety.includes(SECURITY)
  );
  pass(
    'external URL is not a local artifact',
    fixture('[external](https://example.com/file.png)', []).errors.length === 0
  );
  pass(
    'rendered escaping reference fails integrity',
    hasError(fixture(`${item}[escape](../outside.txt)`, []), /escapes the package/)
  );
  pass(
    'non-item escaping reference fails integrity',
    hasError(fixture('[escape](../outside.txt)', []), /escapes the package/)
  );
  console.log('All 15 artifact-reference synthetic checks passed.');
}

const arguments_ = process.argv.slice(2);
if (arguments_[0] === '--package' && arguments_.length === 4)
  runPackageCheck(arguments_[1], arguments_[2], arguments_[3]);
else runSyntheticChecks();
