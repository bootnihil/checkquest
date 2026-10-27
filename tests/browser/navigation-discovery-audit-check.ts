import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { access, mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

import { startCheckQuest } from '../../agent/application/start-checkquest';
import { inspectNavigation } from '../../agent/browser/inspect-navigation';
import {
  NavigationDiscoveryAudit,
  navigationAuditLimits
} from '../../agent/diagnostics/navigation-discovery-audit';
import {
  buildNavigationPolicyWindow,
  createNavigationFrontier,
  registerDiscoveredNavigationLinks
} from '../../agent/exploration/navigation-policy';
import { createPageNoveltyState } from '../../agent/exploration/page-novelty';
import { selectNextPageForInspection } from '../../agent/exploration/select-next-page';
import {
  createNavigationUrlState,
  markFinalUrlInspected,
  markNavigationUrlAttempted
} from '../../agent/exploration/visited-links';
import type { RunSiteDependencies } from '../../agent/run/run-site';
import { listenOnBrowserSafeLoopbackPort } from '../support/listen-on-browser-safe-loopback-port';

const out = resolve('workdir/navigation-audit-check');
const secret = 'AIza-synthetic-secret-not-a-real-provider-key';
const auditName = 'navigation-discovery-audit.json';
const budget = {
  remainingPageSlots: 50,
  remainingNavigationDecisionSlots: 50,
  remainingPotentialInspections: 50
};

async function checkBounds(): Promise<void> {
  const recordBound = new NavigationDiscoveryAudit('record-limit', ['example.com']);
  for (let i = 0; i < 2100; i++) {
    recordBound.frontier(1, `https://example.com/inputs?private=${i}`, 'added');
  }
  assert.equal(recordBound.snapshot().records.length, navigationAuditLimits.recordsPerRun);
  assert.equal(recordBound.snapshot().truncation.records, true);
  assert.equal(recordBound.snapshot().stageRecordAttempts.frontier, 2100);
  await recordBound.persist(join(out, 'record-limit'), 'completed');

  const byteBound = new NavigationDiscoveryAudit('byte-limit', ['example.com']);
  for (let page = 1; page <= 21; page++) {
    byteBound.beginPage(page, 'https://example.com/', 201, null);
    for (let ordinal = 0; ordinal <= 200; ordinal++) {
      byteBound.collector(
        page,
        ordinal,
        '/' + Array(12).fill('form-validation').join('/') + `?secret=${ordinal}`,
        'https://example.com/',
        'collected',
        {
          visible: true,
          hasBoundingBox: true,
          insideNavigationContainer: true,
          nearTopOfViewport: false
        }
      );
    }
  }
  assert.equal(byteBound.snapshot().truncation.bytes, true);
  assert.equal(byteBound.snapshot().truncation.collectorCandidates, true);
  assert.equal(byteBound.snapshot().truncation.pages, true);
  assert.equal(byteBound.snapshot().pagesObserved, 21);
  assert.equal(byteBound.snapshot().domLinksObserved, 21 * 201);
  assert.equal(byteBound.snapshot().collectorOutcomesObserved, 21 * 201);
  assert.equal(byteBound.snapshot().pageSummaries.length, 20);
  assert.ok(byteBound.snapshot().pageSummaries.every(page => page.recorded <= 200));
  await byteBound.persist(join(out, 'byte-limit'), 'completed');
  for (const name of ['record-limit', 'byte-limit']) {
    const filename = join(out, name, auditName);
    assert.ok((await stat(filename)).size <= navigationAuditLimits.outputBytes);
    assert.equal(JSON.parse(await readFile(filename, 'utf8')).status, 'truncated');
  }

  const incomplete = new NavigationDiscoveryAudit('capture-failure', []);
  incomplete.captureFailure();
  await incomplete.persist(join(out, 'capture-failure'), 'failed');
  const saved = JSON.parse(await readFile(join(out, 'capture-failure', auditName), 'utf8'));
  assert.equal(saved.status, 'capture-incomplete');
  assert.equal(saved.execution, 'failed');
}

async function main(): Promise<void> {
  await mkdir(out, { recursive: true });
  const originalDirectory = process.cwd();
  process.chdir(out);
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url ?? ''}`);
    response.writeHead(200, {
      'content-type': 'text/html',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:"
    });
    response.end(`<!doctype html><html><head><title>Local audit fixture</title><link rel="icon" href="data:,"></head><body><h1>Local fixture</h1>
      <a href="/inputs?private=query-secret#fragment-secret" style="position:absolute;top:30px">Private customer jane@example.com</a>
      <a href="/dropdown" style="position:absolute;top:800px">Lower exercise</a>
      <a href="/notes/action" data-method="delete">Declared action</a>
      <a href="/notes/file" download>Declared download</a>
      <a href="/checkboxes" style="display:none">Hidden exercise</a>
      <a href="http://fixture-user:fixture-password@${request.headers.host}/inputs?token=query-secret" style="display:none">Private credentials</a>
      <nav style="position:absolute;top:1000px">
      <a href="/about">About</a><a href="https://rejected-private.example/customer/token">External</a>
      <a href="mailto:private@example.com">Mail</a><a href="javascript:alert('private-script')">Script</a>
      <a href="#fragment-secret">Fragment</a><a href="/">Duplicate root</a><a href="/about#other-fragment">Duplicate about</a>
      <a href="http://[">Invalid</a><a href="">Empty</a>
      <a href="/notes/private-person@example.com/${secret}/12345678?token=query-secret#fragment-secret">Sensitive path</a>
      </nav></body></html>`);
  });
  const port = await listenOnBrowserSafeLoopbackPort(server, 'Navigation audit fixture');
  const origin = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await context.route('**/*', route =>
      new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort()
    );
    const page = await context.newPage();
    await page.goto(origin);
    await page.evaluate(() => {
      (window as unknown as { auditInteractions: number }).auditInteractions = 0;
      for (const type of ['click', 'submit', 'scroll', 'input', 'change']) {
        document.addEventListener(type, () => {
          (window as unknown as { auditInteractions: number }).auditInteractions++;
        });
      }
    });
    const audit = new NavigationDiscoveryAudit('local-fixture', ['127.0.0.1'], [secret]);
    const requestsBefore = requests.length;
    const disabled = await inspectNavigation(page, ['127.0.0.1']);
    const enabled = await inspectNavigation(page, ['127.0.0.1'], { audit, pageNumber: 1 });
    assert.deepEqual(enabled, disabled, 'Collector order and identities must be identical.');
    assert.equal(requests.length, requestsBefore, 'Audit must not request any resource.');
    assert.equal(await page.evaluate(() => scrollY), 0);
    assert.equal(
      await page.evaluate(
        () => (window as unknown as { auditInteractions: number }).auditInteractions
      ),
      0
    );
    const collectors = audit.snapshot().records.filter(record => record.stage === 'collector');
    const reasons = collectors.map(record => record.reason);
    for (const reason of [
      'collected',
      'non-get-action-link',
      'download-link',
      'not-visible',
      'disallowed-host',
      'non-http-protocol',
      'duplicate-url',
      'invalid-url',
      'missing-href'
    ]) {
      assert.ok(reasons.includes(reason), reason);
    }
    const hidden = collectors.find(record => record.reason === 'not-visible')!;
    assert.equal(
      hidden.insideNavigationContainer,
      undefined,
      'Do not claim an unobserved later gate.'
    );
    assert.equal(hidden.nearTopOfViewport, undefined);
    assert.ok(!reasons.includes('outside-navigation-and-top-region'));
    const lower = collectors.find(
      record => (record.destination as { route?: string })?.route === '/dropdown'
    )!;
    assert.equal(lower.reason, 'collected');
    assert.deepEqual(lower.destination, {
      kind: 'allowed-host',
      route: '/dropdown',
      pathTruncated: false,
      hasQuery: false,
      hasFragment: false
    });
    assert.equal(lower.insideNavigationContainer, false);
    assert.equal(lower.nearTopOfViewport, false);
    assert.ok(
      collectors.some(
        record =>
          record.reason === 'collected' &&
          record.insideNavigationContainer === true &&
          record.nearTopOfViewport === false
      )
    );
    assert.ok(
      collectors.some(
        record =>
          record.reason === 'collected' &&
          record.insideNavigationContainer === false &&
          record.nearTopOfViewport === true
      )
    );

    const frontier = createNavigationFrontier();
    registerDiscoveredNavigationLinks(frontier, enabled, origin, 0, { audit, pageNumber: 1 });
    registerDiscoveredNavigationLinks(frontier, enabled, origin, 0, { audit, pageNumber: 1 });
    assert.ok(
      audit
        .snapshot()
        .records.some(record => record.stage === 'frontier' && record.outcome === 'already-present')
    );
    const state = createNavigationUrlState();
    markNavigationUrlAttempted(state, new URL('/about', origin).href);
    markFinalUrlInspected(state, origin);
    const policyInput = {
      frontier,
      urlState: state,
      pageNoveltyState: createPageNoveltyState(),
      budget
    };
    const policyDisabled = buildNavigationPolicyWindow(policyInput);
    const selection = audit.beginSelection(1, budget);
    const policyEnabled = buildNavigationPolicyWindow({
      ...policyInput,
      diagnostic: { audit, selection }
    });
    assert.deepEqual(
      policyEnabled,
      policyDisabled,
      'Planner input and ordering must remain identical.'
    );
    assert.ok(audit.snapshot().records.some(record => record.reason === 'already-attempted'));
    assert.ok(audit.snapshot().records.some(record => record.reason === 'already-inspected'));
    const offered = audit.snapshot().records.find(record => record.stage === 'window')!;
    assert.deepEqual(
      offered.candidateLinkIds,
      audit
        .snapshot()
        .records.filter(
          record =>
            record.stage === 'policy' &&
            record.selection === selection &&
            record.plannerIndex !== null
        )
        .sort((a, b) => Number(a.plannerIndex) - Number(b.plannerIndex))
        .map(record => record.linkId)
    );
    assert.equal((offered.candidateLinkIds as string[]).length, policyEnabled.candidates.length);
    const collectedIds = new Set(collectors.map(record => record.linkId));
    assert.ok(
      audit
        .snapshot()
        .records.filter(record => ['frontier', 'eligibility', 'policy'].includes(record.stage))
        .every(record => collectedIds.has(record.linkId)),
      'Opaque identifiers correlate stages.'
    );

    const many = createNavigationFrontier();
    registerDiscoveredNavigationLinks(
      many,
      Array.from({ length: 30 }, (_, i) => ({
        text: 'private text',
        url: `${origin}/exercises/${i}`
      })),
      origin,
      0
    );
    registerDiscoveredNavigationLinks(
      many,
      [{ text: 'private text', url: origin + '/blog/story' }],
      origin,
      0
    );
    const windowed = buildNavigationPolicyWindow({
      frontier: many,
      urlState: createNavigationUrlState(),
      pageNoveltyState: createPageNoveltyState(),
      budget,
      diagnostic: { audit, selection: audit.beginSelection(1, budget) }
    });
    assert.equal(windowed.candidates.length, 20);
    assert.ok(
      audit.snapshot().records.some(record => record.reason === 'outside-bounded-planner-window')
    );
    assert.ok(audit.snapshot().records.some(record => record.reason === 'deferred-policy-band'));
    const empty = buildNavigationPolicyWindow({
      frontier: createNavigationFrontier(),
      urlState: state,
      pageNoveltyState: createPageNoveltyState(),
      budget,
      diagnostic: { audit, selection: audit.beginSelection(1, budget) }
    });
    assert.equal(empty.candidates.length, 0);
    assert.ok(
      audit
        .snapshot()
        .records.some(record => record.stage === 'window' && record.policyBand === null)
    );
    for (const entry of many.entries.values()) {
      markNavigationUrlAttempted(state, entry.link.url);
      markFinalUrlInspected(state, entry.link.url);
    }
    const exhausted = buildNavigationPolicyWindow({
      frontier: many,
      urlState: state,
      pageNoveltyState: createPageNoveltyState(),
      budget,
      diagnostic: { audit, selection: audit.beginSelection(1, budget) }
    });
    assert.equal(exhausted.candidates.length, 0);
    assert.ok(audit.snapshot().records.some(record => record.reason === 'attempted-and-inspected'));
    const terminalInput = {
      page,
      site: {
        id: 'local',
        name: 'Local',
        startUrl: origin,
        allowedHosts: ['127.0.0.1'],
        maxPages: 2,
        maxAgentSteps: 1,
        maxExploratoryStepsPerPage: 0,
        allowFormSubmission: false
      },
      runId: 'local',
      completedPageCount: 1,
      navigationStepsUsed: 0,
      navigationFrontier: createNavigationFrontier(),
      navigationUrlState: state,
      pageNoveltyState: createPageNoveltyState(),
      diagnosticsCollector: {
        reset() {},
        snapshot() {
          return { consoleErrors: [], failedRequests: [] };
        },
        dispose() {}
      },
      emit() {},
      navigationAudit: audit,
      chooseNavigationLink: async () => {
        throw new Error('Empty/exhausted frontier must not call planner.');
      }
    };
    const noLinks = await selectNextPageForInspection(terminalInput);
    assert.equal(noLinks.navigationStepsUsed, 0);
    const noBudget = await selectNextPageForInspection({
      ...terminalInput,
      navigationStepsUsed: 1
    });
    assert.equal(noBudget.navigationStepsUsed, 1);
    assert.ok(audit.snapshot().records.some(record => record.outcome === 'no-eligible-links'));
    assert.ok(audit.snapshot().records.some(record => record.outcome === 'budget-exhausted'));
    const finishFrontier = createNavigationFrontier();
    registerDiscoveredNavigationLinks(
      finishFrontier,
      [{ text: 'Input', url: origin + '/inputs' }],
      origin,
      0
    );
    const finished = await selectNextPageForInspection({
      ...terminalInput,
      navigationFrontier: finishFrontier,
      navigationUrlState: createNavigationUrlState(),
      chooseNavigationLink: async () => ({ type: 'finish', summary: 'Deterministic stop.' })
    });
    assert.equal(finished.navigationStepsUsed, 1);
    await assert.rejects(
      selectNextPageForInspection({
        ...terminalInput,
        navigationFrontier: finishFrontier,
        navigationUrlState: createNavigationUrlState(),
        chooseNavigationLink: async () => {
          throw new Error('Injected planner failure');
        }
      }),
      /Injected planner failure/
    );
    assert.ok(audit.snapshot().records.some(record => record.outcome === 'finish'));
    assert.ok(audit.snapshot().records.some(record => record.outcome === 'planner-failed'));
    for (const actualInput of audit
      .snapshot()
      .records.filter(record => record.stage === 'planner-input')) {
      const window = audit
        .snapshot()
        .records.find(
          record => record.stage === 'window' && record.selection === actualInput.selection
        )!;
      assert.deepEqual(actualInput.linkIds, window.candidateLinkIds);
    }
    await audit.persist(join(out, 'collector'), 'completed');
    const serialized = await readFile(join(out, 'collector', auditName), 'utf8');
    for (const privateValue of [
      secret,
      'query-secret',
      'fragment-secret',
      'other-fragment',
      'jane@example.com',
      'private-person',
      '12345678',
      'rejected-private.example',
      'private@example.com',
      'private-script',
      'Private customer',
      'private text',
      'fixture-user',
      'fixture-password',
      'Private credentials'
    ]) {
      assert.ok(!serialized.includes(privateValue), privateValue);
    }
    assert.ok(serialized.includes('/dropdown'));
    assert.ok(serialized.includes(':redacted'));
    assert.equal(JSON.parse(serialized).status, 'complete');
    await page.setContent(
      '<nav>' +
        Array.from(
          { length: 230 },
          (_, i) => `<a href="${origin}/inputs?item=${i}">Input</a>`
        ).join('') +
        '</nav>'
    );
    const collectorBound = new NavigationDiscoveryAudit('collector-bound', ['127.0.0.1']);
    const manyDisabled = await inspectNavigation(page, ['127.0.0.1']);
    const manyEnabled = await inspectNavigation(page, ['127.0.0.1'], {
      audit: collectorBound,
      pageNumber: 1
    });
    assert.deepEqual(manyEnabled, manyDisabled);
    assert.equal(manyEnabled.length, 230);
    assert.equal(collectorBound.snapshot().pageSummaries[0]!.recorded, 200);
    assert.equal(collectorBound.snapshot().pageSummaries[0]!.reasons.collected, 230);
    assert.equal(collectorBound.snapshot().status, 'truncated');
    assert.equal(requests.length, requestsBefore);
    await context.close();

    // Full application boundary: deterministic collaborators, local GETs only, no Gemini.
    let failedRunDirectory = '';
    const run = async (mode: 'off' | 'on' | 'write-failure' | 'analysis-failure') => {
      const plannerInputs: unknown[] = [];
      const selected: string[] = [];
      const start = requests.length;
      const dependencies: RunSiteDependencies = {
        analyzePageForQa: async () => {
          if (mode === 'analysis-failure') {
            throw new Error('Injected local failure');
          }
          return { findings: [], summary: 'No synthetic findings.' };
        },
        planNextAction: async () => {
          throw new Error('Investigation must not be invoked.');
        },
        chooseNavigationLink: async (_site, candidates, remaining) => {
          plannerInputs.push(structuredClone({ candidates, remaining }));
          const candidate = candidates[0]!;
          selected.push(candidate.link.url);
          return {
            type: 'link',
            link: candidate.link,
            predictedIdentity: candidate.predictedIdentity,
            policyCandidate: candidate,
            reason: 'First deterministic candidate.'
          };
        },
        generateHumanNarrative: async () => {
          throw new Error('No model narrative is required.');
        }
      };
      const operation = startCheckQuest({
        target: origin,
        budgets: { pages: 2, navigationSteps: 2, investigationStepsPerPage: 0 },
        credentials: { geminiApiKey: secret },
        dependencies,
        navigationAudit: mode === 'off' ? undefined : { enabled: true },
        onEvent: event => {
          if (mode === 'analysis-failure' && event.type === 'run-started') {
            failedRunDirectory = join('agent-results', event.runId);
          }
          if (mode === 'write-failure' && event.type === 'run-started') {
            mkdirSync(join('agent-results', event.runId, auditName), { recursive: true });
          }
        }
      });
      const result = await operation.result;
      return { ...result, plannerInputs, selected, requests: requests.slice(start) };
    };
    const off = await run('off');
    await assert.rejects(access(join(off.reportDirectoryPath, auditName)));
    const on = await run('on');
    assert.deepEqual(on.plannerInputs, off.plannerInputs);
    assert.deepEqual(on.selected, off.selected);
    assert.deepEqual(on.requests, off.requests);
    assert.ok(on.requests.every(request => request.startsWith('GET ')));
    const normalize = (report: typeof on.report) => ({
      ...report,
      runId: '',
      startedAt: '',
      finishedAt: ''
    });
    assert.deepEqual(
      normalize(on.report),
      normalize(off.report),
      'Findings, budgets, page associations and report schema must be unchanged.'
    );
    const normalizeMarkdown = (text: string) => text.replace(/in \d+(?:m \d+s|s)/, 'in DURATION');
    assert.equal(
      normalizeMarkdown(await readFile(on.markdownReportPath, 'utf8')),
      normalizeMarkdown(await readFile(off.markdownReportPath, 'utf8'))
    );
    const appAudit = JSON.parse(await readFile(join(on.reportDirectoryPath, auditName), 'utf8'));
    assert.equal(appAudit.execution, 'completed');
    assert.equal(appAudit.status, 'complete');
    assert.ok(
      appAudit.records.some((record: { outcome?: string }) => record.outcome === 'selected')
    );
    assert.ok(
      appAudit.records.some(
        (record: { outcome?: string }) => record.outcome === 'ready-for-inspection'
      )
    );
    assert.equal(JSON.stringify(appAudit).includes(secret), false);
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (message: string) => {
      warnings.push(message);
    };
    try {
      const failedWrite = await run('write-failure');
      assert.deepEqual(normalize(failedWrite.report), normalize(off.report));
      assert.ok(warnings.some(warning => warning.includes('write failed')));
      assert.ok(
        !(await readdir(failedWrite.reportDirectoryPath)).some(name => name.endsWith('.tmp'))
      );
    } finally {
      console.warn = originalWarn;
    }
    await assert.rejects(run('analysis-failure'), /unexpected CheckQuest failure/i);
    const failedAudit = JSON.parse(await readFile(join(failedRunDirectory, auditName), 'utf8'));
    assert.equal(failedAudit.execution, 'failed');
    assert.equal(failedAudit.status, 'partial-run');
    await checkBounds();
    console.log(
      'Navigation discovery audit checks passed: local collector stages, policy windows, redaction, limits, enabled/disabled application parity, failure isolation; no Gemini.'
    );
  } finally {
    await browser.close();
    await new Promise<void>((resolveClose, reject) =>
      server.close(error => (error ? reject(error) : resolveClose()))
    );
    process.chdir(originalDirectory);
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
