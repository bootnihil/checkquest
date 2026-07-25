# CheckQuest Roadmap v2 — Local GUI / Product Shell

**Status:** Planned  
**Current stage:** G1 — GUI/core boundary  
**Roadmap v1:** Complete (Stages 1–10)

## Goal

Turn the completed CheckQuest engine into something a normal QA user can run and understand without Git, npm, Node.js, or command-line knowledge.

Roadmap v2 is primarily a **product-shell roadmap**, not a new engine roadmap. Existing finding, safety, navigation, BYOK, investigation, and report semantics remain authoritative unless a stage explicitly requires a compatible interface change.

## Guiding principles

- Keep the core engine presentation-agnostic.
- Keep Gemini credentials user-owned and ephemeral by default.
- Reuse the existing `runSite(...)`, event, error, and report boundaries.
- Prefer a thin local product before committing to SaaS infrastructure.
- Do not add new QA intelligence merely because a GUI exists.
- Let external user feedback determine the roadmap after G7.

## Stages

### G1 — GUI/core boundary

Confirm that the GUI can configure and invoke CheckQuest through the existing reusable execution boundary without UI-specific logic leaking into the engine.

**Done when:** URL, budgets, transient Gemini credentials, progress, completion/failure, cancellation, and report location can be handled through a clean boundary.

### G2 — Local GUI MVP

Build the smallest useful local interface.

**MVP:** URL, page/navigation/investigation budgets, Gemini key, optional model override, Run, Cancel, and basic status.

No accounts, database, cloud execution, or SaaS features.

### G3 — Live run experience

Render structured engine events as understandable progress.

**Done when:** users can see what CheckQuest is doing, cancellation cleans up safely, secrets never enter UI events, and UI/observer failures cannot corrupt the run.

### G4 — Findings and report viewer

Present completed findings in a useful human interface.

**Done when:** users can review severity, verification state, affected pages, evidence, investigation outcome, and open the JSON/Markdown report or report folder.

### G5 — Saved local configurations

Allow reusable local run configurations for frequently tested sites.

Named profiles become an optional user convenience, not a prerequisite for arbitrary URLs.

Gemini keys remain ephemeral by default; persistent secrets require proper OS-level secure storage before being offered.

### G6 — Windows packaging

Package the local application so a user does not need Git, Node.js, npm, or manual browser setup.

**Target:** install → launch → configure → run.

Packaging technology is chosen here, after the local GUI architecture is proven.

### G7 — External usability acceptance

Give the packaged application to people who have not participated in development.

Acceptance asks whether they can independently:

1. install CheckQuest;
2. understand its purpose and safety boundary;
3. configure a site and BYOK key;
4. run a scan;
5. understand progress and failures;
6. interpret findings and verification state; and
7. locate/use the generated report.

Any required “you also need to know…” explanation is treated as product friction.

## Product validation gate

Roadmap v2 stops after G7.

External usage then determines whether the next roadmap should prioritize items such as:

- SaaS / scheduled monitoring and run history;
- authenticated application exploration;
- finding-to-Playwright regression-test generation;
- additional model providers;
- partial-run reporting;
- CI/release integrations; or
- other needs repeatedly demonstrated by real users.

These are **not committed Roadmap v2 requirements**.

## Explicitly out of scope for Roadmap v2

- SaaS accounts, teams, billing, or cloud browser workers;
- scheduled scans or notifications;
- arbitrary browser-action expansion;
- new passive-security scope;
- authenticated workflows;
- multi-model/provider support;
- generated regression tests;
- automatic updates;
- browser extensions; and
- changes to schema-v3 semantics merely for GUI convenience.

The purpose of Roadmap v2 is simple:

> **Expose the CheckQuest we already built to humans, then learn what deserves to be built next.**
