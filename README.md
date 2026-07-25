<p align="center">
  <img src="assets/branding/checkquest-banner.png" alt="CheckQuest — Explore. Check. Prove." width="100%">
</p>

# CheckQuest

[![Repository Quality](https://github.com/bootnihil/checkquest/actions/workflows/quality.yml/badge.svg)](https://github.com/bootnihil/checkquest/actions/workflows/quality.yml)

CheckQuest is an experimental exploratory web-testing agent built with
TypeScript, Playwright, Gemini, and Zod. It combines model reasoning with
deterministic browser execution, evidence collection, and structured
reporting.

> AI helps decide what is worth investigating. Deterministic code controls
> which browser actions are permitted.

CheckQuest performs bounded, non-exhaustive exploration. It is designed for
careful testing of HTTP/HTTPS websites, not unrestricted crawling or general
browser automation.

## What it does today

CheckQuest currently:

- fully inspects the configured start page as page 1;
- performs bounded multi-page navigation over eligible internal links;
- uses deterministic route policy and page novelty/diversity before model
  navigation choice;
- combines deterministic findings with evidence-grounded model observations;
- conservatively reconciles findings into canonical logical findings and
  page occurrences;
- supplies run-level known-finding context to later page analysis and can
  suppress redundant investigation of findings already verified;
- ties every autonomous investigation action to a concrete page-local
  candidate and evidence target;
- supports constrained form-control actions plus guarded informational
  disclosure and conventional ARIA tab investigation;
- collects browser diagnostics and conditional screenshot evidence;
- observes passive main-document security posture without adding active probe
  traffic;
- returns one schema-version-3 report model and writes JSON and Markdown
  reports from the CLI;
- exposes structured run events and error categories for programmatic callers.

Exploration breadth depends on the configured page and navigation budgets. It
does not attempt to enumerate every route or prove the absence of defects.

## How exploration works

A run follows this high-level sequence:

```text
Validate configuration and model requirements
    ↓
Launch Chromium and inspect the configured start page
    ↓
Collect page content, diagnostics, deterministic findings,
and passive main-document security observations
    ↓
Ask Gemini for evidence-grounded candidate findings
    ↓
Reconcile candidates with findings already known in the run
    ↓
Perform only candidate-linked, deterministically approved investigations
    ↓
Add eligible internal links to the bounded navigation frontier
    ↓
Choose another page within deterministic policy constraints, or finish
    ↓
Build the canonical schema-v3 report
```

The deterministic navigation policy considers information such as previously
visited pages, predicted page identity, route value, traversal depth, and
run-level novelty. Gemini chooses only within the eligible candidate band
provided by that policy.

The reusable run coordinator returns an in-memory report. The CLI separately
renders progress and persists report files. Programmatic execution can omit
the event observer and remain silent.

For subsystem boundaries and the source-level programmatic API, see
[Architecture](docs/ARCHITECTURE.md).

## Conservative verification

CheckQuest distinguishes an observed interaction fact from a broader semantic
claim.

For example, the regression sentinel `Equador` is an observed native-select
option. A candidate-driven interaction can select it, so the raw mechanical
interaction result can be `VERIFIED`. That does not independently prove the
semantic assertion that the text is incorrect, so the canonical finding
remains `INCONCLUSIVE` unless verification-capable evidence establishes that
claim.

Its canonical fingerprint is:

```text
target|select-option|country|equador
```

A canonical finding represents one logical issue. Occurrences record the
pages on which it appeared, and evidence records what supports, contradicts,
or remains inconclusive about the finding. Conservative fingerprinting and
reconciliation can unify occurrences across pages without forcing uncertain
claims into a verified state.

## Safety by design

“Production-safe” is a constrained design goal, not a guarantee that website
interaction can never produce side effects.

Normal browser navigation generates ordinary traffic to the target website.
CheckQuest limits that navigation to approved hosts and finite budgets. Its
passive-security layer only observes signals already produced by normal
main-document browsing; it does not add security probes.

Autonomous investigation is candidate-driven. The planner has no generic
arbitrary-click, CSS-selector, or JavaScript-execution authority. Current
actions are limited to:

- fill, clear, or blur an exactly identified supported text field;
- select an observed option from an exactly identified native `<select>`;
- perform a bounded scroll;
- set the state of an eligible informational disclosure;
- select an eligible conventional ARIA tab;
- stop exploration.

Guarded disclosure and tab actions use a stricter click-like containment
boundary. It monitors and blocks outbound requests, mutation-capable requests,
form submission, navigation, popups, downloads, and realtime activity during
the action; captures deterministic state evidence; requires rollback to the
original state; and returns a fail-closed unsafe outcome when its invariants
cannot be established.

The ordinary form-control actions are tightly targeted but do not claim the
same transactional containment or rollback guarantees. Website JavaScript may
react to browser events. Current site profiles disallow form submission, and
pages containing password fields suppress autonomous investigation.

CheckQuest is not a penetration-testing tool. Findings and safety outcomes
still require human review.

## Prerequisites

- Node.js LTS is recommended. The repository does not currently declare an
  exact minimum Node version.
- npm.
- Playwright Chromium for agent execution and browser acceptance checks.
- A user-owned Gemini API key for normal model-backed exploration.

Development has primarily taken place on Windows. Mandatory repository gates
also run on Ubuntu in GitHub Actions. This is not a claim of verified support
for every operating system.

## Quick start

### Install

```bash
git clone https://github.com/bootnihil/checkquest.git
cd checkquest
npm ci
npx playwright install chromium
```

Chromium is required for actual agent runs and browser acceptance checks. It
is not required merely for typechecking, linting, or the browser-free
deterministic aggregate.

On Linux environments that need Playwright system packages, use:

```bash
npx playwright install --with-deps chromium
```

### Configure Gemini BYOK

CheckQuest uses `GEMINI_API_KEY`. The credential belongs to the user and is
read from the invoking process environment. CheckQuest does not persist it or
include it in reports, run events, or public error messages.

`GOOGLE_API_KEY` is deliberately not accepted as an implicit fallback. The
repository also does not automatically load a `.env` file.

Set the key for the current shell session.

PowerShell:

```powershell
$env:GEMINI_API_KEY = "replace-with-your-key"
```

Windows cmd:

```bat
set GEMINI_API_KEY=replace-with-your-key
```

POSIX shell:

```sh
export GEMINI_API_KEY="replace-with-your-key"
```

Normal model-backed CLI exploration checks for this credential before
launching Chromium. Mandatory repository quality and local-browser checks do
not require a real Gemini key.

### Run a configured site

`agent:run` and `agent:explore` are aliases. With no positional target,
CheckQuest uses the configured `aidoc` profile.

```bash
npm run agent:run
```

The configured site can also be explicit:

```bash
npm run agent:run -- aidoc
```

`aidoc` is currently the only reusable configured site ID.

### Run an arbitrary URL

Supply one complete HTTP or HTTPS URL:

```bash
npm run agent:explore -- https://www.example.com/
```

An arbitrary URL creates a conservative runtime profile scoped to the exact
supplied hostname. It does not automatically allow sibling subdomains or
external hosts, and it is not equivalent to a reusable configured profile
with explicitly authored hosts and policies.

CheckQuest is designed to operate across ordinary websites, but it does not
claim that every site or custom control is supported.

### Runtime controls

| Option | Meaning | Allowed values |
|---|---|---|
| `--pages` | Maximum inspected-page budget | Integer 1–20 |
| `--navigation-steps` | Maximum navigation-decision budget | Integer 1–50 |
| `--steps-per-page` | Maximum autonomous investigation budget per page | Integer 0–10 |

Current defaults:

| Target type | Pages | Navigation decisions | Investigation steps/page |
|---|---:|---:|---:|
| Configured `aidoc` profile | 5 | 6 | 3 |
| Arbitrary runtime URL | 3 | 4 | 3 |

Example with explicit limits:

```bash
npm run agent:explore -- https://www.example.com/ --pages 5 --navigation-steps 7 --steps-per-page 3
```

Setting the investigation budget to zero keeps page analysis but disables
autonomous investigation:

```bash
npm run agent:explore -- https://www.example.com/ --steps-per-page 0
```

When `--navigation-steps` is omitted, increasing `--pages` can also raise the
profile’s navigation budget so that the requested page ceiling is reachable.
An explicit navigation budget is preserved independently.

Unknown options, duplicate options, invalid values, unknown site IDs, and
malformed runtime URLs exit with an actionable, privacy-safe `CONFIGURATION`
error.

## Reports and evidence

Successful CLI runs build one in-memory schema-version-3 report and persist:

```text
agent-results/<run-id>/report.json
agent-results/<run-id>/report.md
agent-results/<run-id>/evidence/
```

The run ID is generated from the run timestamp unless a safe identity is
provided programmatically.

- `report.json` is the detailed machine-readable execution record.
- `report.md` is the human-readable summary.
- `evidence/` contains screenshots when a page has evidence worth capturing.

Reports include canonical findings, occurrences, evidence and verification,
page-level execution detail, navigation provenance, diagnostics, and passive
security observations. The CLI owns file persistence; the reusable engine
only returns the report model.

The current contract is fail-fast with no successful partial report for a
failed exploration.

Artifacts can contain target URLs, visible site content, browser diagnostics,
model-derived observations, and screenshots. Treat the output directory
accordingly. Gemini API keys are not included.

## Local verification and CI

| Command | Purpose | Browser/network/Gemini |
|---|---|---|
| `npm run typecheck` | Strict no-emit TypeScript validation | None |
| `npm run lint` | TypeScript-aware ESLint | None |
| `npm run lint:md` | Lint authored Markdown | None |
| `npm run test:deterministic` | Browser-free deterministic aggregate; currently 27 checks | None |
| `npm run check` | Canonical browser-free quality gate: typecheck, lint, Markdown lint, deterministic checks | None |
| `npm run test:browser:ci` | Six Chromium checks using local loopback fixtures | Chromium only; no Gemini or external Aidoc |
| `npm test` / `npm run test:ui` | External Aidoc Playwright acceptance | Chromium and network; no Gemini |
| `npm run agent:api-check` | Optional real Gemini connectivity check | Gemini key and network |

Normal contributor verification is:

```bash
npm run check
npm run test:browser:ci
```

The mandatory [Repository Quality workflow](.github/workflows/quality.yml)
runs `npm run check` plus the six local Chromium checks on pushes and pull
requests. It requires no Gemini key and no external Aidoc availability.

The [External Aidoc Acceptance workflow](.github/workflows/aidoc-acceptance.yml)
is manual. External-site availability is not a normal contributor success
criterion.

## Current limitations

- Exploration is bounded and non-exhaustive.
- Autonomous action types and guarded click-like interactions are deliberately
  narrow.
- The safety model reduces risk but cannot guarantee zero side effects on
  arbitrary websites.
- Passive security is observational main-document posture analysis, not
  penetration testing or active vulnerability scanning.
- Normal CLI exploration depends on Gemini and the user’s API access.
- Only one reusable configured site profile currently ships with the
  repository.
- Failed runs do not produce a successful partial-report schema.
- CheckQuest is not yet packaged as a desktop application, hosted service, or
  standalone SDK.

## Project status

CheckQuest is in Stage 8 engineering hardening. The current focus is
documentation that accurately reflects the implemented architecture.

See the canonical [roadmap](docs/ROADMAP.md) for execution status and the
[backlog](docs/BACKLOG.md) for active, queued, and parked work.

## Tech stack

- TypeScript
- Playwright
- Gemini API
- Zod
- Node.js
- GitHub Actions

**Status:** Experimental / active development
