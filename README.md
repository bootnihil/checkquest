# Regulated QA Automation Demo

![Playwright Tests](https://github.com/bootnihil/regulated-qa-automation-demo/actions/workflows/playwright.yml/badge.svg?branch=main)

This repository demonstrates a practical QA automation framework using Playwright and TypeScript.

The goal is to show how UI and API automation can support risk-based regression testing, repeatable execution, and objective test evidence in a regulated software context.

## What This Project Demonstrates

* UI automation using Playwright
* API automation using Playwright request testing
* TypeScript-based test implementation
* Page Object Model for maintainable UI tests
* Positive and negative test scenarios
* Separate UI and API test projects
* HTML test report generation
* Git-based incremental project history

## Current Test Coverage

| Test ID    | Layer | Scenario                                              |
| ---------- | ----- | ----------------------------------------------------- |
| TC-UI-001  | UI    | Valid user can log in and view inventory              |
| TC-UI-002  | UI    | Locked-out user receives login error                  |
| TC-API-001 | API   | Get user by ID returns expected user structure        |
| TC-API-002 | API   | Create post returns created status and echoes payload |
| TC-API-003 | API   | Invalid endpoint returns not found                    |

## Tech Stack

* Playwright
* TypeScript
* Node.js
* GitHub Actions
* HTML test reports

## Project Structure

```text
pages/
  LoginPage.ts

tests/
  ui/
    login.ui.spec.ts
  api/
    users.api.spec.ts

.github/
  workflows/
    playwright.yml
```

## Run All Tests

```bash
npx playwright test
```

## Run UI Tests Only

```bash
npx playwright test --project=ui-chromium
```

## Run API Tests Only

```bash
npx playwright test --project=api
```

## Open the HTML Report

```bash
npx playwright show-report
```

## Notes

This is a portfolio/demo project using public test systems.

The UI tests use a public demo web application.

The API tests use a public fake REST API.

This project is not intended to represent a full production-grade validation package. It is intended to demonstrate practical automation capability, test structure, and QA thinking.
