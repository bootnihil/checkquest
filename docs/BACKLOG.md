# CheckQuest Backlog

**Backlog version:** 1.0  
**Established:** 2026-07-23  
**Current roadmap stage:** Stage 4 — Broaden the safe action vocabulary

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
| CQ-009 | Expand the safe action vocabulary | 4 | NOW | Only after Stages 1–3 make action selection smarter. |
| CQ-010 | Define a unified finding model | 5 | QUEUED | Browser, model, and deterministic evidence should converge on one finding. |
| CQ-011 | Add explicit verification state to findings | 5 | QUEUED | Verified / Not Verified / Inconclusive or equivalent. |
| CQ-012 | Allow deterministic/static evidence to confirm or contradict model observations | 5 | QUEUED | Prevent unsupported model claims from being presented as confirmed defects. |
| CQ-013 | Improve complete inspection of the supplied start URL | 6 | QUEUED | Improve meaningful coverage without uncontrolled crawling. |
| CQ-014 | Improve navigation-depth and page-budget strategy | 6 | QUEUED | Spend exploration budget on higher-value routes. |
| CQ-015 | Avoid dead-end and low-value navigation routes | 6 | QUEUED | Navigation should serve coverage, not movement for its own sake. |
| CQ-016 | Add a separate passive security/infrastructure posture layer | 7 | QUEUED | Passive only; CheckQuest is not a penetration-testing tool. |
| CQ-017 | Review large files and responsibility boundaries | 8 | QUEUED | DevAnalyzer takeaway; refactor only where it materially improves the codebase. |
| CQ-018 | Add/strengthen ESLint and static-quality checks | 8 | QUEUED | Include appropriate CI enforcement. |
| CQ-019 | Expand unit/integration test depth around agent logic | 8 | QUEUED | Candidate handling, schemas, novelty, context, dedupe, verification, decision logic. |
| CQ-020 | Harden error handling, retries, and observability | 8 | QUEUED | Include model, browser, configuration, logging, and progress failures. |
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
| CQ-P004 | Normalize first-occurrence verification representation in site-wide JSON | PARKED | Stage 3 reporting is correct in Markdown. Later known occurrences carry occurrence state directly. The first investigated occurrence currently has `verificationOutcome: null` in the site-wide occurrence object and refers indirectly to the page-level finding result. This is a reporting-model consistency cleanup only and was not a Stage 3 blocker. |
| CQ-P005 | Improve planner behavior after sufficient candidate evidence is already gathered | PARKED | In real-site runs Gemini sometimes proposes a second comparison action such as selecting "Ecuador" after "Equador" has already been verified. Stage 1 correctly rejects that off-target action before browser execution. This is not a safety defect. A future refinement could encourage the planner to stop immediately once the candidate has sufficient evidence rather than proposing an action the relevance gate will reject. |

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
