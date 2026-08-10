import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

const MARKDOWN = 'blocked-by-markdown-document-reference';
const REPORT_JSON = 'blocked-by-report-json-reference';
const TECHNICAL = 'blocked-by-technical-evidence-contract';
const SECURITY = 'blocked-by-security-evidence-contract';
const OTHER = 'blocked-by-other-named-machine-contract';
const SAFE = 'safe-no-current-contract-reference';

function key(filePath) {
  const absolute = resolve(filePath);
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
}

function inside(filePath, boundary) {
  const value = relative(boundary, filePath);
  return value === '' || (!value.startsWith('..') && !isAbsolute(value));
}

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function markdownLinks(markdown) {
  const links = [];
  let renderedItem = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^##\s|^---\s*$/.test(line)) renderedItem = false;
    if (/^<a id="(?:item-[^"]+|security-[^"]+)"><\/a>\s*$/.test(line)) renderedItem = true;
    const pattern = /!?\[([^\]]*)\]\((<[^>]*>|(?:\\.|[^)])*)\)/g;
    for (const match of line.matchAll(pattern)) {
      links.push({ label: match[1], destination: match[2], renderedItem });
    }
  }
  return links;
}

function localArtifactPath(raw) {
  if (raw.startsWith('#') || /^(?:https?|mailto):/i.test(raw)) return null;
  const unwrapped = raw.startsWith('<') && raw.endsWith('>') ? raw.slice(1, -1) : raw;
  let decoded;
  try {
    decoded = decodeURI(unwrapped).replace(/\\([\\`*{}\[\]()#+\-.!_>])/g, '$1');
  } catch {
    decoded = unwrapped;
  }
  const pathPart = decoded.split(/[?#]/, 1)[0] ?? '';
  const artifactShaped =
    /(^|[\\/])evidence([\\/]|$)|\.(?:png|jpe?g|webp|json|txt)$/i.test(pathPart) ||
    /^(?:\.{0,2}[\\/]|[A-Za-z]:[\\/]|\\\\|file:)/i.test(pathPart);
  return artifactShaped ? pathPart.replaceAll('\\', '/') : null;
}

function knownJsonArtifactPaths(report, errors) {
  if (!report || typeof report !== 'object' || !Array.isArray(report.inspectedPages)) return [];
  const paths = [];
  const addArray = (value, label) => {
    if (value === undefined) return;
    if (!Array.isArray(value)) {
      errors.push(`Known report.json ${label} contract is not an array.`);
      return;
    }
    for (const item of value) {
      if (typeof item === 'string') paths.push(item);
      else errors.push(`Known report.json ${label} value is not a string.`);
    }
  };
  const addNullable = (value, label) => {
    if (value === undefined || value === null) return;
    if (typeof value === 'string') paths.push(value);
    else errors.push(`Known report.json ${label} value is not a string or null.`);
  };
  for (const page of report.inspectedPages) {
    if (!page || typeof page !== 'object') continue;
    addNullable(page.screenshotPath, 'inspectedPages[].screenshotPath');
    if (page.presentationEvidence === undefined) continue;
    if (!Array.isArray(page.presentationEvidence)) {
      errors.push('Known report.json presentationEvidence contract is not an array.');
      continue;
    }
    for (const evidence of page.presentationEvidence) {
      if (evidence && typeof evidence === 'object')
        addArray(evidence.screenshotPaths, 'presentationEvidence[].screenshotPaths');
    }
  }
  for (const finding of Array.isArray(report.findings) ? report.findings : []) {
    for (const occurrence of finding && Array.isArray(finding.occurrences)
      ? finding.occurrences
      : []) {
      if (occurrence && typeof occurrence === 'object')
        addArray(occurrence.screenshotReferences, 'findings[].occurrences[].screenshotReferences');
    }
  }
  for (const finding of Array.isArray(report.siteWideExploratoryFindings)
    ? report.siteWideExploratoryFindings
    : []) {
    for (const occurrence of finding && Array.isArray(finding.occurrences)
      ? finding.occurrences
      : []) {
      if (occurrence && typeof occurrence === 'object')
        addNullable(
          occurrence.screenshotPath,
          'siteWideExploratoryFindings[].occurrences[].screenshotPath'
        );
    }
  }
  return paths;
}

export function analyze(input) {
  const artifacts = input.evidenceFiles.map(file => ({
    path: `evidence/${file.relativePath.replaceAll('\\', '/')}`,
    exists: true,
    sizeBytes: file.bytes.length,
    sha256: hash(file.bytes),
    documentMarkdownReferenceCount: 0,
    renderedItemReferenceCount: 0,
    applicableReportJsonReferenceCount: 0,
    technicalContractReferenceCount: 0,
    securityContractReferenceCount: 0,
    otherNamedContractReferenceCount: 0,
    classification: 'remove',
    deletionSafety: []
  }));
  const byPath = new Map(
    artifacts.map((artifact, index) => [key(input.evidenceFiles[index].absolutePath), artifact])
  );
  const errors = [];
  for (const link of markdownLinks(input.markdown)) {
    const localPath = localArtifactPath(link.destination);
    if (localPath === null) continue;
    if (/^file:/i.test(localPath)) {
      errors.push(`Markdown local artifact uses a file URI: ${link.destination}`);
      continue;
    }
    const target = resolve(input.packageRoot, ...localPath.split('/'));
    if (!inside(target, input.packageRoot)) {
      errors.push(`Markdown local artifact escapes the package: ${link.destination}`);
      continue;
    }
    const exists = input.exists(target);
    if (!exists) errors.push(`Markdown local artifact is missing: ${link.destination}`);
    if (!exists && link.label === 'Structured technical evidence')
      errors.push(`Technical evidence contract is missing: ${link.destination}`);
    if (!exists && link.label === 'Security evidence file')
      errors.push(`Security evidence contract is missing: ${link.destination}`);
    const artifact = byPath.get(key(target));
    if (artifact === undefined) continue;
    artifact.documentMarkdownReferenceCount += 1;
    if (link.renderedItem) artifact.renderedItemReferenceCount += 1;
    if (link.label === 'Structured technical evidence')
      artifact.technicalContractReferenceCount += 1;
    if (link.label === 'Security evidence file') artifact.securityContractReferenceCount += 1;
  }
  for (const raw of knownJsonArtifactPaths(input.report, errors)) {
    if (/^[A-Za-z][A-Za-z\d+.-]*:/i.test(raw) || isAbsolute(raw)) {
      errors.push(`report.json artifact path is not a safe relative path: ${raw}`);
      continue;
    }
    const normalized = raw.replaceAll('\\', '/');
    const target = normalized.startsWith('evidence/')
      ? resolve(input.packageRoot, ...normalized.split('/'))
      : resolve(input.repositoryRoot, ...normalized.split('/'));
    if (!inside(target, input.evidenceRoot)) {
      errors.push(`report.json artifact path escapes the evidence boundary: ${raw}`);
      continue;
    }
    if (!input.exists(target)) errors.push(`report.json artifact is missing: ${raw}`);
    const artifact = byPath.get(key(target));
    if (artifact !== undefined) artifact.applicableReportJsonReferenceCount += 1;
  }
  for (const artifact of artifacts) {
    artifact.classification = artifact.renderedItemReferenceCount > 0 ? 'retain' : 'remove';
    const blocks = [];
    if (artifact.documentMarkdownReferenceCount > 0) blocks.push(MARKDOWN);
    if (artifact.applicableReportJsonReferenceCount > 0) blocks.push(REPORT_JSON);
    if (artifact.technicalContractReferenceCount > 0) blocks.push(TECHNICAL);
    if (artifact.securityContractReferenceCount > 0) blocks.push(SECURITY);
    if (artifact.otherNamedContractReferenceCount > 0) blocks.push(OTHER);
    artifact.deletionSafety = blocks.length > 0 ? blocks : [SAFE];
  }
  artifacts.sort((left, right) => left.path.toLowerCase().localeCompare(right.path.toLowerCase()));
  const total = field => artifacts.reduce((sum, artifact) => sum + artifact[field], 0);
  return {
    artifacts,
    errors: errors.sort(),
    totals: {
      filesystemArtifacts: artifacts.length,
      documentMarkdownReferences: total('documentMarkdownReferenceCount'),
      renderedItemReferences: total('renderedItemReferenceCount'),
      reportJsonReferences: total('applicableReportJsonReferenceCount'),
      technicalContractReferences: total('technicalContractReferenceCount'),
      securityContractReferences: total('securityContractReferenceCount'),
      otherContractReferences: total('otherNamedContractReferenceCount'),
      retain: artifacts.filter(artifact => artifact.classification === 'retain').length,
      removeCandidates: artifacts.filter(artifact => artifact.classification === 'remove').length
    }
  };
}

function listFiles(root, directory = root) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) return listFiles(root, absolutePath);
    return entry.isFile()
      ? [
          {
            absolutePath,
            bytes: readFileSync(absolutePath),
            relativePath: relative(root, absolutePath)
          }
        ]
      : [];
  });
}

export function runPackageCheck(markdownPath, jsonPath, evidencePath) {
  const packageRoot = dirname(resolve(markdownPath));
  const evidenceRoot = resolve(evidencePath);
  const result = analyze({
    evidenceFiles: listFiles(evidenceRoot),
    evidenceRoot,
    exists: filePath => existsSync(filePath) && statSync(filePath).isFile(),
    markdown: readFileSync(markdownPath, 'utf8'),
    packageRoot,
    report: JSON.parse(readFileSync(jsonPath, 'utf8')),
    repositoryRoot: process.cwd()
  });
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  console.log(`INDEPENDENT_RESULT_SHA256=${hash(serialized)}`);
  console.log(serialized.trimEnd());
  console.log(`HYGIENE_FINDINGS=${result.totals.removeCandidates}`);
  if (result.errors.length > 0) process.exitCode = 1;
}
