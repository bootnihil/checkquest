<p align="center">
  <img src="assets/branding/checkquest-banner.png" alt="CheckQuest — Explore. Check. Prove." width="100%">
</p>

# CheckQuest 🧭

[![Repository Quality](https://github.com/bootnihil/checkquest/actions/workflows/quality.yml/badge.svg)](https://github.com/bootnihil/checkquest/actions/workflows/quality.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)
![Playwright](https://img.shields.io/badge/Playwright-Chromium-brightgreen)
![Gemini](https://img.shields.io/badge/Gemini-BYOK-purple)
![Status](https://img.shields.io/badge/status-experimental-orange)

**Explore. Check. Prove.**

CheckQuest is an exploratory QA agent for websites. Give it a URL instead of a predefined test suite: it inspects the site, decides where it is worth looking next, flags suspicious issues, investigates only when it has a bounded evidence-gathering action, and produces a structured report of what it found.

> **AI decides what may be worth investigating. Deterministic code decides what the browser is actually allowed to do.**

CheckQuest is deliberately **bounded and non-exhaustive**. It is closer to an automated exploratory QA pass than a crawler, a generic browser agent, or a replacement for a full regression suite.

## ✨ What it does

Today, CheckQuest can:

- fully inspect the configured start page and explore additional internal pages within explicit budgets;
- combine deterministic checks with Gemini-based QA analysis;
- prioritize page diversity and avoid spending the whole run on near-identical routes;
- carry known findings across the run so the same issue is not investigated over and over;
- tie autonomous investigation to concrete page-local candidates rather than letting the model click freely;
- safely investigate supported form controls, disclosures, and conventional ARIA tabs;
- collect diagnostics, screenshots, finding evidence, and passive main-document security observations;
- reconcile repeated observations into canonical findings with page occurrences;
- return a schema-v3 report in JSON and Markdown;
- expose structured progress events and categorized errors for programmatic callers.

The goal is not to prove a site is defect-free. It is to spend a small inspection budget intelligently and come back with useful evidence.

## 🧠 How it works

```text
URL / site profile
        ↓
Inspect page 1
        ↓
Deterministic checks + Gemini analysis
        ↓
Identify suspicious candidates
        ↓
Investigate only when an approved action can gather evidence
        ↓
Add useful internal routes to the navigation frontier
        ↓
Inspect another page — or stop
        ↓
Unify findings + evidence
        ↓
Build the report
```

Navigation is constrained by deterministic host, budget, novelty, route-value, and visited-page policy. Gemini can help choose among eligible options; it does not get unrestricted browser authority.

For the deeper execution model, finding lifecycle, events, errors, and safety boundaries, see **[Architecture](docs/ARCHITECTURE.md)**.

### Evidence stays honest

A browser action succeeding does not automatically prove the broader QA assertion.

The project’s regression sentinel is the option text `Equador`:

```text
target|select-option|country|equador
```

CheckQuest can mechanically verify that the observed option can be selected (`VERIFIED`) while leaving the semantic claim that the text is incorrect as `INCONCLUSIVE` until verification-capable evidence actually proves it.

In other words: **mechanical success ≠ semantic proof**.

## 🛡️ Safety by design

CheckQuest is designed for cautious use against real websites, but “production-safe” is a design goal — not a promise that browser interaction can never have side effects.

Key boundaries:

- exploration is limited by page, navigation, and investigation budgets;
- autonomous actions must be linked to a concrete finding candidate;
- there is no generic arbitrary-click, CSS-selector, or JavaScript-execution authority;
- current site profiles disallow form submission;
- password-field pages suppress autonomous investigation;
- guarded disclosure/tab actions monitor risky behavior, collect deterministic evidence, require rollback, and fail closed when their safety conditions cannot be established;
- passive security uses only data produced by normal browsing and sends **no extra security probe traffic**.

CheckQuest is **not** a penetration-testing tool. Findings and safety outcomes still deserve human review.

## 🚀 Quick start

### 1. Install

Node.js LTS and npm are recommended.

```bash
git clone https://github.com/bootnihil/checkquest.git
cd checkquest
npm ci
npx playwright install chromium
```

On Linux systems that also need Playwright system dependencies:

```bash
npx playwright install --with-deps chromium
```

### 2. Add your Gemini key

CheckQuest uses **BYOK — Bring Your Own Key**.

It reads `GEMINI_API_KEY` from the current process environment. It does not persist the key or include it in reports, events, or public errors. `GOOGLE_API_KEY` is intentionally not used as an implicit fallback, and `.env` files are not loaded automatically.

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

### 3. Run it

Run the built-in `aidoc` profile:

```bash
npm run agent:run
```

Or point CheckQuest at an arbitrary HTTP/HTTPS URL:

```bash
npm run agent:explore -- https://www.example.com/
```

`agent:run` and `agent:explore` are aliases.

## 🎛️ Control the run

| Option | Meaning | Range |
|---|---|---:|
| `--pages` | Inspected-page budget | 1–20 |
| `--navigation-steps` | Navigation-decision budget | 1–50 |
| `--steps-per-page` | Investigation budget per page | 0–10 |

Example:

```bash
npm run agent:explore -- https://www.example.com/ --pages 5 --navigation-steps 7 --steps-per-page 3
```

Set `--steps-per-page 0` to analyze pages without autonomous investigation.

Current defaults are **5 / 6 / 3** for the configured `aidoc` profile and **3 / 4 / 3** for an arbitrary URL.

Arbitrary URLs use a conservative runtime profile scoped to the exact supplied hostname. For reusable profiles, host policy, `SiteConfig`, model overrides, and configuration errors, see **[Configuration](docs/CONFIGURATION.md)**.

## 📄 What you get

Successful CLI runs write:

```text
agent-results/<run-id>/report.json
agent-results/<run-id>/report.md
agent-results/<run-id>/evidence/
```

- **JSON** contains the detailed schema-v3 execution record.
- **Markdown** is the human-readable summary.
- **Evidence** contains screenshots when captured.

Reports can contain target URLs, visible page content, browser diagnostics, model-derived observations, and screenshots. Treat the output directory accordingly. Gemini API keys are not included.

The current contract is fail-fast: a failed exploration does not produce a successful partial report.

## 🧪 Development and verification

The normal local gates are:

```bash
npm run check
npm run test:browser:ci
```

`npm run check` runs typechecking, ESLint, Markdown lint, and the browser-free deterministic suite.

`npm run test:browser:ci` runs the mandatory local Chromium acceptance suite against loopback fixtures — no Gemini key and no external Aidoc dependency required.

`npm test` / `npm run test:ui` is the separate **manual external Aidoc acceptance** suite.

## ⚠️ Current boundaries

CheckQuest is still experimental.

- Exploration is bounded rather than exhaustive.
- The autonomous action vocabulary is intentionally narrow.
- Safety controls reduce risk; they cannot guarantee zero side effects on arbitrary sites.
- Passive security is observational, not active vulnerability scanning.
- Normal exploration currently depends on Gemini.
- Only one reusable configured site profile ships today.
- Failed runs do not have a partial-report schema.
- CheckQuest is not yet packaged as a desktop app, hosted service, or standalone SDK.

## 📚 Go deeper

- **[Architecture](docs/ARCHITECTURE.md)** — execution flow, `runSite`, findings, investigation, safety, events, errors, passive security, and reporting.
- **[Configuration](docs/CONFIGURATION.md)** — site profiles, arbitrary URLs, budgets, host policy, BYOK, and model settings.
- **[Roadmap](docs/ROADMAP.md)** — canonical development status.
- **[Backlog](docs/BACKLOG.md)** — active, queued, and parked work.

## 🔧 Built with

TypeScript · Playwright · Gemini API · Zod · Node.js · GitHub Actions

**Status:** Experimental / active development
