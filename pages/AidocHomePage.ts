import type {
  Locator,
  Page
} from '@playwright/test';

export class AidocHomePage {
  readonly page: Page;
  readonly mainHeading: Locator;
  readonly solutionsLink: Locator;
  readonly cookieDenyButton: Locator;

  private readonly url =
    'https://www.aidoc.com/';

  constructor(
    page: Page
  ) {
    this.page = page;

    this.mainHeading =
      page
        .locator('h1')
        .first();

    this.solutionsLink =
      page
        .getByRole(
          'link',
          {
            name: 'Solutions',
            exact: true
          }
        )
        .first();

    this.cookieDenyButton =
      page.getByRole(
        'button',
        {
          name: 'Deny',
          exact: true
        }
      );
  }

  async goto(): Promise<void> {
    await this.page.goto(
      this.url,
      {
        waitUntil:
          'domcontentloaded'
      }
    );

    await this.dismissCookieBanner();
  }

  async dismissCookieBanner(): Promise<void> {
    if (
      await this.cookieDenyButton.isVisible()
    ) {
      await this.cookieDenyButton.click();
    }
  }

  async openSolutions(): Promise<void> {
    await this.solutionsLink.click();

    await this.page.waitForURL(
      /\/solutions\/?$/,
      {
        waitUntil:
          'domcontentloaded'
      }
    );
  }
}
