import {
  test,
  expect
} from '@playwright/test';

import {
  AidocHomePage
} from '../../pages/AidocHomePage';

import {
  AidocSolutionsPage
} from '../../pages/AidocSolutionsPage';

test.describe(
  'Aidoc commercial website',
  () => {
    test(
      'TC-WEB-001: homepage loads successfully',
      async ({ page }) => {
        const homePage =
          new AidocHomePage(
            page
          );

        await homePage.goto();

        await expect(
          page
        ).toHaveTitle(
          /Aidoc/i
        );

        await expect(
          homePage.mainHeading
        ).toBeVisible();
      }
    );

    test(
      'TC-WEB-002: user can navigate from homepage to Solutions',
      async ({ page }) => {
        const homePage =
          new AidocHomePage(
            page
          );

        const solutionsPage =
          new AidocSolutionsPage(
            page
          );

        await homePage.goto();

        await homePage.openSolutions();

        await expect(
          page
        ).toHaveURL(
          /\/solutions\/?$/
        );

        await expect(
          solutionsPage.mainHeading
        ).toBeVisible();

        await expect(
          page
        ).toHaveTitle(
          /AI|Solutions|Aidoc/i
        );
      }
    );

    test(
      'TC-WEB-003: email field validates malformed and valid input',
      async ({ page }) => {
        const homePage =
          new AidocHomePage(
            page
          );

        const solutionsPage =
          new AidocSolutionsPage(
            page
          );

        await homePage.goto();

        await homePage.openSolutions();

        await solutionsPage.fillEmail(
          'invalid-email'
        );

        expect(
          await solutionsPage.isEmailValid()
        ).toBe(false);

        expect(
          await solutionsPage.getEmailValidationMessage()
        ).not.toBe('');

        await solutionsPage.fillEmail(
          'tester@example.com'
        );

        expect(
          await solutionsPage.isEmailValid()
        ).toBe(true);

        expect(
          await solutionsPage.getEmailValidationMessage()
        ).toBe('');
      }
    );
  }
);
