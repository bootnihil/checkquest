import type {
  Locator,
  Page
} from '@playwright/test';

export class AidocSolutionsPage {
  readonly page: Page;
  readonly mainHeading: Locator;
  readonly emailField: Locator;

  constructor(
    page: Page
  ) {
    this.page = page;

    this.mainHeading =
      page
        .locator('h1')
        .first();

    this.emailField =
      page
        .getByLabel(
          /^YOUR EMAIL\*$/i
        );
  }

  async fillEmail(
    email: string
  ): Promise<void> {
    await this.emailField.fill(
      email
    );
  }

  async isEmailValid(): Promise<boolean> {
    return this.emailField.evaluate(
      element =>
        (
          element as HTMLInputElement
        ).validity.valid
    );
  }

  async getEmailValidationMessage(): Promise<string> {
    return this.emailField.evaluate(
      element =>
        (
          element as HTMLInputElement
        ).validationMessage
    );
  }
}
