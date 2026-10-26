<p align="center">
  <img src="assets/branding/checkquest-banner.png" alt="CheckQuest — Explore. Investigate. Report." width="100%">
</p>

# CheckQuest 🧭

[![Repository Quality](https://github.com/bootnihil/checkquest/actions/workflows/quality.yml/badge.svg)](https://github.com/bootnihil/checkquest/actions/workflows/quality.yml)
![Gemini](https://img.shields.io/badge/Gemini-BYOK-purple)
![Status](https://img.shields.io/badge/status-experimental-orange)

**Explore. Investigate. Report.**

Scripted tests check the journeys you already know matter. CheckQuest explores
for potential problems you did not explicitly write a test for.

Give it an HTTP(S) URL you are authorized to test. It inspects a bounded sample
of pages, follows promising internal routes, and investigates suspicious signals
when a permitted action can gather useful evidence. You get findings and the
observations behind them, ready for human review. No predefined test suite or
site-specific profile is required.

CheckQuest is an experimental exploratory QA tool, available through a CLI and
a local Electron desktop interface. It belongs alongside scripted regression
and manual testing: use repeatable tests for known requirements, then give
exploration room to surface questions your scripts do not ask. It does not
crawl a whole site, prove it defect-free, or perform penetration testing.

## ✨ What it does

1. Inspects the start page, including content, browser diagnostics, and basic
   deterministic checks.
2. Uses Gemini to propose potential issues and help choose eligible internal
   pages. Deterministic policy controls navigation and browser actions.
3. Investigates candidates when a permitted action can gather evidence, within
   separate page, navigation, and per-page investigation budgets.
4. Reconciles findings and occurrences, derives verification from evidence,
   and writes JSON and Markdown reports with focused screenshots when available.

**The model proposes. Evidence decides what can be verified.**

Gemini helps identify what may be worth investigating; deterministic code
controls what the browser may do and how evidence supports a finding. A model
can suggest that something looks wrong. It cannot make the finding true by
saying so.

A successful interaction does not necessarily prove the broader claim. Selecting
a misspelled option proves it is selectable, not that its wording is incorrect.
CheckQuest keeps those facts separate. Findings can remain inconclusive and
require human review; that uncertainty is part of the result.

Passive security observations describe returned document headers and transport;
they are separate from functional findings and are not vulnerability proof.
The aim is a useful inspection with an honest evidence trail, not a reassuring
pass/fail label for the entire site.

## Install from source

Requirements: Git, Node.js **22.13.0+**, npm **10+**, and network access for
installation, the target website, and Gemini. Normal exploration requires your
own Gemini API key and may incur provider charges.

```sh
git clone https://github.com/bootnihil/checkquest.git
cd checkquest
npm ci
npm run setup:browser
```

On Linux, use `npm run setup:browser:with-deps` if Chromium needs system packages.
Source installation is the supported distribution; there is no packaged desktop
installer or published npm package.

## 🎯 Run from the CLI

Set the key in the shell that will start CheckQuest:

```powershell
$env:GEMINI_API_KEY = "replace-with-your-key"
```

For a POSIX shell, use `export GEMINI_API_KEY="replace-with-your-key"`;
for Windows cmd, use `set GEMINI_API_KEY=replace-with-your-key`.
CheckQuest does not load `.env` files or use `GOOGLE_API_KEY` as a fallback.

Start with one page and investigation disabled:

```sh
npm start -- https://www.example.com/ --pages 1 --navigation-steps 1 --steps-per-page 0
```

The [guided demo](docs/DEMO.md) walks through this small first run and its output.
This still uses Gemini for page analysis. Replace the URL with an authorized
target. `agent:run` and `agent:explore` are aliases for the same CLI;
omitting the target selects the built-in `aidoc` reference profile.

| Option | Scope | Range | Raw-URL default |
|---|---|---:|---:|
| `--pages` | Inspected pages, including the start page | 1-20 | 3 |
| `--navigation-steps` | Navigation decisions across the run | 1-50 | 4 |
| `--steps-per-page` | Investigation planner decisions per page | 0-10 | 3 |

Budgets are ceilings, not promised work counts. If navigation steps are omitted,
the effective ceiling is the greater of the profile default and page budget.
The `aidoc` defaults are 5 / 6 / 3. See [Configuration](docs/CONFIGURATION.md)
for host policy, model overrides, and programmatic inputs. The current Gemini
default is `gemini-3.5-flash-lite`; `GEMINI_MODEL` can override it for CLI runs.

## Run the desktop interface

After installation:

```sh
npm run desktop:start
```

Enter a target, budgets, and Gemini key, then choose Run. Cancel stops the run
cooperatively. The interface accepts bare domains, validates a newly supplied
key, and checks website reachability before exploration. Accepted keys remain
in main-process session memory for reuse until replacement or application exit;
CheckQuest does not write them to disk. The desktop investigation minimum is
**1**; use the CLI for zero-investigation runs. There is no desktop model selector.

The desktop MVP exists, but G2 acceptance remains open. A dedicated in-app report
viewer and Windows packaging are later roadmap stages.

## 📄 What you get

Successful CLI and desktop runs write under the working directory:

```text
agent-results/<run-id>/report.json
agent-results/<run-id>/report.md
agent-results/<run-id>/evidence/   (when screenshots are captured)
```

Open Markdown for review; use JSON for automation. New reports use schema **4**,
including persisted narratives for applicable exploratory findings. Historical
schema-v3 reports remain supported without migration. Screenshots are focused
evidence, not a guaranteed image of every page.

CLI exit `0` means exploration, cleanup, and both report writes succeeded.
Exit `1` means failure or cancellation. Writes are not transactional: files or
screenshots may remain after failure, but there is no successful partial-report
contract. Report compatibility is defined in [Public contracts](docs/PUBLIC-CONTRACTS.md).

## 🛡️ Safety and limitations

- Only test authorized targets. Ordinary page loads execute site JavaScript and
  can contact external resources; the hostname allowlist is not network isolation.
- There is no arbitrary click, selector, script, login, or form-submit authority.
  Supported control interactions remain narrow and candidate-linked.
- Visible password fields suppress autonomous investigation. Guarded disclosure,
  tab, and native-select actions use containment; unsafe states can abort the run.
- Safety controls reduce risk but cannot guarantee zero side effects on arbitrary
  websites. See [Browser safety](docs/ARCHITECTURE.md#browser-safety) for exact limits.
- Gemini receives bounded page observations. Reports and screenshots may contain
  sensitive site content and URLs. API keys are excluded; handle artifacts carefully.
- Coverage and model output vary. Neither a successful run nor an inconclusive
  finding establishes overall site quality or production readiness.

## Development and verification

```sh
npm run check
npm run test:browser:ci
```

`check` runs formatting, typechecking, ESLint, Markdown lint, and 41 browser-free
deterministic checks. The local Chromium gate uses loopback fixtures and no
Gemini key. `npm test` / `npm run test:ui` is the separate external Aidoc
regression suite. `npm run desktop:check` checks desktop contracts;
`npm run desktop:build` builds the source desktop shell.

## 📚 Documentation

| Document | Use it for |
|---|---|
| [Guided demo](docs/DEMO.md) | A minimal first run and report checks |
| [Configuration](docs/CONFIGURATION.md) | CLI, desktop, budgets, hosts, and credentials |
| [Architecture](docs/ARCHITECTURE.md) | Execution, lifecycle, safety, evidence, and failure behavior |
| [Public contracts](docs/PUBLIC-CONTRACTS.md) | Compatibility and machine-consumer requirements |
| [Roadmap](docs/ROADMAP.md) | Planning entry point and completed engine milestones |
| [Roadmap v2](docs/ROADMAP-V2.md) | Current G2 acceptance and later product stages |
| [Backlog](docs/BACKLOG.md) | Outstanding, parked, and completed work |

## ⚖️ Licensing

The repository is source-visible, with package metadata marked `UNLICENSED`.
It does not grant an open-source license. Distribution and licensing decisions
remain part of the product-validation gate.
