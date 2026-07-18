import type { Page } from '@playwright/test';

const MAX_BODY_TEXT_LENGTH = 15_000;
const MAX_LINKS = 50;
const MAX_BUTTONS = 30;

export interface PageContentLink {
  text: string;
  url: string;
}

export interface ExtractedPageContent {
  title: string;
  headings: string[];
  bodyText: string;
  links: PageContentLink[];
  buttons: string[];
}

function normalizeText(
  text: string
): string {
  return text
    .replace(/\s+/g, ' ')
    .trim();
}

export async function extractPageContent(
  page: Page
): Promise<ExtractedPageContent> {
  const title = await page.title();

  const headings = await page
    .locator('h1, h2, h3')
    .allTextContents();

  const normalizedHeadings = headings
    .map(normalizeText)
    .filter(Boolean);

  const bodyText = await page
    .locator('body')
    .innerText();

  const normalizedBodyText =
    normalizeText(bodyText).slice(
      0,
      MAX_BODY_TEXT_LENGTH
    );

  const links = await page
    .locator('a[href]')
    .evaluateAll(
      (
        elements,
        maxLinks
      ) => {
        return elements
          .filter((element) => {
            const htmlElement =
              element as HTMLElement;

            return (
              htmlElement.offsetWidth > 0 &&
              htmlElement.offsetHeight > 0
            );
          })
          .slice(0, maxLinks)
          .map((element) => {
            const anchor =
              element as HTMLAnchorElement;

            return {
              text:
                anchor.innerText
                  .replace(/\s+/g, ' ')
                  .trim(),
              url: anchor.href
            };
          });
      },
      MAX_LINKS
    );

  const buttons = await page
    .locator(
      'button, [role="button"], input[type="button"], input[type="submit"]'
    )
    .evaluateAll(
      (
        elements,
        maxButtons
      ) => {
        return elements
          .filter((element) => {
            const htmlElement =
              element as HTMLElement;

            return (
              htmlElement.offsetWidth > 0 &&
              htmlElement.offsetHeight > 0
            );
          })
          .slice(0, maxButtons)
          .map((element) => {
            if (
              element instanceof HTMLInputElement
            ) {
              return element.value
                .replace(/\s+/g, ' ')
                .trim();
            }

            return (
              element.textContent ?? ''
            )
              .replace(/\s+/g, ' ')
              .trim();
          })
          .filter(Boolean);
      },
      MAX_BUTTONS
    );

  return {
    title,
    headings: normalizedHeadings,
    bodyText: normalizedBodyText,
    links: links.filter(
      (link) =>
        link.text.length > 0 &&
        link.url.length > 0
    ),
    buttons
  };
}
