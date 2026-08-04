export interface PageInspectionSequenceOptions<PageInput, PageResult> {
  startPage: PageInput;
  maxPages: number;

  inspectPage: (page: PageInput, pageIndex: number) => Promise<PageResult>;

  getNextPage: (inspectedPages: readonly PageResult[]) => Promise<PageInput | null>;
}

/**
 * Runs one authoritative inspection callback for both the configured start
 * page and every subsequently selected page.
 *
 * Navigation is requested only after the current page has been inspected and
 * only while page budget remains.
 */
export async function runPageInspectionSequence<PageInput, PageResult>(
  options: PageInspectionSequenceOptions<PageInput, PageResult>
): Promise<PageResult[]> {
  if (!Number.isInteger(options.maxPages) || options.maxPages < 1) {
    throw new Error(`maxPages must be a positive integer. Received: ${options.maxPages}.`);
  }

  const inspectedPages: PageResult[] = [];

  let currentPage: PageInput | null = options.startPage;

  while (currentPage !== null && inspectedPages.length < options.maxPages) {
    inspectedPages.push(await options.inspectPage(currentPage, inspectedPages.length));

    if (inspectedPages.length >= options.maxPages) {
      break;
    }

    currentPage = await options.getNextPage(inspectedPages);
  }

  return inspectedPages;
}
