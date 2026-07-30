# CheckQuest Backlog

**Scope:** Unified living backlog across all CheckQuest roadmap versions
**Established:** 2026-07-23
**Current roadmap:** Roadmap v2 - Public Landing + Local GUI / Product Shell
**Current roadmap document:** `ROADMAP-V2.md`
**Current roadmap stage:** G2 - Local GUI MVP
**Completed roadmap:** Roadmap v1 - Stages 1-10 accepted
**Current execution focus:** G2 acceptance and bounded GUI configuration polish: improve run input handling, complete a fresh real report acceptance run, and resolve or disposition the Electron smoke failure
**Most recently completed:** G2 report trustworthiness remediation checkpoint — structured reconciliation, focused evidence, shared accounting, and human-report navigation (2026-07-30)

This is the single project-wide parking place for work that should not silently interrupt the current roadmap stage. It persists across Roadmap v1, v2, and future roadmap versions.

The **current** canonical stage order is defined in `ROADMAP-V2.md`. The completed Roadmap v1 is preserved in `ROADMAP.md` as the historical Stage 1–10 engineering record. When a future roadmap becomes current, this same backlog continues; only the roadmap pointers and execution focus are updated.

## Status values

- **NOW** — belongs to the current roadmap stage.
- **QUEUED** — follows the current work, within this roadmap or a later committed stage.
- **PARKED** — valid idea, but intentionally not scheduled yet.
- **PROMOTED** — originated in the backlog and has since been incorporated into a roadmap; retained here for history.
- **DONE** — completed.
- **REJECTED** — explicitly not a goal unless circumstances change.

## Priority rule

Roadmap stage order is more important than backlog item number.

A newly added backlog item does **not** become immediate work merely because it sounds useful.

---

# Active and queued backlog

Roadmap v2 stages G2–G7 are the remaining committed execution plan and are intentionally not duplicated as backlog rows. New defects, refinements, or product ideas discovered while executing them belong here unless they are true blockers for the current stage.

G0 — Public landing & brand presence — completed on 2026-07-26. The public GitHub Pages site, aligned repository/branding presentation, responsive/contrast acceptance, and Pages deployment are complete.

G1 — GUI/core boundary — completed on 2026-07-26. The accepted
`startCheckQuest(...)` application boundary supports arbitrary URLs and
existing site configurations, page/navigation/investigation budgets, transient
per-run Gemini credentials, per-run model override, structured events,
categorized failures, idempotent cancellation, report persistence, and
absolute artifact paths. Cancellation preserves guarded-action rollback and
required browser cleanup; application-boundary sanitization prevents
credentials and nested causes from crossing public event, error, report, or
result boundaries. The CLI now delegates execution and persistence to this
shared boundary.

Current execution continues with **G2 — Local GUI MVP** in `ROADMAP-V2.md`.

The Electron GUI MVP is implemented. G2 acceptance exposed and then remediated
a deeper report-trustworthiness blocker: generated prose could fragment one
logical defect, visual-sounding claims could lack focused visual proof, and GUI
and report totals could describe the same run differently. The remediation now
uses validated structured identity, preserves conservative verification,
captures claim-appropriate evidence, derives GUI/report counts from one shared
projection, and gives human report items stable run-scoped IDs and navigation.

## G2 GUI configuration polish bucket

This is the ordered working bucket for configuration-side GUI polish discovered
during G2 acceptance. Add new configuration-form ideas here rather than
scattering them through roadmap prose or immediately interrupting the current
acceptance sequence.

`NOW` items are bounded G2 polish. `PARKED` items are deliberate later ideas and
are not G2 completion requirements. Implementation must preserve the existing
application/core contracts, authoritative core validation, and
transient-credential boundary.

### Preserve the current strengths

The polish pass should not redesign the interface for its own sake. Preserve:

- the single-column Target → Exploration budgets → AI configuration flow;
- progressive disclosure and the lack of unnecessary backtracking;
- inline helper text and recognition-over-recall behavior;
- honest work-in-progress navigation badges;
- disabled-run error prevention; and
- visible basic run readiness/status.

### Ordered implementation bucket

| Order | ID | Item | Status | Acceptance intent |
|---:|---|---|---|---|
| 1 | CQ-029 | Improve target URL handling | NOW | Accept bare domains such as `example.com` and normalize them to HTTPS. Reject malformed or implausible addresses before starting a run, without weakening authoritative application/core validation. |
| 2 | CQ-033 | Use one required-field language | NOW | Use one consistent required indicator for Target URL and Gemini API key. Prefer the existing asterisk plus required-field legend; do not use orange “Required” text as a second semantic language unless the field is actually in a warning/error state. |
| 3 | CQ-030 | Harden Gemini API-key entry | NOW | Mask the key by default; add an explicit Show/Hide control; provide useful inline validation before launch where safely possible; include a clear “where to get a key” route; and use precise trust copy such as “kept in memory for this session and never written to disk” only if the implementation guarantees it. Preserve transient, non-persistent credential behavior. |
| 4 | CQ-034 | Make budget values directly editable | NOW | Let users type a valid numeric value and use keyboard controls while retaining steppers as a secondary affordance. Enforce current ranges and reject invalid values without requiring repeated clicks. |
| 5 | CQ-031 | Clarify budget names and interaction | NOW | Choose clearer navigation wording such as “Navigation moves” or “Page transitions”; state that navigation is a run-level ceiling and investigation steps are per page; apply the chosen terms consistently in labels, helper text, events where appropriate, and deterministic UI checks. Do not change underlying budget semantics. |
| 6 | CQ-035 | Clarify budget control scope and ranges | NOW | Rename “Reset to defaults” to “Reset budgets to defaults” or otherwise make its section scope unambiguous. Keep min/max information visually attached to each value and avoid making the reader hunt between the control and a detached range hint. A range track is optional; clarity is required. |
| 7 | CQ-036 | Make disabled Run guidance contextual | NOW | Replace generic “Complete the required fields” copy with the most relevant missing requirement, for example “Enter a Gemini API key to continue,” while preserving disabled-submit error prevention. |
| 8 | CQ-032 | Clean up the native Electron menu | NOW | Remove or customize irrelevant default commands so the app does not expose misleading desktop actions. Retain only commands that are useful, safe, or deliberately developer-facing. |
| 9 | CQ-037 | Complete a measured visual-accessibility pass | NOW | Audit actual text and control contrast against the applicable WCAG AA thresholds rather than eyeballing it. Review muted helper text, blue section labels, disabled states, focus visibility, and control boundaries. Add section dividers or spacing where needed so Target, Budgets, AI configuration, and the footer remain easy to scan. |
| 10 | CQ-P016 | Consider Quick / Standard / Thorough presets | PARKED | Revisit after the explicit-budget workflow is accepted. Presets must remain transparent shortcuts: page, navigation, and investigation budgets stay visible and editable, with no hidden change to exploration semantics. |

### Implementation notes

- API-key format validation should be helpful but conservative. Do not encode a
  brittle secret-shape rule that rejects valid future Gemini keys; a bounded
  credential preflight remains authoritative.
- A “Get a Gemini API key” link or help action must use a deliberate trusted
  destination and must not leak the current field value.
- Direct numeric entry, arrow keys, wheel behavior, and steppers must share one
  validation path so the displayed value cannot diverge from the submitted
  budget.
- Helper text should explain configuration consequences without implying that
  larger budgets guarantee more findings, confirmation, or exhaustive
  coverage.
- The budget wording should make clear that configuration can affect available
  exploration/investigation opportunity without suggesting that a higher budget
  relaxes evidence or verification requirements.
- Visual separators are a scannability tool, not a reason to replace the
  current compact single-column form with a collection of heavy cards.

### Remaining G2 acceptance order

1. Implement and verify the four `NOW` configuration-polish items above.
2. Run a fresh real model-backed representative site pass and inspect the
   reconciled report, focused evidence, item numbering/links, filenames, page
   references, and GUI/report totals.
3. Reproduce and resolve or explicitly disposition the Electron smoke-process
   crash in the normal acceptance environment.
4. Perform the G2 documentation/status sweep, then decide whether G2 can be
   accepted. Do not begin G3 merely because the implementation checklist is
   exhausted.

---

# Parking lot

These are valid future possibilities, but they are **not commitments to build them now**.

| ID | Item | Status | Notes |
|---|---|---|---|
| CQ-P001 | Windows/Desktop UI | PROMOTED | Promoted into Roadmap v2 G1–G7 as the Local GUI / Product Shell phase; no longer a parked idea. |
| CQ-P002 | Web/SaaS frontend | PARKED | Roadmap v2 deliberately proves the local product first. SaaS remains a post-validation product-direction option rather than a competing implementation path during G1–G7. |
| CQ-P003 | Review observedTemplateKey sensitivity across multiple real sites before tuning the structural-template algorithm | PARKED | The Stage 2 Aidoc run produced distinct observed template keys for all five selected pages. This may be legitimate, but the structural fingerprint may also be somewhat sensitive. Do not tune it based on one site/run; this was not a Stage 2 blocker. |
| CQ-P005 | Improve planner behavior after sufficient candidate evidence is already gathered | PARKED | In real-site runs Gemini sometimes proposes a second comparison action such as selecting "Ecuador" after the targeted "Equador" interaction fact has already been demonstrated. Stage 1 correctly rejects that off-target action before browser execution. This is not a safety defect. A future refinement could encourage the planner to stop immediately once the candidate has sufficient interaction evidence rather than proposing an action the relevance gate will reject. |
| CQ-P006 | Clarify legacy interaction-verification terminology in runtime console output | PARKED | Stage 5 canonical reports correctly distinguish a raw legacy `VERIFIED` interaction outcome from an inconclusive semantic finding. Consider changing console terminology to make that distinction clearer without altering the preserved raw outcome or canonical verification semantics. |
| CQ-P007 | Evaluate optional future exploration refinements | PARKED | Consider URL identity/canonicalization and tracking-query normalization, evidence-led adaptive navigation-yield signals, multilingual deterministic route hints, and persisted cross-run navigation history only when supported by broader evidence. None is required for Stage 6 completion. |
| CQ-P008 | Evaluate optional future passive-security posture enhancements | PARKED | Consider cookie posture with strict secret redaction, broader passive request/external-host inventory, TLS/browser infrastructure metadata, mixed-content diagnostics, visible form-action posture, and more advanced security-policy interpretation only when justified by product need and a safe privacy design. These were design recommendations, not Stage 7 completion requirements. |
| CQ-P009 | Authenticated application exploration | PARKED | Consider user-supplied/pre-authenticated Playwright session state only after the local GUI is validated and the stronger safety implications of authenticated authority are deliberately designed. Not a Roadmap v2 requirement. |
| CQ-P010 | Additional model providers / provider abstraction | PARKED | Gemini remains the working BYOK provider for Roadmap v2. G7 explicitly assesses availability, latency, rate limits, cost, provider-behavior changes, and material run-to-run variability; promote provider abstraction only if that evidence or real deployment constraints justify it. |
| CQ-P011 | Partial-run reporting | PARKED | Consider an explicit PARTIAL run/report state for larger or recurring scans so useful completed work can survive a later failure without masquerading as a successful complete run. G1 cancellation during an active filesystem write remains cooperative; atomic or partial-report persistence was not required for G1. |
| CQ-P012 | Finding-to-Playwright regression-test generation | PARKED | Evaluate whether deterministically replayable confirmed findings can be exported as minimal regression tests. Product-validation candidate, not a committed Roadmap v2 feature. |
| CQ-P013 | CI/release and recurring-monitoring integrations | PARKED | Consider CI triggers, scheduled runs, history, new/resolved finding comparison, and notifications only if external usage demonstrates recurring-monitoring demand. |
| CQ-P014 | Packaged-app user-data and report-storage location | PARKED | The G1 application boundary returns absolute artifact paths while preserving the existing persistence root. Select an OS-appropriate user-data/report location when the product shell and Windows packaging requirements are established; this is not a G1 requirement. |
| CQ-P015 | Forced real-Chromium browser-close failure injection | PARKED | G1 deterministically covers cleanup precedence and integration-tests real browser connection cleanup. Add a seam that can force a real `browser.close()` failure only if future cleanup risk justifies it; it is not required for G1. |

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
3. Assign the most appropriate stage in the **current roadmap** when possible.
4. Use **PARKED** when the idea is valid but does not yet belong to a committed stage.
5. Use **PROMOTED** when a parked item is deliberately incorporated into a roadmap, so its history remains visible without duplicating execution tracking.
6. Do not reorder, extend, or replace roadmap stages silently.
7. Mark items **DONE** as part of stage completion.

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
| CQ-025 | Define release-quality installation/distribution | Stage 10A — Fresh-clone source installation and distribution (DONE — 2026-07-25) |
| CQ-026 | Finalize stable configuration/versioning/report behavior | Stage 10B — Stable public contracts (DONE — 2026-07-25) |
| CQ-027 | Polish the public repository and example/demo configuration | Stage 10C — Public repository, demo, and release presentation (DONE — 2026-07-25) |
