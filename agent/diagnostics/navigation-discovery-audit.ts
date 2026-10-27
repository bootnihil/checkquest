import { createHmac, randomBytes } from 'node:crypto';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { normalizeUrlForComparison, type NavigationUrlState } from '../exploration/visited-links';
import type {
  NavigationPolicyCandidate,
  NavigationPolicyWindow
} from '../exploration/navigation-policy';

// Local-only sidecar, never part of report.json/report.md. Unknown path words are redacted.
// Bounds apply to 20 page summaries, 200 collector occurrences/page, 2,000 stage records,
// and 512 KiB of UTF-8 JSON, including metadata. Truncation never limits engine work.
export const navigationAuditLimits = {
  pages: 20,
  collectorCandidatesPerPage: 200,
  recordsPerRun: 2000,
  outputBytes: 512 * 1024
} as const;

const publicRouteWords = new Set([
  'about',
  'tips',
  'test-cases',
  'notes',
  'api',
  'api-docs',
  'swagger.json',
  'practice',
  'exercises',
  'examples',
  'login',
  'register',
  'logout',
  'search',
  'forms',
  'inputs',
  'dropdown',
  'checkboxes',
  'radio-buttons',
  'buttons',
  'dynamic-controls',
  'dynamic-loading',
  'dynamic-table',
  'tables',
  'tabs',
  'accordion',
  'disclosure',
  'drag-and-drop',
  'add-remove-elements',
  'upload',
  'download',
  'windows',
  'frames',
  'alerts',
  'form-validation',
  'pagination',
  'products',
  'pricing',
  'contact',
  'blog',
  'news',
  'privacy-policy'
]);

export type CollectorReason =
  | 'collected'
  | 'not-visible'
  | 'no-bounding-box'
  | 'non-get-action-link'
  | 'download-link'
  | 'missing-href'
  | 'invalid-url'
  | 'non-http-protocol'
  | 'disallowed-host'
  | 'duplicate-url';

export interface CollectorFacts {
  visible: boolean;
  hasBoundingBox?: boolean;
  insideNavigationContainer?: boolean;
  nearTopOfViewport?: boolean;
  download?: boolean;
  nonGetAction?: boolean;
}

type AuditRecord = { stage: string; [key: string]: unknown };

export function createNavigationDiscoveryAudit(
  runId: string,
  allowedHosts: readonly string[],
  secrets: readonly (string | undefined)[]
): NavigationDiscoveryAudit | undefined {
  try {
    return new NavigationDiscoveryAudit(runId, allowedHosts, secrets);
  } catch {
    console.warn('Navigation discovery audit could not initialize; diagnostics are unavailable.');
    return undefined;
  }
}

export class NavigationDiscoveryAudit {
  private readonly salt = randomBytes(32);
  private readonly records: AuditRecord[] = [];
  private readonly pages = new Map<
    number,
    { encountered: number; recorded: number; reasons: Partial<Record<CollectorReason, number>> }
  >();
  private readonly totals: Record<string, number> = {};
  private readonly truncation = {
    pages: false,
    collectorCandidates: false,
    records: false,
    bytes: false
  };
  private bytes = 0;
  private failures = 0;
  private selections = 0;
  private pagesObserved = 0;
  private domLinksObserved = 0;
  private collectorOutcomesObserved = 0;

  constructor(
    private readonly runId: string,
    private readonly allowedHosts: readonly string[],
    private readonly secrets: readonly (string | undefined)[] = []
  ) {}

  private destination(raw: string, base?: string) {
    try {
      const url = new URL(raw, base);
      if (!['http:', 'https:'].includes(url.protocol)) {
        return { kind: 'non-http' };
      }
      if (!this.allowedHosts.includes(url.hostname)) {
        return { kind: 'external-redacted' };
      }
      const segments = url.pathname
        .split('/')
        .filter(Boolean)
        .slice(0, 12)
        .map(segment => {
          let word: string;
          try {
            word = decodeURIComponent(segment).toLowerCase();
          } catch {
            return ':redacted';
          }
          return publicRouteWords.has(word) &&
            !this.secrets.some(secret => secret && word.includes(secret.toLowerCase()))
            ? word
            : ':redacted';
        });
      return {
        kind: 'allowed-host',
        route: '/' + segments.join('/'),
        pathTruncated: url.pathname.split('/').filter(Boolean).length > 12,
        hasQuery: Boolean(url.search),
        hasFragment: Boolean(url.hash)
      };
    } catch {
      return { kind: 'invalid-or-unavailable' };
    }
  }

  private linkId(raw: string, base?: string): string {
    let identity: string;
    try {
      identity = normalizeUrlForComparison(new URL(raw, base).toString());
    } catch {
      identity = raw;
    }
    return 'link-' + createHmac('sha256', this.salt).update(identity).digest('hex').slice(0, 24);
  }

  private append(record: AuditRecord): void {
    this.totals[record.stage] = (this.totals[record.stage] ?? 0) + 1;
    if (this.records.length >= navigationAuditLimits.recordsPerRun) {
      this.truncation.records = true;
      return;
    }
    const size = Buffer.byteLength(JSON.stringify(record), 'utf8') + 2;
    // Reserve space for bounded counters, page summaries and completion status.
    if (this.bytes + size > navigationAuditLimits.outputBytes - 32 * 1024) {
      this.truncation.bytes = true;
      return;
    }
    this.bytes += size;
    this.records.push(record);
  }

  captureFailure(): void {
    this.failures += 1;
  }

  beginPage(
    page: number,
    url: string,
    domLinkCount: number,
    viewport: { width: number; height: number } | null
  ): void {
    this.pagesObserved += 1;
    this.domLinksObserved += domLinkCount;
    const existing = this.pages.get(page);
    if (!existing && this.pages.size >= navigationAuditLimits.pages) {
      this.truncation.pages = true;
      return;
    }
    if (existing) {
      existing.encountered += domLinkCount;
    } else {
      this.pages.set(page, { encountered: domLinkCount, recorded: 0, reasons: {} });
    }
    this.append({
      stage: 'page',
      page,
      linkId: this.linkId(url),
      destination: this.destination(url),
      domLinkCount,
      viewport
    });
  }

  canRecordCollector(page: number): boolean {
    const summary = this.pages.get(page);
    return (
      summary !== undefined &&
      summary.recorded < navigationAuditLimits.collectorCandidatesPerPage &&
      this.records.length < navigationAuditLimits.recordsPerRun &&
      !this.truncation.bytes
    );
  }

  collector(
    page: number,
    ordinal: number,
    href: string | null | undefined,
    base: string,
    reason: CollectorReason,
    facts: CollectorFacts
  ): void {
    this.collectorOutcomesObserved += 1;
    const summary = this.pages.get(page);
    if (summary) {
      summary.reasons[reason] = (summary.reasons[reason] ?? 0) + 1;
    }
    if (!this.canRecordCollector(page)) {
      this.truncation.collectorCandidates = true;
      return;
    }
    summary!.recorded += 1;
    this.append({
      stage: 'collector',
      page,
      ordinal,
      linkId: href ? this.linkId(href, base) : null,
      destination: href ? this.destination(href, base) : { kind: 'invalid-or-unavailable' },
      reason,
      ...facts
    });
  }

  frontier(page: number, url: string, outcome: 'added' | 'already-present'): void {
    this.append({ stage: 'frontier', page, linkId: this.linkId(url), outcome });
  }

  beginSelection(
    page: number,
    budget: {
      remainingPageSlots: number;
      remainingNavigationDecisionSlots: number;
      remainingPotentialInspections: number;
    }
  ): number {
    const selection = ++this.selections;
    this.append({ stage: 'selection-start', selection, currentPage: page, budget });
    return selection;
  }

  eligibility(selection: number, url: string, eligible: boolean, state: NavigationUrlState): void {
    const normalized = normalizeUrlForComparison(url);
    const attempted = state.attemptedUrls.has(normalized);
    const inspected = state.inspectedFinalUrls.has(normalized);
    this.append({
      stage: 'eligibility',
      selection,
      linkId: this.linkId(url),
      eligible,
      attempted,
      inspected,
      reason: eligible
        ? 'eligible'
        : attempted && inspected
          ? 'attempted-and-inspected'
          : attempted
            ? 'already-attempted'
            : inspected
              ? 'already-inspected'
              : 'ineligible'
    });
  }

  policy(
    selection: number,
    candidates: readonly NavigationPolicyCandidate[],
    window: NavigationPolicyWindow
  ): void {
    this.append({
      stage: 'window',
      selection,
      policyBand: window.policyBand,
      eligibleCounts: window.eligibleValueClassCounts,
      areaBreadthConstrained: window.areaBreadthConstrained,
      candidateLinkIds: window.candidates.map(candidate => this.linkId(candidate.link.url))
    });
    const indices = new Map(
      window.candidates.map((candidate, index) => [candidate.link.url, index])
    );
    for (const candidate of candidates) {
      const plannerIndex = indices.get(candidate.link.url);
      this.append({
        stage: 'policy',
        selection,
        linkId: this.linkId(candidate.link.url),
        valueClass: candidate.valueClass,
        valueReasons: candidate.valueReasons,
        noveltyTier: candidate.noveltyTier,
        traversalDepth: candidate.minimumDiscoveryDepth,
        policyBand: candidate.policyBand,
        reason:
          candidate.policyBand !== window.policyBand
            ? 'deferred-policy-band'
            : plannerIndex === undefined
              ? 'outside-bounded-planner-window'
              : 'planner-visible',
        plannerIndex: plannerIndex ?? null
      });
    }
  }

  plannerInput(selection: number, candidates: readonly NavigationPolicyCandidate[]): void {
    this.append({
      stage: 'planner-input',
      selection,
      linkIds: candidates.map(candidate => this.linkId(candidate.link.url))
    });
  }

  selection(
    selection: number,
    outcome:
      | 'selected'
      | 'finish'
      | 'no-eligible-links'
      | 'budget-exhausted'
      | 'navigation-failed'
      | 'planner-failed'
      | 'duplicate-final-url'
      | 'ready-for-inspection',
    url?: string
  ): void {
    this.append({
      stage: 'selection',
      selection,
      outcome,
      ...(url === undefined ? {} : { linkId: this.linkId(url), destination: this.destination(url) })
    });
  }

  snapshot(execution: 'completed' | 'failed' = 'completed') {
    return {
      format: 'checkquest-navigation-discovery-audit-v1',
      runId: this.runId,
      localOnly: true,
      execution,
      status:
        this.failures > 0
          ? 'capture-incomplete'
          : Object.values(this.truncation).some(Boolean)
            ? 'truncated'
            : execution === 'failed'
              ? 'partial-run'
              : 'complete',
      limits: navigationAuditLimits,
      truncation: { ...this.truncation },
      captureFailures: this.failures,
      stageRecordAttempts: { ...this.totals },
      pagesObserved: this.pagesObserved,
      domLinksObserved: this.domLinksObserved,
      collectorOutcomesObserved: this.collectorOutcomesObserved,
      pageSummaries: Array.from(this.pages, ([page, summary]) => ({ page, ...summary })),
      records: [...this.records]
    };
  }

  async persist(directory: string, execution: 'completed' | 'failed'): Promise<void> {
    const filename = join(directory, 'navigation-discovery-audit.json');
    let temporary: string | undefined;
    try {
      temporary = filename + '.' + randomBytes(6).toString('hex') + '.tmp';
      const data = JSON.stringify(this.snapshot(execution));
      if (Buffer.byteLength(data, 'utf8') > navigationAuditLimits.outputBytes) {
        throw new Error('Audit size bound');
      }
      await mkdir(directory, { recursive: true });
      await writeFile(temporary, data, { encoding: 'utf8', flag: 'wx' });
      await rename(temporary, filename);
      console.info(
        `Navigation discovery audit: ${filename} (${this.snapshot(execution).status}; local diagnostics only).`
      );
    } catch {
      this.captureFailure();
      if (temporary !== undefined) {
        await unlink(temporary).catch(() => undefined);
      }
      console.warn(
        'Navigation discovery audit write failed; diagnostics are incomplete. Exploration outcome is unchanged.'
      );
    }
  }
}
