# CheckQuest Roadmap

**Roadmap version:** 1.0  
**Frozen on:** 2026-07-23  
**Current stage:** Stage 7 — Passive security and infrastructure posture

## How this roadmap is used

This is the canonical execution order for CheckQuest.

New ideas, defects, refactors, tooling changes, and product ideas do **not** automatically change the roadmap. They are recorded in `BACKLOG.md` first.

The roadmap order changes only when we explicitly decide that:

1. a newly discovered issue is a true blocker for the current stage; or
2. the roadmap itself should be revised deliberately.

Otherwise:

> Finish the current stage → test it → commit it → move to the next stage.

### Work classification

- **BLOCKER** — prevents the current stage from functioning correctly. Fix immediately.
- **DEFECT** — implemented behavior is wrong. Fix during the current stage if required for completion; otherwise backlog it.
- **BACKLOG** — improvement, feature, refactor, tooling change, architectural idea, or future product work. Record it and keep going.

---

# Stage 1 — Candidate-driven investigation

**Completed:** 2026-07-23

## Goal

Autonomous investigation actions must directly gather evidence for an actual candidate finding.

CheckQuest should not interact with a page merely because an element is available or interesting.

## Completion criteria

- Investigation actions are tied to candidate findings.
- Each investigation action has a clear evidence-gathering purpose.
- Irrelevant exploration does not consume the investigation budget.
- Existing behavior and regression tests still pass.

---

# Stage 2 — Page-type diversity and run-level novelty

**Completed:** 2026-07-23

## Goal

Avoid spending limited page budgets on near-identical pages or templates.

Examples include repeatedly inspecting similar blog posts, article pages, or other pages that provide little new functional coverage.

## Completion criteria

- Novelty is tracked across the entire run.
- Page/template similarity influences exploration decisions.
- Unexplored page types and application areas are preferred.
- Limited page budgets result in broader meaningful coverage.

---

# Stage 3 — Known-finding context

**Completed:** 2026-07-23

## Goal

Later analysis in the same run should know what has already been discovered.

Gemini should prioritize new defects instead of repeatedly rediscovering the same issue, while still being able to strengthen an existing finding with useful additional evidence.

## Completion criteria

- Findings discovered earlier in the run are available to later analysis.
- Duplicate rediscovery is substantially reduced.
- Candidate generation prioritizes new issues.
- Existing findings can still be strengthened when new evidence adds value.

---

# Stage 4 — Broaden the safe action vocabulary

**Completed:** 2026-07-23

## Goal

Give CheckQuest more ways to investigate a website without violating the production-safe, non-destructive operating model.

Stage 4 delivered two explicit candidate-driven interaction types:

- guarded informational disclosure state investigation;
- guarded conventional ARIA tab selection and panel investigation.

Both actions require exact structured evidence targets and deterministic candidate/action identity matching. Browser execution runs inside a fail-closed containment boundary with zero-new-request enforcement, navigation/form/popup/download/realtime/service-worker protection, deterministic transition evidence, and mandatory verified rollback.

Successful guarded investigations can produce explicit deterministic verification outcomes and participate in run-local known-finding suppression.

Stage 4 did **not** introduce generic click capability, planner-controlled selectors or JavaScript, or support for menus, dialogs, filters, dropdown widgets, arbitrary navigation, or other interaction types.

## Completion criteria

- New actions are typed and validated.
- Action safety constraints are explicit.
- The expanded vocabulary remains production-safe.
- The smarter investigation behavior from Stages 1–3 governs when those actions are used.

---

# Stage 5 — Finding unification and static verification

**Completed:** 2026-07-24

Stages 5.1–5.3 provide the unified finding/evidence model, conservative
rule/model reconciliation, run-level occurrence aggregation, explicit derived
verification, Stage 3 compatibility projection, and canonical JSON/Markdown
reporting.

Final acceptance included the external Playwright regression suite passing 3/3
and the five-page Aidoc run `2026-07-24T07-02-21-200Z`. Canonical JSON and
Markdown agreed across all findings and occurrences. The acceptance run
validated the assertion-specific verification boundary: raw interaction
evidence showed that the `Equador` option was selectable, while the semantic
typo finding correctly remained inconclusive without a trusted explicit
assessment. Later known occurrences were recognized without incorrectly
triggering verified-finding suppression.

## Goal

Combine browser observations, Gemini reasoning, evidence, and deterministic/static checks into one coherent finding model.

CheckQuest should distinguish between something it suspects and something it has actually demonstrated.

Stage 4 established target-specific deterministic outcomes for guarded disclosure and tab investigations. Stage 5 builds on that foundation by unifying model-generated findings, browser observations, deterministic interaction evidence, and future static checks in one coherent finding representation.

## Completion criteria

- Findings use a unified representation.
- Evidence sources can be combined without producing duplicate findings.
- Deterministic evidence can confirm or contradict model-generated observations.
- Verification state is explicit, for example:
  - Verified
  - Not Verified
  - Inconclusive
- Findings have a clear evidence trail.

---

# Stage 6 — Exploration coverage and smarter navigation

**Completed:** 2026-07-24

Stage 6.1 added traversal-depth and discovery-provenance tracking, a bounded
run-level frontier, deterministic breadth/depth and page-budget strategy,
area-level diversification above Stage 2 novelty, requested/attempted versus
inspected-final URL accounting, redirect-alias and duplicate-final suppression,
final-URL-based novelty accounting, and additive navigation auditability.

Stage 6.2 added deterministic `neutral`, `weak-low-value`, and
`strong-low-value` route classification using conservative pagination and exact
route-role signals. Weak and strong routes receive distinct priority treatment
but remain eligible, and Gemini chooses only within the deterministic best
policy band. Adaptive dead-end or observed-yield learning was not introduced.

Acceptance included the external Playwright regression suite passing 3/3 and
bounded five-page Aidoc runs `2026-07-24T09-49-24-953Z` (`/`, `/solutions/`,
`/platform/`, `/healthcare-ai/`, `/strategy/`) and
`2026-07-24T10-37-15-126Z` (`/`, `/solutions/`, `/platform/`,
`/healthcare-ai/`, `/learn/`). Stage 5 canonical finding and verification
semantics were preserved: the four-occurrence `Equador` logical finding
remained inconclusive with no verification-capable evidence despite raw
select-option investigation results. The compatibility page-number projection
defect found during Stage 6.1 acceptance was corrected and verified in the
Stage 6.2 report.

## Goal

Improve where CheckQuest goes after the investigation engine itself is mature.

## Scope

- Build on the guaranteed page-1 inspection of the configured start URL.
- Smarter selection of meaningful application areas.
- Navigation-depth and page-budget strategy.
- Avoidance of dead ends and low-value routes.
- Better prioritization of routes likely to expose new functionality.

Stage 6 establishes bounded, run-local navigation over conservatively
discovered visible navigation links using deterministic novelty and route-value
prioritization. Its completed scope does not require exhaustive or body-wide
crawling, adaptive yield learning, semantic page-value authority, or persisted
cross-run exploration history.

## Completion criteria

- Navigation decisions improve meaningful coverage.
- Page budgets are spent on functionally useful areas.
- Coverage behavior remains bounded and predictable.

---

# Stage 7 — Passive security and infrastructure posture

## Goal

Add a separate passive security/infrastructure observation layer without turning CheckQuest into a penetration-testing tool.

This layer may observe safely discoverable signals from normal browsing and configuration, but should not attempt exploitation.

## Architectural principle

Functional/UX exploration and passive security/infrastructure posture remain separate concerns that can contribute to the same final report.

## Completion criteria

- Passive checks are clearly separated from functional investigation.
- No exploitative or destructive behavior is introduced.
- Security observations carry appropriate evidence and confidence.

---

# Stage 8 — Engineering hardening

This stage intentionally incorporates the legitimate takeaways from the 2026-07-23 DevAnalyzer review without chasing arbitrary analyzer scores.

## 8A — Code organization

- Review oversized files and blurred responsibilities.
- Split components only where doing so improves maintainability or clarity.
- Preserve clean boundaries between reusable engine logic and presentation/transport layers.

## 8B — Static quality

- Add or strengthen ESLint.
- Keep TypeScript checking explicit.
- Add useful formatting/static-quality gates.
- Enforce appropriate checks in CI.

## 8C — Test depth

Expand beyond browser-level testing with focused unit/integration coverage for areas such as:

- candidate handling;
- schemas and validation;
- finding deduplication/unification;
- novelty logic;
- run context;
- agent decision logic;
- deterministic verification.

## 8D — Error handling and observability

Review and strengthen:

- failures;
- retries;
- malformed model responses;
- browser failures;
- configuration errors;
- logging;
- progress events.

## 8E — Documentation

Bring documentation up to the architecture that actually exists.

Cover:

- setup;
- running CheckQuest;
- configuration;
- architecture overview;
- Gemini/BYOK behavior;
- safety model;
- findings and evidence;
- reporting.

## 8F — Production-readiness and CI review

Perform a deliberate repository-wide readiness pass.

### Explicit non-goals

Do **not** add the following merely to satisfy an automated analyzer:

- Docker/containerization without an actual deployment need;
- a ceremonial build step without a packaging/runtime need;
- additional technologies merely to increase stack breadth.

---

# Stage 9 — Productization boundary

## Goal

Formalize the separation between the reusable CheckQuest core and the interfaces through which users may eventually consume it.

The architecture must remain presentation-agnostic and deployment-agnostic.

Potential front ends include:

- CLI;
- Windows/Desktop UI;
- Web/SaaS.

## Core boundaries to preserve

- run configuration;
- execution engine;
- progress/events;
- findings;
- evidence;
- reports;
- UI/transport separation;
- Gemini BYOK handling.

## Completion criteria

- Core execution does not depend on a specific UI.
- User-supplied Gemini credentials remain isolated from application-owned credentials and are never logged.
- Local desktop and hosted execution remain architecturally possible.

---

# Stage 10 — Release-quality CheckQuest

## Goal

Reach the point where CheckQuest can be confidently placed in front of users outside the development process.

## Scope

- polished CLI/user experience;
- installation/distribution;
- stable configuration;
- versioning;
- reliable reports;
- clean failure behavior;
- example/demo configuration;
- public repository presentation;
- final documentation;
- repeatable CI.

## Final readiness question

> Would we be comfortable putting this version in front of strangers?

---

# Stage completion protocol

A stage is not complete merely because its main code exists.

Before moving to the next stage:

1. Confirm the stage completion criteria.
2. Run the relevant automated tests.
3. Run a representative real-site CheckQuest execution where appropriate.
4. Review generated evidence/findings for regressions.
5. Update `BACKLOG.md`.
6. Update this file's **Current stage** field.
7. Commit the completed stage as a meaningful repository milestone.

---

# Roadmap change log

| Date | Version | Change |
|---|---|---|
| 2026-07-24 | 1.0 | Stage 6 completed bounded, auditable breadth/depth navigation and conservative deterministic route-value prioritization, with successful deterministic, browser, Playwright, and five-page Aidoc acceptance. Completed CQ-013 through CQ-015 and advanced the current stage to Stage 7. |
| 2026-07-24 | 1.0 | Stage 5 added the canonical unified finding lifecycle, explicit occurrence and logical verification, conservative rule/model reconciliation, traceable evidence semantics, Stage 3 compatibility projection, and authoritative schema-v2 JSON/Markdown reporting. External Playwright regression passed 3/3. The five-page Aidoc acceptance run `2026-07-24T07-02-21-200Z` passed canonical JSON/Markdown review, validated the assertion-specific verification boundary, and confirmed that the inconclusive Equador typo did not trigger verified suppression. Completed CQ-010 through CQ-012 and advanced the current stage to Stage 6. |
| 2026-07-23 | 1.0 | Stage 4 added candidate-linked guarded disclosure and conventional ARIA tab investigation with exact identities, fail-closed browser containment, deterministic transition evidence, mandatory rollback, known-finding integration, deterministic coverage, and real Chromium localhost acceptance. Real-site trials also confirmed conservative ineligibility rejection and zero-new-request fail-closed behavior. A start-page defect found during acceptance was corrected so the configured start URL is inspected through the same authoritative page-inspection path and consumes the page budget. Advanced the current stage to Stage 5. |
| 2026-07-23 | 1.0 | Stage 3 passed deterministic checks, a five-page real-site Aidoc acceptance run, report/JSON acceptance review, and the final Playwright regression suite; acceptance produced one logical Equador finding with four affected-page occurrences, one actual verification, and three redundant investigations skipped. One Playwright test initially hit a transient timeout, then passed in isolation, and the full suite subsequently passed 3/3; advanced the current stage to Stage 4. |
| 2026-07-23 | 1.0 | Stage 2 passed deterministic checks, navigation-choice integration, a five-page real-site Aidoc acceptance run, and the existing 3-test Playwright regression suite; advanced the current stage to Stage 3. |
| 2026-07-23 | 1.0 | Stage 1 passed deterministic checks, real-site acceptance, and the existing Playwright regression suite; advanced the current stage to Stage 2. |
| 2026-07-23 | 1.0 | Established the canonical 10-stage roadmap and backlog-first planning rule. |
