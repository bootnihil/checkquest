# CheckQuest Backlog

**Backlog version:** 1.14
**Established:** 2026-07-23
**Current roadmap stage:** Stage 10 — Release-quality CheckQuest

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
| CQ-025 | Define release-quality installation/distribution | 10 | NOW | Active Stage 10 distribution focus. Choose a release mechanism that matches the actual product direction rather than adding packaging ceremony. |
| CQ-026 | Finalize stable configuration/versioning/report behavior | 10 | NOW | Active Stage 10 contract focus. Decide which externally visible configuration, versioning, and report behaviors should become dependable for users. |
| CQ-027 | Polish the public repository and example/demo configuration | 10 | NOW | Active Stage 10 public-facing focus. Make the repository, product explanation, example/demo path, and final documentation suitable for external users. |

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
| CQ-P008 | Evaluate optional future passive-security posture enhancements | PARKED | Consider cookie posture with strict secret redaction, broader passive request/external-host inventory, TLS/browser infrastructure metadata, mixed-content diagnostics, visible form-action posture, and more advanced security-policy interpretation only when justified by product need and a safe privacy design. These were design recommendations, not Stage 7 completion requirements. |

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
| CQ-016 | Add a separate passive security/infrastructure posture layer | Stage 7 — Passive security and infrastructure posture (DONE — 2026-07-24) |
| CQ-017 | Review large files and responsibility boundaries | Stage 8A — Code organization and responsibility hardening (DONE — 2026-07-24) |
| CQ-018 | Add/strengthen ESLint and static-quality checks | Stage 8B — Static quality and tooling (DONE — 2026-07-24) |
| CQ-019 | Expand unit/integration test depth around agent logic | Stage 8C — Test depth and coverage (DONE — 2026-07-25) |
| CQ-020 | Harden error handling, retries, and observability | Stage 8D — Error handling and observability (DONE — 2026-07-25) |
| CQ-021 | Expand setup and architecture documentation | Stage 8E — Documentation (DONE — 2026-07-25) |
| CQ-022 | Perform a repository-wide production-readiness/CI review | Stage 8F — Production-readiness review (DONE — 2026-07-25) |
| CQ-023 | Formalize presentation-agnostic core boundaries | Stage 9 — Productization boundary (DONE — 2026-07-25) |
| CQ-024 | Formalize Gemini BYOK handling across future interfaces | Stage 9 — Productization boundary (DONE — 2026-07-25) |
