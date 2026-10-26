# CheckQuest roadmap v1 - completed

**Status:** Stages 1-10 accepted; original roadmap frozen 2026-07-23, completed 2026-07-25 (version 1.17).
**Current execution:** [Roadmap v2](ROADMAP-V2.md), G2 - Local GUI MVP, in development; acceptance open.
**Backlog:** [BACKLOG.md](BACKLOG.md).

This is the canonical planning entry point and a condensed record of the
completed engine roadmap. It delegates current stage order to Roadmap v2.
Historical results below describe acceptance at the time, not current feature
limits, test counts, schema versions, or a claim of universal production safety.
Use [Architecture](ARCHITECTURE.md) and [Public contracts](PUBLIC-CONTRACTS.md)
for current behavior. Detailed implementation narratives remain in Git history.

## Planning rules

Work in stage order. Record new ideas, non-blocking defects, refactors, and
tooling changes in the backlog rather than silently extending the current stage.
A true blocker can interrupt execution; otherwise, finish the stage before
starting the next. Roadmap changes require an explicit decision.

- **BLOCKER:** prevents the current stage from functioning correctly.
- **DEFECT:** implemented behavior is wrong; fix within the stage only when
  needed for completion, otherwise backlog it.
- **BACKLOG:** an improvement or future requirement, not immediate work.

## Completed stages

### Stage 1 - Candidate-driven investigation

**Completed:** 2026-07-23. Investigation became evidence-gathering work for
concrete candidates. Irrelevant actions are rejected and do not consume the
executed-action budget. Completion required candidate association, an explicit
evidence purpose, and regression acceptance.

### Stage 2 - Page-type diversity and run-level novelty

**Completed:** 2026-07-23. Run-wide novelty and page/template similarity began
influencing navigation, favoring unexplored application areas over repeated
near-identical routes. Completion required broader meaningful use of bounded
page budgets, not exhaustive coverage.

### Stage 3 - Known-finding context

**Completed:** 2026-07-23. Later analysis received known-finding context to
reduce redundant investigation while allowing stronger evidence for existing
findings. Acceptance included deterministic and external checks. Subsequent
canonical verification work refined the distinction between raw interaction
success and proof of a semantic claim.

### Stage 4 - Broaden the safe action vocabulary

**Completed:** 2026-07-23. Added candidate-linked informational disclosures
and conventional ARIA tabs with typed targets, exact identity matching,
containment, deterministic transition evidence, and mandatory verified rollback.
Generic clicks, planner selectors/scripts, menus, dialogs, filters, and arbitrary
widgets were not introduced. A start-page acceptance defect was corrected so
page 1 uses the authoritative inspection path and consumes the page budget.

### Stage 5 - Finding unification and static verification

**Completed:** 2026-07-24. Introduced the unified finding/evidence lifecycle,
conservative rule/model reconciliation, run-level occurrence aggregation,
explicit verification, compatibility projection, and canonical reporting.

Acceptance included the five-page Aidoc run `2026-07-24T07-02-21-200Z` and
external regression 3/3. The native `Equador` option was selectable, while the
semantic typo remained inconclusive without assertion-specific proof. It must
not trigger verified-known suppression. This remains a regression invariant.

### Stage 6 - Exploration coverage and smarter navigation

**Completed:** 2026-07-24. Added bounded frontier traversal, discovery provenance,
depth and area/route-family diversification, requested-versus-final URL
accounting, redirect alias/duplicate-final suppression, and conservative
`neutral` / `weak-low-value` / `strong-low-value` prioritization. Gemini chooses
within the deterministic best band. Low-value routes remain eligible.

Completion required bounded, auditable use of page/navigation budgets and
preservation of finding semantics. External regression passed 3/3 and bounded
five-page runs were reviewed. Exhaustive crawling, adaptive observed-yield
learning, and persisted cross-run history were not required.

### Stage 7 - Passive security and infrastructure posture

**Completed:** 2026-07-24. Added a separate passive-observation model over
already-returned main-document responses, capture-time header allowlisting and
redaction, origin aggregation, and schema-v3 JSON/Markdown reporting.

Local acceptance observed only expected browsing traffic, with no probe methods,
guessed paths, form submission, or payload injection. A five-page Aidoc run
(`2026-07-24T12-14-25-090Z`) produced three logical posture observations and
15 occurrences. CSP-header absence was not described as exploitability proof.
Functional findings and Gemini/action policy remained separate.

### Stage 8 - Engineering hardening

**Completed:** 2026-07-25. Each substage preserved bounded interaction,
assertion-specific verification, passive zero-probe behavior, credential privacy,
cleanup precedence, and fail-fast delivery.

| Substage | Accepted result |
|---|---|
| 8A - Code organization (2026-07-24) | Shared containment boundary, finding lifecycle coordinator, thin CLI, reusable run/page coordinators, pure report builder |
| 8B - Static quality (2026-07-24) | Typechecking, ESLint, Markdown lint, deterministic gate, isolated loopback-browser CI, manual-only external acceptance |
| 8C - Test depth | Reference-safe candidate/result association before mutation; CSP/Markdown escaping corrections; browser-safe fixture ports; injected Gemini-free integration and cleanup coverage |
| 8D - Errors and observability | Categorized bounded public errors, internal causes, required cleanup precedence, controlled Gemini retry policy, silent core with isolated progress observers |
| 8E - Documentation | Source-linked setup/configuration/architecture guides; 26 onboarding questions answered and 47 links/anchors checked at acceptance |
| 8F - Readiness review | No Stage 8 closeout blockers within the documented bounded source-distribution scope |

At closeout, the quality gate passed 27 deterministic checks and six local
Chromium checks. External Gemini/Aidoc connectivity was not mandatory. Earlier
network-blocked acceptance was not claimed as successful. These historical
counts are not today's validation inventory.

Readiness did not require Docker, technology expansion, coverage-percentage
scores, test-framework migration, generic plugin infrastructure, remote telemetry,
partial/atomic reports, installers, or active security expansion.

### Stage 9 - Productization boundary

**Completed:** 2026-07-25. Formalized presentation-agnostic and deployment-agnostic
execution: configuration, progress, findings, evidence, reporting, and execution
retain explicit boundaries. The CLI adapts environment credentials into an
explicit per-run key; reusable execution does not read a global user key.

Acceptance verified isolated run credentials, no process-environment mutation,
Gemini-free injected execution, and no key sentinel in public output. Gates
passed 28 deterministic and six local-browser checks. The source API was not
promoted to a published SDK; credential persistence and provider abstraction
were not added.

### Stage 10 - Source distribution and public release contracts

**Completed:** 2026-07-25.

| Substage | Accepted result |
|---|---|
| 10A | Fresh-clone lockfile installation, Node/npm requirements, Chromium setup, actionable setup failures, clean-install rehearsals |
| 10B | CLI/configuration and exit contracts, report compatibility, opaque run IDs, human-only Markdown layout, package version corrected to `0.1.0` |
| 10C | Guided demo, public presentation, intentionally `UNLICENSED` metadata without an invented license grant |

Final acceptance passed 28 deterministic and six local Chromium checks. A
bounded real BYOK run produced JSON and Markdown with no supplied key serialized.
The then-current report schema was 3; new reports now use v4 as documented in
[Public contracts](PUBLIC-CONTRACTS.md#json-report-compatibility).

The accepted readiness answer was limited to initial-development,
source-distributed, BYOK, bounded exploratory QA. It did not establish universal
safety, exhaustive detection, or packaged-product readiness. Stage 10 did not
include a desktop app or SaaS; later GUI work belongs to Roadmap v2.

## Stage completion protocol

A stage is not complete merely because its code exists. Before advancing:

1. Confirm completion criteria.
2. Run relevant automated tests and a representative real-site execution when
   appropriate and authorized.
3. Review findings/evidence for regressions.
4. Update the backlog and current roadmap stage.
5. Commit the completed milestone when explicitly authorized.

Do not silently reopen v1 or reorder v2. Current acceptance gates and future
product decisions are maintained in [Roadmap v2](ROADMAP-V2.md).
