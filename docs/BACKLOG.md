# CheckQuest Backlog

**Backlog version:** 1.0  
**Established:** 2026-07-23  
**Current roadmap stage:** Stage 7 — Passive security and infrastructure posture

This file is the parking place for work that should not silently interrupt the current roadmap stage.

The canonical stage order is defined in `ROADMAP.md`.

## Status values

- **NOW** — belongs to the current roadmap stage.
- **QUEUED** — belongs to a later roadmap stage.
- **PARKED** — valid idea, but intentionally not scheduled yet.
- **DONE** — completed.
- **REJECTED** — explicitly not a goal unless circumstances change.

## Priority rule

Roadmap stage order is more important than backlog item number.

A newly added backlog item does **not** become immediate work merely because it sounds useful.

---

# Active and queued backlog

| ID | Item | Target stage | Status | Notes |
|---|---|---:|---|---|
| CQ-016 | Add a separate passive security/infrastructure posture layer | 7 | NOW | Passive only; CheckQuest is not a penetration-testing tool. |
| CQ-017 | Review large files and responsibility boundaries | 8 | QUEUED | DevAnalyzer takeaway; refactor only where it materially improves the codebase. Consider moving the shared guarded-interaction safety boundary out of the disclosure executor if that improves ownership and maintainability; this is not a current blocker. |
| CQ-018 | Add/strengthen ESLint and static-quality checks | 8 | QUEUED | Include appropriate CI enforcement. |
| CQ-019 | Expand unit/integration test depth around agent logic | 8 | QUEUED | Candidate handling, schemas, novelty, context, dedupe, verification, decision logic. |
| CQ-020 | Harden error handling, retries, and observability | 8 | QUEUED | Include model, browser, navigation-visit, configuration, logging, and progress failures, including conservative retry/recovery behavior. |
| CQ-021 | Expand setup and architecture documentation | 8 | QUEUED | Document the architecture after it stabilizes rather than continuously rewriting it. |
| CQ-022 | Perform a repository-wide production-readiness/CI review | 8 | QUEUED | Deliberate hardening pass rather than analyzer-score chasing. |
| CQ-023 | Formalize presentation-agnostic core boundaries | 9 | QUEUED | Keep CLI, desktop, and web/SaaS options viable. |
| CQ-024 | Formalize Gemini BYOK handling across future interfaces | 9 | QUEUED | User keys must remain user-owned, isolated, and unlogged. |
| CQ-025 | Define release-quality installation/distribution | 10 | QUEUED | Exact mechanism depends on product direction. |
| CQ-026 | Finalize stable configuration/versioning/report behavior | 10 | QUEUED | Required before external users depend on CheckQuest. |
| CQ-027 | Polish the public repository and example/demo configuration | 10 | QUEUED | Final external-facing repository pass. |

---

# Parking lot

These are valid future possibilities, but they are **not commitments to build them now**.

| ID | Item | Status | Notes |
|---|---|---|---|
| CQ-P001 | Windows/Desktop UI | PARKED | Architecture should permit it; implementation waits until the core/product direction is mature. |
| CQ-P002 | Web/SaaS frontend | PARKED | Architecture should permit it; no decision yet between desktop, SaaS, or both. |
| CQ-P003 | Review observedTemplateKey sensitivity across multiple real sites before tuning the structural-template algorithm | PARKED | The Stage 2 Aidoc run produced distinct observed template keys for all five selected pages. This may be legitimate, but the structural fingerprint may also be somewhat sensitive. Do not tune it based on one site/run; this was not a Stage 2 blocker. |
| CQ-P005 | Improve planner behavior after sufficient candidate evidence is already gathered | PARKED | In real-site runs Gemini sometimes proposes a second comparison action such as selecting "Ecuador" after the targeted "Equador" interaction fact has already been demonstrated. Stage 1 correctly rejects that off-target action before browser execution. This is not a safety defect. A future refinement could encourage the planner to stop immediately once the candidate has sufficient interaction evidence rather than proposing an action the relevance gate will reject. |
| CQ-P006 | Clarify legacy interaction-verification terminology in runtime console output | PARKED | Stage 5 canonical reports correctly distinguish a raw legacy `VERIFIED` interaction outcome from an inconclusive semantic finding. Consider changing console terminology to make that distinction clearer without altering the preserved raw outcome or canonical verification semantics. |
| CQ-P007 | Evaluate optional future exploration refinements | PARKED | Consider URL identity/canonicalization and tracking-query normalization, evidence-led adaptive navigation-yield signals, multilingual deterministic route hints, and persisted cross-run navigation history only when supported by broader evidence. None is required for Stage 6 completion. |

---

# Explicit non-goals / rejected score-chasing

These may be reconsidered later if a genuine product or deployment requirement appears.

| ID | Item | Status | Reason |
|---|---|---|---|
| CQ-R001 | Add Docker solely because an analyzer expects containerization | REJECTED | Containerization should solve a deployment problem, not improve a score. |
| CQ-R002 | Add a standalone build command solely because an analyzer expects one | REJECTED | Add a build/package step only when runtime or distribution requires it. |
| CQ-R003 | Broaden the technology stack merely to improve “stack breadth” | REJECTED | CheckQuest should use the technologies it needs, not collect technologies. |

---

# Adding a new backlog item

When a new issue or idea appears:

1. Decide whether it is a **BLOCKER**, **DEFECT**, or **BACKLOG** item.
2. If it is not a blocker, add it here before doing implementation work.
3. Assign the most appropriate roadmap stage when possible.
4. Use **PARKED** when the idea is valid but does not yet belong to a committed stage.
5. Do not reorder roadmap stages silently.
6. Mark items **DONE** as part of stage completion.

Suggested ID format:

- `CQ-###` — scheduled roadmap backlog item.
- `CQ-P###` — parked future idea.
- `CQ-R###` — rejected/non-goal unless circumstances change.

---

# Completed items

Move completed backlog entries here during stage-closeout reviews.

| ID | Item | Completed in |
|---|---|---|
| CQ-001 | Tie autonomous investigation actions directly to candidate findings | Stage 1 — Candidate-driven investigation (2026-07-23) |
| CQ-002 | Prevent irrelevant investigation from consuming the investigation budget | Stage 1 — Candidate-driven investigation (2026-07-23) |
| CQ-003 | Track novelty across the full run | Stage 2 — Page-type diversity and run-level novelty (DONE — 2026-07-23) |
| CQ-004 | Detect/represent page-type or template similarity | Stage 2 — Page-type diversity and run-level novelty (DONE — 2026-07-23) |
| CQ-005 | Prefer unexplored page types and functional areas | Stage 2 — Page-type diversity and run-level novelty (DONE — 2026-07-23) |
| CQ-006 | Pass known-finding context into later analysis | Stage 3 — Known-finding context (DONE — 2026-07-23) |
| CQ-007 | Prioritize new findings over rediscovery | Stage 3 — Known-finding context (DONE — 2026-07-23) |
| CQ-008 | Allow useful evidence to strengthen an existing finding | Stage 3 — Known-finding context (DONE — 2026-07-23) |
| CQ-009 | Expand the safe action vocabulary with guarded disclosure and conventional ARIA tab investigation | Stage 4 — Broaden the safe action vocabulary (DONE — 2026-07-23) |
| CQ-028 | Inspect the configured start URL as page 1 through the authoritative page-inspection path | Stage 4 acceptance hardening (DONE — 2026-07-23) |
| CQ-P004 | Normalize first-occurrence verification representation in site-wide JSON | Stage 5.3 canonical unified finding lifecycle and reporting (DONE — 2026-07-23) |
| CQ-010 | Define a unified finding model | Stage 5 — Finding unification and static verification (DONE — 2026-07-24) |
| CQ-011 | Add explicit verification state to findings | Stage 5 — Finding unification and static verification (DONE — 2026-07-24) |
| CQ-012 | Allow deterministic/static evidence to confirm or contradict model observations | Stage 5 — Finding unification and static verification (DONE — 2026-07-24) |
| CQ-013 | Complete supplied-start-URL inspection and representative bounded coverage through the global frontier, Stage 2 novelty, and Stage 6.1/6.2 policies; exhaustive or body-wide crawling is not required | Stage 6 — Exploration coverage and smarter navigation (DONE — 2026-07-24) |
| CQ-014 | Add traversal depth/provenance, deterministic breadth/depth and budget policy, area/family diversification, bounded candidate windows, and redirect/final-URL accounting | Stage 6 — Exploration coverage and smarter navigation (DONE — 2026-07-24) |
| CQ-015 | Add conservative deterministic weak/strong low-value prioritization that defers rather than excludes low-value routes; adaptive observed-yield learning is not required | Stage 6 — Exploration coverage and smarter navigation (DONE — 2026-07-24) |
