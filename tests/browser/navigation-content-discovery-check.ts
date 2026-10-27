import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { inspectNavigation } from '../../agent/browser/inspect-navigation';
import { visitApprovedLink } from '../../agent/browser/visit-approved-link';
import { NavigationDiscoveryAudit } from '../../agent/diagnostics/navigation-discovery-audit';
import {
  buildNavigationPolicyWindow,
  createNavigationFrontier,
  getNavigationFrontierEntries,
  registerDiscoveredNavigationLinks
} from '../../agent/exploration/navigation-policy';
import { createPageNoveltyState } from '../../agent/exploration/page-novelty';
import { selectNextPageForInspection } from '../../agent/exploration/select-next-page';
import {
  createNavigationUrlState,
  markFinalUrlInspected,
  markNavigationUrlAttempted
} from '../../agent/exploration/visited-links';
import type { NavigationPolicyCandidate } from '../../agent/exploration/navigation-policy';

const origin = 'https://example.test';
const link = (path: string, attributes = '') =>
  `<a href="${origin}${path}" ${attributes}>Local fixture link</a>`;

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const requests: string[] = [];
    await context.route('**/*', route => route.abort());
    const page = await context.newPage();
    page.on('request', request => requests.push(request.url()));
    await page.setContent(`<!doctype html><html><head><title>Discovery fixture</title></head><body>
      <nav>${link('/navigation')}</nav>
      ${link('/overview', 'style="position:absolute;top:30px"')}
      <div style="height:1800px"></div>
      ${Array.from({ length: 180 }, () => link('/catalog/items/item-0')).join('')}
      ${Array.from({ length: 360 }, (_, i) => link(`/catalog/items/item-${i}`)).join('')}
      ${link('/catalog/items/item-2#fragment')}
      ${link('/catalog/items/item-5/')}
      ${link('/invisible', 'style="display:none"')}
      <a href="https://external.test/private">External</a>
      <a href="javascript:alert('must-not-execute')">Script</a>
      <a href="mailto:private@example.test">Mail</a>
      <a href="${origin}/#fragment">Home</a>
      ${link('/method-post', 'data-method="POST"')}
      ${link('/method-delete', 'data-turbo-method="delete"')}
      ${link('/method-unknown', 'data-method="unsupported"')}
      ${link('/read-only', 'data-method=" get "')}
      ${link('/file', 'download')}
      <footer><nav>${link('/help')}</nav></footer>
      ${link('/late-content/details')}
    </body></html>`);
    await page.evaluate(() => {
      (window as unknown as { interactions: number }).interactions = 0;
      for (const type of ['click', 'submit', 'scroll', 'input', 'change']) {
        document.addEventListener(type, () => {
          (window as unknown as { interactions: number }).interactions++;
        });
      }
    });
    const disabled = await inspectNavigation(page, ['example.test']);
    const audit = new NavigationDiscoveryAudit('content-discovery-fixture', ['example.test']);
    const enabled = await inspectNavigation(page, ['example.test'], { audit, pageNumber: 1 });
    assert.deepEqual(enabled, disabled);
    const urls = enabled.map(candidate => candidate.url);
    for (const path of [
      '/navigation',
      '/overview',
      '/catalog/items/item-359',
      '/help',
      '/late-content/details',
      '/read-only'
    ]) {
      assert.ok(urls.includes(origin + path), path);
    }
    assert.equal(urls.filter(url => url === origin + '/catalog/items/item-0').length, 1);
    assert.ok(
      !urls.some(url => /method-|\/file$|\/invisible$|external\.test|javascript:|mailto:/.test(url))
    );
    assert.ok(!urls.some(url => url.includes('#')));
    const after = {
      uniqueCollectedLinks: urls.length,
      ordinaryBelowFoldDiscovered: urls.includes(origin + '/late-content/details'),
      auditCollectorRecords: audit.snapshot().pageSummaries[0]!.recorded
    };
    assert.ok(urls.length > 360);
    assert.equal(audit.snapshot().pageSummaries[0]!.recorded, 200);
    assert.ok((audit.snapshot().pageSummaries[0]!.reasons['duplicate-url'] ?? 0) >= 180);
    assert.equal(audit.snapshot().pageSummaries[0]!.reasons['non-get-action-link'], 3);
    assert.equal(audit.snapshot().pageSummaries[0]!.reasons['download-link'], 1);
    assert.ok(!('outside-navigation-and-top-region' in audit.snapshot().pageSummaries[0]!.reasons));

    const frontier = createNavigationFrontier();
    registerDiscoveredNavigationLinks(frontier, enabled, origin, 0, { audit, pageNumber: 1 });
    assert.equal(
      getNavigationFrontierEntries(frontier).length,
      urls.length - 1,
      'Existing trailing-slash alias normalization remains authoritative.'
    );
    const state = createNavigationUrlState();
    markFinalUrlInspected(state, origin);
    markNavigationUrlAttempted(state, origin + '/catalog/items/item-1');
    const policyInput = {
      frontier,
      urlState: state,
      pageNoveltyState: createPageNoveltyState(),
      budget: {
        remainingPageSlots: 50,
        remainingNavigationDecisionSlots: 50,
        remainingPotentialInspections: 50
      }
    };
    const offWindow = buildNavigationPolicyWindow(policyInput);
    const selection = audit.beginSelection(1, policyInput.budget);
    const onWindow = buildNavigationPolicyWindow({
      ...policyInput,
      diagnostic: { audit, selection }
    });
    assert.deepEqual(onWindow, offWindow);
    assert.equal(onWindow.candidates.length, 20);
    for (const path of ['/navigation', '/overview', '/help', '/late-content/details']) {
      assert.ok(
        onWindow.candidates.some(candidate => candidate.link.url === origin + path),
        'Late areas and navigation candidates must survive an earlier large family.'
      );
    }
    assert.ok(
      !onWindow.candidates.some(
        candidate => candidate.link.url === origin + '/catalog/items/item-1'
      )
    );
    assert.ok(
      audit.snapshot().records.some(record => record.reason === 'outside-bounded-planner-window')
    );
    assert.ok(audit.snapshot().records.some(record => record.reason === 'already-attempted'));
    assert.ok(audit.snapshot().records.some(record => record.reason === 'already-inspected'));

    const runSelection = async (activeAudit?: NavigationDiscoveryAudit) => {
      let input: NavigationPolicyCandidate[] = [];
      const result = await selectNextPageForInspection({
        page,
        site: {
          id: 'local',
          name: 'Local fixture',
          startUrl: origin,
          allowedHosts: ['example.test'],
          maxPages: 7,
          maxAgentSteps: 9,
          maxExploratoryStepsPerPage: 3,
          allowFormSubmission: false
        },
        runId: 'local',
        completedPageCount: 1,
        navigationStepsUsed: 0,
        navigationFrontier: frontier,
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
        navigationAudit: activeAudit,
        chooseNavigationLink: async (_site, candidates) => {
          input = structuredClone(candidates);
          return { type: 'finish', summary: 'Inspect options without authorizing navigation.' };
        }
      });
      return { result, input };
    };
    const selectionAudit = new NavigationDiscoveryAudit('planner-parity-fixture', ['example.test']);
    assert.deepEqual(await runSelection(selectionAudit), await runSelection());
    const actualInput = selectionAudit
      .snapshot()
      .records.find(record => record.stage === 'planner-input')!;
    const actualWindow = selectionAudit
      .snapshot()
      .records.find(
        record => record.stage === 'window' && record.selection === actualInput.selection
      )!;
    assert.deepEqual(actualInput.linkIds, actualWindow.candidateLinkIds);
    assert.equal(await page.evaluate(() => scrollY), 0);
    assert.equal(
      await page.evaluate(() => (window as unknown as { interactions: number }).interactions),
      0
    );

    // URL names are not a safety classifier. Discovery alone cannot authorize a GET with unknown effects.
    await page.setContent(
      link('/opaque-action', 'onclick="window.location.href=\'https://external.test/\'"')
    );
    const ambiguousLinks = await inspectNavigation(page, ['example.test']);
    assert.deepEqual(
      ambiguousLinks.map(candidate => candidate.url),
      [origin + '/opaque-action']
    );
    const ambiguousFrontier = createNavigationFrontier();
    registerDiscoveredNavigationLinks(ambiguousFrontier, ambiguousLinks, origin, 0);
    let considered = false;
    await selectNextPageForInspection({
      page,
      site: {
        id: 'local',
        name: 'Local',
        startUrl: origin,
        allowedHosts: ['example.test'],
        maxPages: 2,
        maxAgentSteps: 1,
        maxExploratoryStepsPerPage: 0,
        allowFormSubmission: false
      },
      runId: 'local',
      completedPageCount: 1,
      navigationStepsUsed: 0,
      navigationFrontier: ambiguousFrontier,
      navigationUrlState: createNavigationUrlState(),
      pageNoveltyState: createPageNoveltyState(),
      diagnosticsCollector: {
        reset() {},
        snapshot() {
          return { consoleErrors: [], failedRequests: [] };
        },
        dispose() {}
      },
      emit() {},
      chooseNavigationLink: async (_site, candidates) => {
        considered = candidates.some(candidate => candidate.link.url.endsWith('/opaque-action'));
        return {
          type: 'finish',
          summary: 'Decline a destination whose effects are not established.'
        };
      }
    });
    assert.equal(considered, true);
    assert.equal(page.url(), 'about:blank');
    await assert.rejects(
      visitApprovedLink(page, { text: 'Rejected', url: 'https://external.test/path' }, [
        'example.test'
      ]),
      /disallowed host/
    );
    assert.deepEqual(requests, []);
    await page.setContent('<h1>Empty fixture</h1><a href="#" style="display:none">Hidden</a>');
    assert.deepEqual(await inspectNavigation(page, ['example.test']), []);
    assert.equal(
      buildNavigationPolicyWindow({ ...policyInput, frontier: createNavigationFrontier() })
        .candidates.length,
      0
    );
    console.log(
      JSON.stringify({
        after,
        plannerWindow: onWindow.candidates.length,
        networkRequests: requests.length,
        auditParity: true
      })
    );
    console.log(
      'Content discovery checks passed: below-fold admission, deduplication, late-area fairness, declared-action/download exclusions, bounded windows and audit parity.'
    );
    await context.close();
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
