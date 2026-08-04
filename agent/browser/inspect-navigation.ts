import type { Page } from '@playwright/test';

export interface NavigationLink {
  text: string;
  url: string;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 120);
}

export async function inspectNavigation(
  page: Page,
  allowedHosts: string[]
): Promise<NavigationLink[]> {
  await page
    .waitForFunction(() => document.querySelectorAll('a[href]').length > 0, undefined, {
      timeout: 10_000
    })
    .catch(() => undefined);

  const links = page.locator('a[href]');
  const linkCount = await links.count();
  const viewport = page.viewportSize();

  const results: NavigationLink[] = [];
  const seenUrls = new Set<string>();

  for (let index = 0; index < linkCount; index += 1) {
    const link = links.nth(index);

    if (!(await link.isVisible())) {
      continue;
    }

    const box = await link.boundingBox();

    if (!box) {
      continue;
    }

    const insideNavigationContainer = await link.evaluate(element =>
      Boolean(element.closest('nav, header, [role="navigation"], [aria-label*="navigation" i]'))
    );

    const nearTopOfViewport =
      viewport !== null && box.y + box.height > 0 && box.y < Math.min(viewport.height * 0.35, 280);

    if (!insideNavigationContainer && !nearTopOfViewport) {
      continue;
    }

    const rawHref = await link.getAttribute('href');

    if (!rawHref) {
      continue;
    }

    let resolvedUrl: URL;

    try {
      resolvedUrl = new URL(rawHref, page.url());
    } catch {
      continue;
    }

    if (!['http:', 'https:'].includes(resolvedUrl.protocol)) {
      continue;
    }

    if (!allowedHosts.includes(resolvedUrl.hostname)) {
      continue;
    }

    resolvedUrl.hash = '';

    const normalizedUrl = resolvedUrl.toString();

    if (seenUrls.has(normalizedUrl)) {
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
  }

  return results;
}
