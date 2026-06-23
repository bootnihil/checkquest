# Traceability Matrix

## 1. Purpose

This document provides lightweight traceability between expected system behavior, risk rationale, automated test coverage, and generated evidence for the Regulated QA Automation Demo project.

The purpose is to demonstrate how automated tests can be linked to clear requirements or expected behaviors in a QA-controlled manner.

## 2. Traceability Table

| Requirement ID | Requirement / Expected Behavior                                                   | Risk Level | Risk Rationale                                                                   | Test ID    | Test Layer | Automated | Evidence               |
| -------------- | --------------------------------------------------------------------------------- | ---------: | -------------------------------------------------------------------------------- | ---------- | ---------- | --------- | ---------------------- |
| REQ-UI-001     | A valid user shall be able to log in and view the inventory page.                 |       High | Login failure would block user access to the application.                        | TC-UI-001  | UI         | Yes       | Playwright HTML report |
| REQ-UI-002     | A locked-out user shall receive a clear login error message.                      |     Medium | Incorrect handling may allow unexpected access or provide unclear user feedback. | TC-UI-002  | UI         | Yes       | Playwright HTML report |
| REQ-API-001    | The API shall return user data by ID with expected core fields.                   |     Medium | Missing or incorrect fields may indicate a broken API contract.                  | TC-API-001 | API        | Yes       | Playwright HTML report |
| REQ-API-002    | The API shall accept a valid post creation payload and return a created response. |     Medium | Failure may indicate inability to process valid client requests.                 | TC-API-002 | API        | Yes       | Playwright HTML report |
| REQ-API-003    | The API shall return a not found response for an invalid endpoint.                |        Low | Incorrect error handling may reduce confidence in predictable API behavior.      | TC-API-003 | API        | Yes       | Playwright HTML report |

## 3. Coverage Summary

| Layer | Number of Automated Tests | Coverage Notes                                                                                |
| ----- | ------------------------: | --------------------------------------------------------------------------------------------- |
| UI    |                         2 | Covers valid and invalid login behavior.                                                      |
| API   |                         3 | Covers basic positive response validation, payload submission, and invalid endpoint handling. |
| Total |                         5 | Current scope is intentionally limited for demo purposes.                                     |

## 4. Evidence Mapping

The primary evidence for all automated test cases is the Playwright HTML report generated after execution.

Failure-specific evidence may include:

* Screenshot on failure
* Video on failure
* Trace on first retry

These evidence types are controlled through the Playwright configuration.

## 5. Known Gaps

The current traceability matrix does not cover:

* Full functional coverage of the demo web application
* Full API schema validation
* Authentication and authorization API flows
* Load or performance testing
* Security testing
* Accessibility testing
* Browser compatibility matrix beyond Chromium
* Mobile testing

## 6. Conclusion

The current test suite provides basic traceable automated coverage across UI and API layers.

The matrix demonstrates how test automation can be connected to expected behavior, risk rationale, and objective execution evidence.
