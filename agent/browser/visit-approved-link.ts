import type { Page, Response } from '@playwright/test';

import { completeRequiredCleanup } from '../errors/required-cleanup';
import { captureMainDocumentSecurity } from '../security/capture-main-document-security';
import { openInspectionDocument, type InspectionDocument } from './inspection-document';

import type { PassivePageSecuritySnapshot } from '../security/passive-security-model';

import type { NavigationLink } from './inspect-navigation';

export interface VisitedPageObservation {
  requestedUrl: string;
  finalUrl: string;
  title: string;
  httpStatus: number | null;
  headings: string[];
}

export interface PassiveApprovedPageVisit {
  document: InspectionDocument;
  observation: VisitedPageObservation;
  passiveSecuritySnapshot: PassivePageSecuritySnapshot;
}

interface ApprovedPageVisitCore {
  document: InspectionDocument;
  observation: VisitedPageObservation;
  response: Response | null;
}

async function visitApprovedLinkCore(
  page: Page,
  link: NavigationLink,
  allowedHosts: string[],
  signal?: AbortSignal
): Promise<ApprovedPageVisitCore> {
  const requestedUrl = new URL(link.url);

  if (!allowedHosts.includes(requestedUrl.hostname)) {
    throw new Error(`Refusing to visit disallowed host "${requestedUrl.hostname}".`);
  }

  const { response, document } = await openInspectionDocument(
    page,
    requestedUrl.toString(),
    {
      waitUntil: 'domcontentloaded',
      timeout: 30_000
    },
    {
      signal,
      phase: 'agent-navigation'
    }
  );

  try {
    const finalUrl = new URL(page.url());

    if (!allowedHosts.includes(finalUrl.hostname)) {
      throw new Error(`Navigation redirected to disallowed host "${finalUrl.hostname}".`);
    }

    const headings = await page.locator('h1, h2').allTextContents();
    const title = await page.title();
    await document.assertCurrent();

    return {
      document,
      observation: {
        requestedUrl: requestedUrl.toString(),
        finalUrl: finalUrl.toString(),
        title,
        httpStatus: response?.status() ?? null,
        headings: headings
          .map(heading => heading.replace(/\s+/g, ' ').trim())
          .filter(heading => heading.length > 0)
          .slice(0, 10)
      },
      response
    };
  } catch (error) {
    const primaryError =
      error instanceof Error ? error : new Error('Page observation failed.', { cause: error });
    await completeRequiredCleanup(primaryError, [document.dispose], {
      phase: 'inspection-document-cleanup'
    });
    throw primaryError;
  }
}

export async function visitApprovedLink(
  page: Page,
  link: NavigationLink,
  allowedHosts: string[],
  signal?: AbortSignal
): Promise<VisitedPageObservation> {
  const visit = await visitApprovedLinkCore(page, link, allowedHosts, signal);
  await visit.document.dispose();
  return visit.observation;
}

export async function visitApprovedLinkWithPassiveSecurity(
  page: Page,
  link: NavigationLink,
  allowedHosts: string[],
  signal?: AbortSignal
): Promise<PassiveApprovedPageVisit> {
  const { observation, response, document } = await visitApprovedLinkCore(
    page,
    link,
    allowedHosts,
    signal
  );

  try {
    const passiveSecuritySnapshot = await captureMainDocumentSecurity({
      response,
      requestedUrl: observation.requestedUrl,
      finalUrl: observation.finalUrl,
      pageTitle: observation.title
    });
    await document.assertCurrent();
    return { document, observation, passiveSecuritySnapshot };
  } catch (error) {
    const primaryError =
      error instanceof Error
        ? error
        : new Error('Page security observation failed.', { cause: error });
    await completeRequiredCleanup(primaryError, [document.dispose], {
      phase: 'inspection-document-cleanup'
    });
    throw primaryError;
  }
}
