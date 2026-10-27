import type { Page } from '@playwright/test';
import type {
  CollectorFacts,
  CollectorReason,
  NavigationDiscoveryAudit
} from '../diagnostics/navigation-discovery-audit';

export interface NavigationLink {
  text: string;
  url: string;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 120);
}

export async function inspectNavigation(
  page: Page,
  allowedHosts: string[],
  diagnostic?: { audit: NavigationDiscoveryAudit; pageNumber: number }
): Promise<NavigationLink[]> {
  await page
    .waitForFunction(() => document.querySelectorAll('a[href]').length > 0, undefined, {
      timeout: 10_000
    })
    .catch(() => undefined);

  const links = page.locator('a[href]');
  const linkCount = await links.count();
  const viewport = page.viewportSize();
  diagnostic?.audit.beginPage(diagnostic.pageNumber, page.url(), linkCount, viewport);

  const results: NavigationLink[] = [];
  const seenUrls = new Set<string>();

  for (let index = 0; index < linkCount; index += 1) {
    const link = links.nth(index);
    const facts: CollectorFacts = { visible: false };
    const record = async (reason: CollectorReason, knownHref?: string | null): Promise<void> => {
      if (!diagnostic) {
        return;
      }
      let href = knownHref;
      if (href === undefined && diagnostic.audit.canRecordCollector(diagnostic.pageNumber)) {
        try {
          href = await link.getAttribute('href');
        } catch {
          diagnostic.audit.captureFailure();
        }
      }
      diagnostic.audit.collector(diagnostic.pageNumber, index, href, page.url(), reason, facts);
    };

    if (!(await link.isVisible())) {
      if (diagnostic) {
        await record('not-visible');
      }
      continue;
    }
    facts.visible = true;

    const box = await link.boundingBox();

    if (!box) {
      facts.hasBoundingBox = false;
      if (diagnostic) {
        await record('no-bounding-box');
      }
      continue;
    }
    facts.hasBoundingBox = true;

    const insideNavigationContainer = await link.evaluate(element =>
      Boolean(element.closest('nav, header, [role="navigation"], [aria-label*="navigation" i]'))
    );

    const nearTopOfViewport =
      viewport !== null && box.y + box.height > 0 && box.y < Math.min(viewport.height * 0.35, 280);
    facts.insideNavigationContainer = insideNavigationContainer;
    facts.nearTopOfViewport = nearTopOfViewport;

    if (!insideNavigationContainer && !nearTopOfViewport) {
      if (diagnostic) {
        await record('outside-navigation-and-top-region');
      }
      continue;
    }

    const rawHref = await link.getAttribute('href');

    if (!rawHref) {
      if (diagnostic) {
        await record('missing-href', rawHref);
      }
      continue;
    }

    let resolvedUrl: URL;

    try {
      resolvedUrl = new URL(rawHref, page.url());
    } catch {
      if (diagnostic) {
        await record('invalid-url', rawHref);
      }
      continue;
    }

    if (!['http:', 'https:'].includes(resolvedUrl.protocol)) {
      if (diagnostic) {
        await record('non-http-protocol', rawHref);
      }
      continue;
    }

    if (!allowedHosts.includes(resolvedUrl.hostname)) {
      if (diagnostic) {
        await record('disallowed-host', rawHref);
      }
      continue;
    }

    resolvedUrl.hash = '';

    const normalizedUrl = resolvedUrl.toString();

    if (seenUrls.has(normalizedUrl)) {
      if (diagnostic) {
        await record('duplicate-url', rawHref);
      }
      continue;
    }

    const visibleText = normalizeText(await link.innerText());
    const ariaLabel = normalizeText((await link.getAttribute('aria-label')) ?? '');
    const title = normalizeText((await link.getAttribute('title')) ?? '');

    const text = visibleText || ariaLabel || title || resolvedUrl.pathname || normalizedUrl;

    seenUrls.add(normalizedUrl);

    results.push({
      text,
      url: normalizedUrl
    });
    if (diagnostic) {
      await record('collected', rawHref);
    }
  }

  return results;
}
