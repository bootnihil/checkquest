# CheckQuest Roadmap v2 — Public Landing + Local GUI / Product Shell

**Status:** In progress
**Current stage:** G2 — Local GUI MVP
**Roadmap v1:** Complete (Stages 1–10)
**Roadmap v2 started:** 2026-07-26

## Goal

Turn the completed CheckQuest engine into something a normal QA user can discover, understand, run, and use without Git, npm, Node.js, or command-line knowledge.

Roadmap v2 is primarily a **product-shell roadmap**, not a new engine roadmap. It begins with a small public-facing product surface, then moves into the local GUI. Existing finding, safety, navigation, BYOK, investigation, and report semantics remain authoritative unless a stage explicitly requires a compatible interface change.

## Guiding principles

- Keep the core engine presentation-agnostic.
- Keep Gemini credentials user-owned and ephemeral by default.
- Reuse the existing `runSite(...)`, event, error, and report boundaries.
- Preserve the existing narrow AI collaborator seams; product-shell work must not introduce unnecessary direct Gemini coupling into presentation or orchestration layers.
- Prefer a thin local product before committing to SaaS infrastructure.
- Keep the public landing page static, honest, and clearly separate from hosted CheckQuest execution.
- Do not add new QA intelligence merely because a GUI or landing page exists.
- Let external user feedback and measured product friction determine the roadmap after G7.

## Stages

### G0 — Public landing & brand presence

**Completed:** 2026-07-26

Create a small public front door for CheckQuest before the local application shell.

The landing page is a **product/marketing surface**, not the CheckQuest GUI and not a hosted execution environment.

**Scope:**

- publish a responsive GitHub Pages landing page;
- use the current CheckQuest visual identity and **Explore. Investigate. Report.** slogan;
- explain, concisely and accurately, what CheckQuest is, what it is not, who it is for, and why someone should consider it;
- communicate the core workflow: explore a deployed website, investigate potential issues safely, and produce evidence-backed findings/reports;
- include links to the GitHub repository and relevant documentation;
- add representative product visuals or examples only when they reflect real CheckQuest behavior;
- keep the site static and dependency-light.

No accounts, backend, cloud browser execution, billing, hosted scans, or SaaS infrastructure are introduced here.

**Done when:** a public GitHub Pages site is deployed, works well on desktop and mobile, communicates the product in a few seconds without overstating its capabilities, and routes users cleanly to the repository/documentation.

G0 is intentionally bounded. It establishes CheckQuest's public identity without becoming a detour from the local product shell.

### G1 — GUI/core boundary

**Completed:** 2026-07-26

Confirm that the GUI can configure and invoke CheckQuest through the existing reusable execution boundary without UI-specific logic leaking into the engine.

The product shell may expose today's Gemini-backed capability, but it must preserve the existing narrow collaborator boundaries rather than embedding provider-specific behavior into GUI or application-shell logic.

**Done when:** URL, budgets, transient Gemini credentials, progress, completion/failure, cancellation, and report location can be handled through a clean boundary; the GUI does not bypass the existing engine contracts or introduce unnecessary new direct Gemini coupling.

G1 delivered the presentation-agnostic `startCheckQuest(...)` application
boundary. A product shell can now supply an arbitrary HTTP/HTTPS URL or an
existing site configuration, page/navigation/investigation budgets, transient
per-run Gemini credentials, and an optional per-run model override. It can
observe structured run events, receive categorized failures, cancel
programmatically, and receive the schema-v3 report plus absolute paths for the
report directory and persisted JSON and Markdown artifacts.

Cancellation is explicit and idempotent before execution starts, during
execution or persistence, and after completion. The engine stops further useful
work at safe boundaries, does not interrupt mandatory guarded-action rollback,
and closes Playwright/browser resources through required cleanup on success,
ordinary failure, and cancellation. A cancellation cannot race into an
apparent successful completion, and cleanup failure remains secondary to the
primary run failure or cancellation.

The application boundary now sanitizes its public outputs: raw nested error
causes do not cross the boundary, and the transient Gemini credential is
redacted from serialized event metadata, returned errors and results, report
content, and persisted report files. Per-run model overrides do not mutate
process-global state.

The CLI is now a thin consumer of `startCheckQuest(...)`. It owns argument and
environment adaptation, terminal event rendering, signal handling, and final
console output while shared application code owns execution, cancellation, and
report persistence.

G1 acceptance verification passed:

- `npm run check` — PASS, including 29/29 deterministic checks;
- `npm run test:browser:ci` — PASS, 7/7;
- `npm run agent:application-run-browser-check` — PASS;
- `npm test` — PASS, 3/3 when network permission was available; the earlier
  sandbox network denial occurred before assertions and was environmental; and
- `git diff --check` — PASS.

The following remain non-blocking future work rather than G1 requirements:

- cancellation during an active filesystem write remains cooperative, and no
  partial-report contract is required;
- packaged-app user-data and report-storage location selection remains product
  shell/packaging work; and
- forced injection of a real Chromium `browser.close()` failure is not required
  for G1; cleanup precedence is covered deterministically and real browser
  connection cleanup is covered by integration checks.

### G2 — Local GUI MVP

**Status:** Implemented; acceptance and remediation remain in progress.

Build the smallest useful local interface.

**MVP:** URL, page/navigation/investigation budgets, transient Gemini key, Run,
Cancel, and basic status. The reusable application/CLI boundaries retain an
optional per-run model override, but the current desktop MVP intentionally does
not expose a model selector.

No accounts, database, cloud execution, or SaaS features.

The Electron GUI MVP is implemented. Real-run acceptance then exposed a
trustworthiness problem below the GUI layer: the human report could split one
logical defect into multiple findings when model-generated wording drifted,
make visual-sounding claims without focused visual evidence, and present
finding/occurrence/count information in ways that were difficult to reconcile.

That acceptance blocker has been remediated without weakening the existing
`VERIFIED` / `INCONCLUSIVE` boundary:

- finding reconciliation now uses validated structured evidence identity rather
  than generated title/description prose, while observations without trustworthy
  structured identity remain separate rather than being guessed together;
- repeated occurrences retain one canonical logical finding and occurrence
  history, with explicit under-merge and over-merge regression coverage;
- visual claims require appropriate focused visual evidence, while
  accessibility, network, technical, and security observations use evidence
  suited to the claim;
- generic visited-page screenshots are no longer treated as finding evidence;
  replay of transient UI state remains bounded by the existing safe-interaction
  policy;
- GUI and report completion counts derive from one reconciled summary source and
  distinguish confirmed findings, review findings, and technical observations;
- the human report now uses run-scoped item IDs, a complete primary index,
  page-to-item links, correlated evidence filenames, clearer item boundaries,
  and proportionate security detail; and
- verification thresholds and canonical finding semantics were not relaxed to
  make the report appear more decisive.

The report remediation is an acceptance fix discovered through G2, not a new
roadmap stage and not an early start on G4's dedicated in-app report viewer.

**G2 remains open pending:**

- a fresh real model-backed run to verify reconciliation, focused evidence,
  report accounting/navigation, and practical report usefulness end to end; and
- follow-up on the Electron desktop smoke-process crash observed during the
  remediation pass, despite the deterministic desktop suite, desktop build, and
  constituent browser checks otherwise passing.

**G2 is complete when:** the MVP can complete a representative real run with
trustworthy reconciled output and consistent final accounting, and no known
G2-blocking desktop runtime issue remains.

### G3 — Live run experience

Render structured engine events as understandable progress.

**Done when:** users can see what CheckQuest is doing, cancellation cleans up safely, secrets never enter UI events, and UI/observer failures cannot corrupt the run.

### G4 — Findings and report viewer

Present completed findings in a useful human interface.

The viewer should make CheckQuest's evidence model visible rather than reducing a finding to a generic pass/fail label.

**Done when:**

- users can review severity, verification state, affected pages, evidence, and investigation outcome;
- users can open the JSON/Markdown report or report folder; and
- at least one representative real CheckQuest run can be captured as a reusable product-proof artefact showing the path from suspicious observation through investigation to verification state and supporting evidence.

The representative artefact may later be reused in the public landing page, README, documentation, screenshots, or a short demo. It must reflect real CheckQuest behavior rather than a mocked product experience.

### G5 — Saved local configurations

Allow reusable local run configurations for frequently tested sites.

Named profiles become an optional user convenience, not a prerequisite for arbitrary URLs.

Gemini keys remain ephemeral by default; persistent secrets require proper OS-level secure storage before being offered.

### G6 — Windows packaging

Package the local application so a user does not need Git, Node.js, npm, or manual browser setup.

**Target:** install → launch → configure → run.

Packaging technology is chosen here, after the local GUI architecture is proven.

### G7 — External usability and product acceptance

Give the packaged application to people who have not participated in development and perform a bounded credibility/evaluation pass before deciding what CheckQuest becomes next.

#### External usability acceptance

Acceptance asks whether new users can independently:

1. install CheckQuest;
2. understand its purpose and safety boundary;
3. configure a site and BYOK key;
4. run a scan;
5. understand progress and failures;
6. interpret findings and verification state; and
7. locate/use the generated report.

Any required “you also need to know…” explanation is treated as product friction.

#### Controlled evaluation fixture

Maintain a small deterministic local site/fixture containing deliberately seeded cases that exercise CheckQuest's core claims without pretending exploratory QA has a complete bug denominator.

The fixture should include representative examples such as:

- defects that CheckQuest is expected to detect;
- safe lookalikes that should not become findings;
- repeated occurrences that should reconcile correctly;
- cases whose evidence should remain `INCONCLUSIVE`;
- candidate-linked interactions that can gather meaningful evidence; and
- interactions or states that CheckQuest should refuse or back away from because of its safety boundary.

The evaluation should record, at minimum:

- expected seeded findings detected or missed;
- obvious false-positive behavior;
- correctness of `VERIFIED` versus `INCONCLUSIVE` handling;
- occurrence reconciliation/deduplication behavior;
- safety-boundary refusals; and
- material run-to-run instability on the controlled fixture.

This is a repeatable credibility check, not a claim that CheckQuest can achieve a universal accuracy, recall, or defect-detection percentage on arbitrary websites.

#### Model-dependency assessment

During G7, record whether the current Gemini dependency creates meaningful product friction through availability, latency, rate limits, cost, provider behavior changes, or material run-to-run variability.

Roadmap v2 does **not** require another provider. The purpose of this assessment is to determine whether provider abstraction deserves promotion from the parking lot based on observed user/deployment need rather than architectural fashion.

**G7 is complete when:** external users can perform the core workflow with acceptable product friction, the controlled evaluation fixture has been exercised and reviewed, and the observed model-dependency/repeatability risks are documented well enough to inform the next roadmap.

## Product validation gate

Roadmap v2 stops after G7.

Before defining Roadmap v3, make explicit product decisions based on external usage and the G7 evidence.

### Product-direction decision

Determine which problems real users actually want CheckQuest to solve next. Candidates may include:

- SaaS / scheduled monitoring and run history;
- authenticated application exploration;
- finding-to-Playwright regression-test generation;
- additional model providers;
- partial-run reporting;
- CI/release integrations; or
- other needs repeatedly demonstrated by real users.

These are **not committed Roadmap v2 requirements**.

### Distribution and licensing decision

Explicitly decide the intended distribution/commercial model before broad adoption is encouraged.

Possible outcomes include remaining source-visible/proprietary, adopting an open-source license, using an open-core model, or another deliberate commercial/distribution approach.

The public repository must not be treated as implying an open-source commitment. The decision should follow product validation rather than precede it.

## Explicitly out of scope for Roadmap v2

- SaaS accounts, teams, billing, or cloud browser workers;
- hosted CheckQuest execution from the public landing page;
- scheduled scans or notifications;
- arbitrary browser-action expansion;
- new passive-security scope;
- authenticated workflows;
- multi-model/provider support;
- generated regression tests;
- automatic updates;
- browser extensions;
- universal accuracy/recall claims for exploratory testing; and
- changes to schema-v3 semantics merely for GUI convenience.

The purpose of Roadmap v2 is simple:

> **Give CheckQuest a clear public front door, expose the CheckQuest we already built to humans, prove its core behavior in a bounded and honest way, then learn what deserves to be built next.**
