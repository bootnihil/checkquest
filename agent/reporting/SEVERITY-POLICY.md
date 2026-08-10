# Severity Policy

## Status

DEFERRED — AUDITED, NOT IMPLEMENTED

Phase 5B.1 successfully evaluated the proposed policy against all currently reachable authoritative producer states. C1–C6 exactly reproduce the severities those deterministic producers already assign, while current model and general technical cases that fall through C7 lack an additional trustworthy structured consequence signal. Implementing the policy today would add architectural and conformance machinery without improving current user-visible severity behavior, so implementation is intentionally deferred.

Phase 5B.1 — **COMPLETE**  
Phase 5B.2 — **DEFERRED / NOT WARRANTED WITH CURRENT SIGNALS**  
Phase 5B — **CLOSED**

If Phase 5B.2 is ever reauthorized under one of the reconsideration triggers, this document is its design baseline and must be reviewed again before implementation begins.

## Implementation Decision

Phase 5B.2 is not currently warranted.

| Class | Proposed result | Current authoritative producer result | Change |
| --- | --- | --- | --- |
| C1 | High | High | unchanged |
| C2 | Medium | Medium | unchanged |
| C3 | Low | Low | unchanged |
| C4 | Medium | Medium | unchanged |
| C5 | Low | Low | unchanged |
| C6 | Info | Info | unchanged |

All deterministic classes the proposed policy can safely recognize already receive those exact values from their authoritative producers. Centralizing them would not currently recalibrate a reachable report.

Golden cases that intentionally supply an `existingSeverity` different from the C1–C6 result remain valuable policy invariance and conformance cases. They specify how a future policy would resist mismatched inputs; they are not evidence of a current production defect when the authoritative producers cannot emit those mismatched states.

### Reconsideration triggers

Implementation should be reconsidered only if at least one independently justified trigger occurs:

- **Trigger A — new consequence signal.** A new trustworthy structured consequence signal exists before the severity decision, has stable semantics, describes actual plausible consequence rather than confidence, does not require title, prose, or URL interpretation, and safely reclassifies a currently fallback-only reachable case.
- **Trigger B — independently worthwhile conformance hardening.** A demonstrated architecture need justifies centralized enforcement, such as producer drift becoming a maintenance problem, multiple producers needing one enforced severity contract, or a new producer family needing to share the policy.

The existence of this policy document is not by itself a reason to implement Phase 5B.2.

## Scope

Severity means the plausible consequence if the supported claim is true. Evidence source records where support came from. Assessment records how conclusively the claim is established. These dimensions are independent: strong evidence, verification, breadth, and item type do not by themselves raise or lower severity.

The proposed policy would cover canonical user-facing findings, technical notes, and passive-security notes in newly generated reports. It would neither admit nor suppress items, associate evidence, derive verification, create identity, group occurrences, define ranking, nor choose presentation type. Existing downstream ranking could continue to use the resulting severity as its current late tie-break. Existing severity would be preserved when approved structured signals are insufficient.

Current supported vocabularies are intentionally retained:

- `FindingSeverity`: `high | medium | low`.
- `PassiveSecuritySeverity`: `medium | low | info`.

No schema-version change, migration, historical rewrite, backfill, artifact transformation, or new severity level is proposed.

## Current Severity Flow

### User-facing findings

```text
evaluatePageObservation fixed rule severity OR exploratoryQaFindingSchema model severity
→ normalizeTechnicalObservations (cross-origin DNS alone may become Low)
→ reconcileFindingObservations (an exactly matched deterministic rule retains rule severity)
→ current-finding-adapters copy severity into UnifiedFinding
→ unified registry associates evidence/occurrences and finalizes verification without changing severity
→ getRunFindings applies the run DNS aggregate policy (aggregate is Low)
→ buildSiteAgentReport stores UnifiedFinding.severity in canonical report.findings
→ writeJsonReport serializes it
→ buildHumanReportPresentation copies it
→ writeMarkdownReport formats it
```

Deterministic rule severity first enters in `agent/analysis/evaluate-page.ts`. Model severity first enters through `exploratoryQaFindingSchema` in `agent/analysis/exploratory-qa-schema.ts`. `adaptPageFinding` and `adaptExploratoryQaFinding` in `agent/findings/current-finding-adapters.ts` copy the selected producer value. When model and rule assertions reconcile, `applyModelPresentation` changes description/check text only; rule severity remains canonical. `registerUnifiedPageFindings` keeps the first canonical finding severity while merging evidence and occurrences.

Verification is derived in `derive-verification-state.ts` after evidence exists and is refreshed during reconciliation/registry merging. Identity and fingerprinting occur before registry grouping. Neither derivation reads severity. Human item classification occurs later in `run-summary-projection.ts`; it reads category and trusted technical identity, not severity.

### Technical notes

Technical notes are not a separate canonical schema family. They are `UnifiedFinding` values projected as `technical-observation` by `classifyHumanReportItem`. Their severity originates from the same deterministic/model paths as findings. Two current technical transformations exist:

1. `normalizeTechnicalObservations` sets a single cross-origin DNS model observation to `low` while preserving observer-environment uncertainty.
2. `applyRunTechnicalObservationPolicy` replaces three or more distinct cross-origin DNS-host observations with one aggregate `UnifiedFinding` at `low`.

Other console-error, failed-request, CORS, SVG, ORB, aborted-request, and resource observations retain producer severity. Type classification can turn a presentation-resource failure into a Possible issue and another diagnostic into a Technical note, but it does not map type to severity.

### Security notes

```text
evaluatePassiveSecurity deterministic rule condition
→ createDraft assigns code, posture, severity, confidence, and occurrence
→ passive-security registry groups by fingerprint without changing severity
→ getPassiveSecurityReport assigns references and derives bySeverity summary
→ buildSiteAgentReport stores passiveSecurity unchanged
→ writeJsonReport serializes observation severity
→ buildHumanReportPresentation copies it
→ writeMarkdownReport formats it
```

Security severity is independent of `UnifiedFinding`: `PassiveSecuritySeverity` is `medium | low | info`. Current rule assignments are `medium` for an HTTP main document, `low` for the enumerated HSTS/CSP/nosniff conditions, and `info` for frame-policy absence and technology disclosure.

### JSON and Markdown authority

`report.findings[].severity` and `report.passiveSecurity.observations[].severity` are canonical for new report consumers. JSON serializes those collections directly; Markdown projects the same values without recalculation. Raw `inspectedPages`, `siteWideExploratoryFindings.representativeFinding`, and `summary.highestExploratoryQaSeverity` are documented compatibility/execution detail and may retain original model values; they are not a second canonical severity authority. `summary.highestSeverity` is derived from canonical findings.

### Existing severity assertions

| Test | Current contract asserted |
| --- | --- |
| `page-evaluation-check.ts` | Exact deterministic rule severities from `evaluatePageObservation`. |
| `exploratory-qa-schema-check.ts` | Model enum accepts high/medium/low and rejects unsupported values. |
| `finding-reconciliation-check.ts` | An exactly reconciled deterministic rule owns severity over model presentation. |
| `unified-findings-check.ts`, `unified-finding-lifecycle-check.ts`, `run-finding-lifecycle-integrity-check.ts` | Canonical construction, persistence, summaries, and lifecycle preservation. |
| `technical-observation-reconciliation-check.ts` | Single/aggregate cross-origin DNS normalization, under-threshold preservation, and incompatible model override. |
| `passive-security-check.ts` | Every passive rule's posture/severity/confidence and by-severity aggregation. |
| `passive-security-report-check.ts` | Security severity survives report JSON/Markdown separation and summary projection. |
| `human-report-check.ts` | Severity projection, formatting, ordering/tie-break position, and independence from Type/Evidence/Assessment. |
| `site-wide-report-check.ts` | Canonical/compatibility report severity labels and summary shape. |
| `application-error-diagnostics-check.ts` | Invalid model severity remains a schema diagnostic without leaking private response data. |

The complete additional search inventory of severity-touching automated tests is: `accessibility-finding-admission-check.ts`, `finding-identity-check.ts`, `finding-investigation-outcome-check.ts`, `known-findings-check.ts`, `planner-prompt-check.ts`, `run-finding-lifecycle-check.ts`, `run-site-api-check.ts`, `site-wide-findings-check.ts`, and the browser checks `candidate-driven-investigation-check.ts`, `run-site-browser-integration-check.ts`, `screenshot-trigger-check.ts`, `stage4a-browser-acceptance-check.ts`, `stage4a-disclosure-check.ts`, `stage4b-browser-acceptance-check.ts`, and `stage4b-tab-check.ts`. They use severity in fixture/schema or broader object-preservation assertions and establish no additional mutation authority. Manual real-site checks only display or summarize severity.

## Proposed Ownership Boundary

If Phase 5B.2 is separately reauthorized, the bounded ownership point would be one pure policy at the start of `buildSiteAgentReport`, immediately after it receives final `canonicalFindings` from `getRunFindings` and the completed passive-security report, and before it builds compatibility projections, severity summaries, or the returned `SiteAgentReport`.

That future boundary adapter would create report-owned copies with policy severity and update only:

- copied `UnifiedFinding.severity`;
- copied `PassiveSecurityObservation.severity`;
- derived `summary.highestSeverity`; and
- derived `passiveSecurity.summary.bySeverity`.

Before this boundary, admission, technical normalization, accessibility admission, identity, fingerprints, grouping, occurrence/evidence association, verification, DNS aggregation, and passive-security occurrence aggregation are complete. After it, report summaries, report JSON, human projection, Markdown, and technical/security evidence artifacts consume the same report-owned severity.

The future policy would not be allowed to receive or return verification, identity, grouping, eligibility, rank, Type, Evidence source, Assessment, occurrences, or evidence. Its report assembler would assert a one-for-one item mapping; it could change a severity scalar but no collection cardinality or canonical ordering. A later presentation sort could naturally respond to a changed severity through its existing tie-break, but the policy would introduce no ranking rule. No rollback mechanism would be needed because the canonical run lifecycle would not be mutated.

## Severity Model

```text
severity = deterministic consequence class from an approved structured claim code
           OR exact existing severity when no approved class is available
```

`verification`, evidence source, breadth, and human item type are test context only. They are deliberately absent from the policy decision. In any reauthorized implementation, policy-derived and fallback-preserved outcomes would need to be distinguishable in the pure function result during testing, for example `{ severity, basis: 'policy' | 'fallback' }`; no persisted schema field would be required.

## Signal Inventory

“Available” means available at or derivable without prose at the proposed boundary. “Stable” excludes presentation-only labels. Every candidate ends in exactly one classification.

| # | Signal | Exact field/type | Owner/module | Origin | Available | Authority | Stability | Consequence relationship | Classification | Reason |
| ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Source family | `UnifiedFinding` vs `PassiveSecurityObservation` | finding/security models | Canonical collection | yes | authoritative routing | stable | Selects vocabulary/claim-code namespace only | CONTEXT-ONLY / NON-DRIVING | Family alone says nothing about consequence. |
| 2 | Human item classification | `HumanReportItemClassification` | `run-summary-projection.ts` | Derived from admitted technical identity | derivable | authoritative for Type | stable | Presentation family, not impact | CONTEXT-ONLY / NON-DRIVING | Possible issue/Technical note cannot be shortcuts. |
| 3 | Finding category | `UnifiedFinding.category` | finding model | Rule/model producer | yes | canonical classification | stable | Broad subject area only | CONTEXT-ONLY / NON-DRIVING | Content/technical/accessibility categories contain mixed impacts. |
| 4 | Deterministic rule code | `PageFinding.code` / `ExistingPageFindingCode` | evaluator/adapters | Deterministic page rule | yes, from exactly linked `page-finding` raw source | authoritative supported-claim identity | stable | Identifies a bounded rule assertion with known consequence | APPROVED SEVERITY INPUT | Whitelisted codes can map mechanically without prose. |
| 5 | Technical identity kind | `TechnicalObservationIdentity.kind` | exploratory QA schema | Runtime diagnostic reconciliation | yes | authoritative identity | stable | Mechanism, not user consequence | REJECTED | Console/CORS/request identity cannot establish impact. |
| 6 | Resource type | `TechnicalFailedRequestIdentity.resourceType` | technical identity | Browser request | yes | authoritative diagnostic | stable | May suggest role, not actual impairment | REJECTED | A failed image/script/font can be optional or material. |
| 7 | Origin relation | `originRelation` | failed-request/CORS identity | Runtime URL comparison | yes | authoritative attribution context | stable | Attribution uncertainty, not consequence | REJECTED | Same/cross-origin does not establish user impact. |
| 8 | Failure mechanism | `failureText`, CORS `mechanism` | technical identity | Browser diagnostic | yes | authoritative mechanism | stable | Explains failure mode only | REJECTED | DNS, ORB, aborted, CORS, and generic failure must not imply impact. |
| 9 | Console source/status | `source`, `sourceUrl`, `httpStatus` | console identity | Browser console | yes | authoritative diagnostic | stable except URL | Can locate a resource error | REJECTED | Status/source alone cannot prove consequence. |
| 10 | Presentation-resource role | `classifyTechnicalIdentity` derived image/font/media/style role | run summary projection | Resource type/extension | derivable | authoritative for Type | stable | User-facing plausibility, not proven consequence | CONTEXT-ONLY / NON-DRIVING | Preserve current Type without using it as severity. |
| 11 | Security rule code | `PassiveSecurityObservation.code: string` | passive-security evaluator | Deterministic passive rule | yes | authoritative supported-claim identity | stable for known codes | Identifies a bounded configuration consequence | APPROVED SEVERITY INPUT | Current known codes form an explicit whitelist; unknown codes fall back. |
| 12 | Security posture | `PassiveSecurityPosture` | passive-security evaluator | Deterministic rule | yes | authoritative risk posture | stable | Direct risk/consequence class | APPROVED SEVERITY INPUT | Guards code mapping and distinguishes informational/gap/misconfiguration. |
| 13 | Security category | `PassiveSecurityCategory` | security model | Deterministic rule | yes | canonical classification | stable | Broad domain only | CONTEXT-ONLY / NON-DRIVING | Transport and response-policy categories contain different consequences. |
| 14 | Security scope | `PassiveSecurityScope.type/key` | security evaluator | Snapshot origin | yes | authoritative scope identity | key is site-specific | Describes aggregation scope | CONTEXT-ONLY / NON-DRIVING | Scope key/breadth is not impact. |
| 15 | Security evidence fields | `PassiveSecurityEvidence.kind/subject/headerName/headerValues` | security model | Response snapshot | yes | authoritative evidence | mixed | Supports the rule, not an independent severity class | CONTEXT-ONLY / NON-DRIVING | The approved code/posture already owns the supported claim. |
| 16 | Verification | `UnifiedFinding.verification.state` | verification derivation | Evidence relations | yes | authoritative assessment | stable | Conclusiveness only | CONTEXT-ONLY / NON-DRIVING | Changing state alone must not change severity. |
| 17 | Evidence source/kind | `FindingEvidence.source/kind`; human Evidence label | finding/human models | Rule/model/browser/investigation/presentation | yes/derived | provenance authority | human label presentation-only | Where support came from | CONTEXT-ONLY / NON-DRIVING | Strong/direct/AI evidence is not consequence. |
| 18 | Evidence relation/capability | `relation`, `verificationCapable` | finding evidence | Admission/reconciliation | yes | verification input | stable | Proof strength only | CONTEXT-ONLY / NON-DRIVING | These derive Assessment, not severity. |
| 19 | Confidence | model `confidence`; security `confidence` | exploratory/security models | Model or deterministic rule | yes | confidence only | stable | Certainty only | CONTEXT-ONLY / NON-DRIVING | Confidence must not be relabeled consequence. |
| 20 | Observation breadth | occurrence count, distinct page count | canonical collections | Registry aggregation | yes | authoritative breadth | stable | Frequency of observation | CONTEXT-ONLY / NON-DRIVING | One/four/twenty pages do not independently change severity. |
| 21 | Existing canonical severity | `UnifiedFinding.severity` or `PassiveSecurityObservation.severity` | canonical models | Current producer/policy | yes | current severity | stable | Conservative prior value | CONTEXT-ONLY / NON-DRIVING | Used only by the explicit fallback, never as a policy driver. |
| 22 | Raw model severity | `ExploratoryQaFinding.severity` | model schema | Gemini output | yes in raw evidence | advisory after reconciliation | stable raw value | Model judgment may mix impact/confidence | REJECTED | It cannot bypass deterministic classes; canonical value may only be fallback. |
| 23 | Producer severity literal | `PageFinding.severity`, draft security severity | evaluator/security rules | Current deterministic producer | yes | current severity | stable | Existing behavior | CONTEXT-ONLY / NON-DRIVING | Preserved as fallback or overridden by approved code table, not read as a shortcut. |
| 24 | Browser HTTP status | `VisitedPageObservation.httpStatus` | page observation | Main-document response | indirectly through rule code | raw observation | stable | Status class can support access failure | REJECTED | The admitted `PageFinding.code` is the bounded authority; re-reading status would duplicate admission. |
| 25 | Investigation target | `FindingTarget.kind` | finding model | Model/admission | yes | action identity | stable | Action shape, not consequence | REJECTED | Select/tab/disclosure target does not state impact. |
| 26 | Structured identity mechanism | `FindingStructuredIdentity.mechanism` | exploratory schema | Model then runtime validation | yes | identity authority when admitted | stable | Defect mechanism, not impact magnitude | REJECTED | Missing/duplicate/state mismatch spans multiple consequences. |
| 27 | Accessibility defect facts | `AccessibilityDefectBasis.supportingEvidence` | accessibility admission | Structured browser facts | yes | admission/evidence authority | stable | Establishes a conflict/omission | CONTEXT-ONLY / NON-DRIVING | Current facts do not encode user-impact magnitude. |
| 28 | Screenshot/presentation target | `presentationTarget`, focused screenshot paths/presence | inspected page/report | Presentation capture | yes | evidence presentation | presentation-only | Evidence strength/visibility | REJECTED | Screenshot presence must not raise severity. |
| 29 | Diagnostic disposition | `ClassifiedDiagnostics.*.disposition` | diagnostics classifier | Browser diagnostics | earlier/raw | prioritization authority | stable | Actionability triage | CONTEXT-ONLY / NON-DRIVING | Not a supported consequence and not consistently item-linked at the boundary. |
| 30 | Title/prose/model wording | title, evidence, reasoning, description, remediation, summary | multiple | Model/rule/presentation | yes | wording only | mutable/presentation | May mention impact informally | REJECTED | Prose interpretation is nondeterministic and prompt-sensitive. |
| 31 | URL/hostname keywords | page/resource URL, origin, host | occurrences/identity/security scope | Browser | yes | location identity | site-specific | No reliable impact meaning | REJECTED | No URL-, hostname-, or monday.com-specific heuristic. |
| 32 | Identity/display/artifact names | fingerprint, references, display ID, evidence filename/path | lifecycle/reporting | Runtime | yes | identity/presentation | stable or presentation-only | None | REJECTED | Coupling severity to identity or artifact layout violates boundaries. |
| 33 | Summaries/ranking | highest severity, counts, notable tier/order | reporting | Derived downstream | no (computed after) | derived output | presentation/report | Circular | REJECTED | Severity must feed summaries/rank tie-breaks, never read them. |
| 34 | Guard safety severity | `ordinary` or `hard-breach` in browser safety boundary | guarded interaction | Runtime safety monitor | no relevant item link | separate safety authority | stable | Different semantic domain | REJECTED | It is not report finding severity. |

Summary: candidate signals: 34; approved: 3; context-only: 16; rejected: 15.

## Approved Severity Inputs

| Field/type | Producer | Source module | Authority and timing | Mutable later? | Consequence rationale |
| --- | --- | --- | --- | --- | --- |
| `PageFinding.code` (`ExistingPageFindingCode`) | `evaluatePageObservation` | `agent/analysis/evaluate-page.ts`; classified in `current-finding-adapters.ts` | Deterministic admitted rule identity, populated before unified adaptation; extracted only from associated internally tagged `page-finding` raw sources after lifecycle completion | Source no; policy input no | Specific whitelisted claims distinguish page access failure, missing title, and missing heading structure without prose. |
| `PassiveSecurityObservation.code: string` | `evaluatePassiveSecurity` | `agent/security/evaluate-passive-security.ts` | Deterministic passive rule identity, populated before registry aggregation and retained on the canonical observation | No | Known code whitelist identifies the precise passive configuration claim; unknown codes fall back. |
| `PassiveSecurityObservation.posture` (`PassiveSecurityPosture`) | `evaluatePassiveSecurity` | `agent/security/evaluate-passive-security.ts` | Deterministic risk posture populated with the code and retained through aggregation | No | It is a structured consequence/risk class and acts as a required guard against accidental code-only remapping. |

### Future trusted provenance contract

Only internally tagged deterministic raw sources where `rawSource.type === 'page-finding'` may establish a trusted deterministic page-rule code. The future boundary extractor may accept a code only when every such source is recognized and all resolve to exactly one unique recognized code. That code may occur once or repeatedly.

No deterministic source, any malformed or unknown deterministic source, or multiple distinct deterministic codes yields `null` and fallback. The extractor must never trust model `relatedRuleCode`, fingerprints, title, description or other prose, URLs, technical identity, human Type, existing severity, evidence strength, or verification as provenance.

| Condition | Result |
| --- | --- |
| No deterministic source | `null` → fallback |
| One unique recognized deterministic code, once or repeated | trusted code |
| Model-only `relatedRuleCode` | `null` → fallback |
| Multiple distinct deterministic codes | `null` → fallback |
| Malformed or unknown deterministic raw source | `null` → fallback |

Identity and fingerprint strings must never be parsed as severity authority. Unknown, ambiguous, malformed, or conflicting provenance fails closed rather than guessing. This is a reviewed future contract, not a current implementation.

## Context-Only Signals

Verification, evidence source/kind/relation/capability, confidence, screenshot presence, and observation breadth describe support or conclusiveness, not consequence. Item/source family, human Type, category, presentation-resource role, security category/scope/evidence, accessibility facts, and diagnostic disposition remain useful test/routing context but cannot independently change severity. Existing severity is read only after the policy proves no approved decision row matches.

## Rejected Signals

The policy must never inspect title, evidence/reasoning/description/remediation prose, model wording, raw URL/hostname keywords, model-provided severity as a policy driver, technical mechanism/kind/status/resource type/origin relation, evidence/investigation target, structured-identity mechanism, screenshot/presentation target, fingerprints/references/display IDs, artifact names/paths, summaries/ranking, or guarded-interaction safety severity.

These fields either encode evidence/identity rather than consequence, are site- or presentation-specific, require prose inference, are circular downstream outputs, or belong to another semantic domain.

## Existing Severity Fallback

> If the approved structured signals are insufficient to safely reclassify an item, preserve its existing severity rather than fabricate certainty.

Fallback fires when a unified finding lacks one recognized deterministic page-rule code, when a technical/model finding has only technical identity or prose, when a known security code/posture pair is absent or inconsistent, or when a future unknown code appears. Current explanatory examples include a placeholder/localization-like visible issue, poster/resource failure, general SVG or network diagnostic, DNS diagnostic, CORS diagnostic, and model-only finding. These examples are neither exhaustive nor future matching heuristics; they illustrate reachable cases whose present structured data does not establish a richer consequence class.

Fallback returns the exact existing value from the applicable vocabulary. It never converts `high`, `medium`, `low`, or `info`, and a future implementation would expose `basis: fallback` to tests.

Existing severity is fallback only, not an approved severity input. A matched policy row must return its table value even when existing severity differs.

## Consequence Taxonomy

| Class | Meaning and required structured signals | Excluded cases | Proposed severity |
| --- | --- | --- | --- |
| C1 Material page access/error-state impairment | `PageFinding.code` is `HTTP_SERVER_ERROR`, `HTTP_CLIENT_ERROR`, or `VISIBLE_ERROR_PAGE` | Unknown status; resource/console/CORS failures; prose-only error claims | High |
| C2 Limited document metadata impairment | `PageFinding.code === EMPTY_PAGE_TITLE` | Model prose about titles; missing headings | Medium |
| C3 Bounded structural content-quality condition | `PageFinding.code === NO_PRIMARY_HEADINGS` | Accessibility impact inferred from prose; arbitrary layout issues | Low |
| C4 Unencrypted main-document transport | security code `PS_HTTP_DOCUMENT` and posture `misconfiguration` | Other transport/security notes | Medium |
| C5 Bounded security defense/configuration gap | recognized HSTS/CSP/nosniff code with its current expected `defense-in-depth-gap` or HSTS `misconfiguration` posture | HTTP document; informational posture; unknown code/posture mismatch | Low |
| C6 Informational security configuration/inventory | `PS_FRAME_POLICY_NOT_OBSERVED` or `PS_TECHNOLOGY_DISCLOSURE` with posture `informational` | Any gap/misconfiguration; unknown informational code | Info |
| C7 Insufficient structured consequence | No exact C1–C6 match | None; this is the conservative catch-all | Preserve existing exactly |

## Severity Decision Table

| Supported claim condition | Consequence class | Severity | Fallback? |
| --- | --- | --- | --- |
| Rule code `HTTP_SERVER_ERROR`, `HTTP_CLIENT_ERROR`, or `VISIBLE_ERROR_PAGE` | C1 | high | no |
| Rule code `EMPTY_PAGE_TITLE` | C2 | medium | no |
| Rule code `NO_PRIMARY_HEADINGS` | C3 | low | no |
| Security `PS_HTTP_DOCUMENT` + `misconfiguration` | C4 | medium | no |
| Security `PS_HSTS_NOT_OBSERVED` + `defense-in-depth-gap` | C5 | low | no |
| Security `PS_HSTS_NOT_ENFORCING` + `misconfiguration` | C5 | low | no |
| Security `PS_CSP_RESPONSE_HEADER_NOT_OBSERVED` or `PS_NOSNIFF_NOT_ENFORCING` + `defense-in-depth-gap` | C5 | low | no |
| Security `PS_FRAME_POLICY_NOT_OBSERVED` or `PS_TECHNOLOGY_DISCLOSURE` + `informational` | C6 | info | no |
| Anything else, including `HTTP_STATUS_UNKNOWN` and all unclassified model/technical mechanisms | C7 | preserve existing exactly | yes |

## Invariants

1. Same supported consequence with different evidence source produces the same severity.
2. Same supported consequence with different verification state produces the same severity.
3. Same supported consequence with one, four, or twenty observed pages produces the same severity.
4. Observed directly, Seen in browser data, and AI analysis only never drive severity.
5. Confirmed issue, Confirmed observation, and Needs human review never drive severity.
6. Possible issue, Technical note, and Security note never act as severity shortcuts.
7. Strong screenshot evidence does not escalate a limited consequence; AI-only evidence does not downgrade a fallback-preserved material claim.
8. Severity cannot alter finding/technical identity, fingerprints, grouping, occurrences, evidence association, verification, eligibility, counts, Type, Evidence source, or Assessment.
9. Policy output preserves the family's existing vocabulary; no cross-family conversion or new level exists.
10. Policy and fallback operate only on report-owned copies and preserve item order/cardinality.

## Family Signal Sufficiency

| Family | Sufficiency | Reason |
| --- | --- | --- |
| User-facing Findings | Partially sufficient | Recognized deterministic page-rule codes support C1–C3. Model findings, presentation targets, accessibility facts, and technical presentation-resource identities do not encode consequence magnitude; those cases fall back. |
| Technical notes | Partially sufficient | A Technical note carrying a recognized deterministic page-rule code supports C1–C3. Console/CORS/DNS/ORB/aborted/resource mechanisms do not establish impact, so current severity is preserved. Existing DNS normalization occurs before this boundary. |
| Security notes | Sufficient for all current production rules; partial for future unknown codes | Current evaluator code/posture pairs populate C4–C6 deterministically. Unknown or inconsistent future pairs fall back rather than inheriting category assumptions. |

## Test Dimensions and Cardinalities

| Dimension | Finite values | Cardinality | Severity-driving? | Reason |
| --- | --- | ---: | --- | --- |
| Decision state | C1 material, C2 metadata, C3 structural, C4 transport, C5 defense gap, C6 security info, C7 insufficient | 7 | yes, except C7 invokes fallback | Exact decision-table partition. |
| Verification context | verified, inconclusive, not-applicable security observation | 3 | no | Proves assessment independence. |
| Evidence-source context | direct screenshot, browser data, AI-only | 3 | no | Proves provenance independence. |
| Breadth | one page, many pages | 2 | no | Proves observation-frequency independence. |
| Human item Type | Possible issue, Technical note, Security note | 3 | no | Proves type independence and family routing. |
| Existing severity | high, medium, low, info | 4 | fallback only | Proves override and exact fallback across both vocabularies. |

Full unconstrained Cartesian product: `7 × 3 × 3 × 2 × 3 × 4 = 1,512`.

Logical constraints: Security notes use not-applicable verification, browser data, and `medium|low|info`; unified items use `high|medium|low`. AI-only cannot be verified. Current Technical notes are browser-data items. C4–C6 require Security note; C1–C3 require a unified item; C7 can occur in every family subject to vocabulary/source constraints.

## Golden Matrix Coverage Method

Coverage method: **pairwise + mandatory boundary/invariance** because 1,512 exceeds 24.

A temporary read-only exhaustive enumerator generated 174 logically valid combinations and 142 valid cross-dimension value-pair obligations under the stated constraints. Greedy set cover with tie exploration selected the 24 rows below; a separate exhaustive pass over the fixed rows reported zero uncovered valid pairs.

Pairwise coverage achieved: **yes**. Golden cases: **24**.

The matrix covers both reachable current producer states and synthetic conformance/invariance states. Some golden cases intentionally supply an existing severity that current authoritative producers would not emit for the corresponding deterministic condition. Those cases specify future policy invariance and conformance behavior; they are not evidence of an existing production severity defect.

Invalid/excluded pairs are exactly those implied by the logical constraints above: security consequence with non-security Type; finding consequence with Security note; Security note with verified/inconclusive, direct/AI-only, or high; unified Type with info; Technical note with direct/AI-only under the current projection; and verified with AI-only. Higher-order combinations are intentionally omitted because they introduce no additional policy branch and all valid two-way interactions plus mandatory invariants are covered.

## Golden Matrix

`V` = verified, `I` = inconclusive, `N/A` = passive confirmed observation. “Direct” means focused screenshot; “Browser” means browser data. Expected severity capitalization is presentation only.

| ID | Type | Decision state / signal | Verification | Evidence | Breadth | Existing | Expected | Fallback | Primary invariant |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| G01 | Possible issue | C2 `EMPTY_PAGE_TITLE` | I | Browser | one | Low | Medium | no | Verification does not suppress C2. |
| G02 | Security note | C5 CSP/nosniff gap | N/A | Browser | many | Medium | Low | no | Breadth/category do not escalate. |
| G03 | Possible issue | C3 `NO_PRIMARY_HEADINGS` | V | Direct | many | High | Low | no | Strong evidence/high breadth do not escalate limited consequence. |
| G04 | Technical note | C1 `HTTP_CLIENT_ERROR` | V | Browser | one | Medium | High | no | Consequence overrides existing/type. |
| G05 | Possible issue | C7 no approved signal | I | AI-only | many | Medium | Medium | yes | AI/breadth preserve fallback exactly. |
| G06 | Security note | C7 unknown security code | N/A | Browser | one | Info | Info | yes | Security fallback preserves Info. |
| G07 | Security note | C4 HTTP document | N/A | Browser | many | Low | Medium | no | Transport consequence overrides Low. |
| G08 | Technical note | C2 `EMPTY_PAGE_TITLE` | I | Browser | many | High | Medium | no | Type/verification/breadth independence. |
| G09 | Possible issue | C1 `VISIBLE_ERROR_PAGE` | I | Direct | one | Low | High | no | Inconclusive does not lower material consequence. |
| G10 | Technical note | C3 `NO_PRIMARY_HEADINGS` | I | Browser | one | Low | Low | no | Technical/inconclusive does not raise C3. |
| G11 | Security note | C6 technology disclosure | N/A | Browser | many | Info | Info | no | Security is not automatically severe. |
| G12 | Possible issue | C7 no approved signal | V | Direct | one | Low | Low | yes | Direct/verified evidence does not raise fallback. |
| G13 | Possible issue | C2 `EMPTY_PAGE_TITLE` | V | Direct | many | Medium | Medium | no | C2 invariant across assessment/evidence/breadth. |
| G14 | Possible issue | C7 prose claims material impact, no approved signal | I | AI-only | one | High | High | yes | Weak evidence does not downgrade exact High fallback. |
| G15 | Security note | C6 frame-policy information | N/A | Browser | one | Medium | Info | no | Informational posture overrides Medium. |
| G16 | Security note | C5 HSTS/CSP gap | N/A | Browser | one | Low | Low | no | Security category alone adds nothing. |
| G17 | Possible issue | C1 `HTTP_SERVER_ERROR` | I | Browser | many | High | High | no | Same material class despite I/many. |
| G18 | Security note | C4 HTTP document | N/A | Browser | one | Info | Medium | no | C4 is not forced to Info by existing value. |
| G19 | Security note | C6 frame-policy information | N/A | Browser | one | Low | Info | no | Security Type does not impose Low. |
| G20 | Technical note | C3 `NO_PRIMARY_HEADINGS` | V | Browser | many | Medium | Low | no | Verified Technical note does not escalate. |
| G21 | Security note | C5 HSTS not enforcing | N/A | Browser | one | Info | Low | no | Misconfiguration code/posture, not Type, drives Low. |
| G22 | Security note | C4 HTTP document | N/A | Browser | one | Medium | Medium | no | Stable C4 baseline. |
| G23 | Technical note | C7 unclassified runtime diagnostic | V | Browser | many | Low | Low | yes | Browser/verified/high breadth preserve fallback. |
| G24 | Possible issue | C7 no approved signal | I | AI-only | one | Low | Low | yes | Completes direct/browser/AI Low invariance with G12/G23. |

Mandatory cases map as follows: verified versus inconclusive (G04/G09/G17); direct/browser/AI-only same C7+Low outcome (G12/G23/G24); one versus many (multiple C1–C6 pairs); direct limited consequence (G03); AI-only material prose with High fallback (G14); verified Technical note (G20); broad limited consequence (G03/G20); presentation versus diagnostic may differ only by C1 versus C7 (G17/G23); fallback gate/exactness (G05/G06/G12/G14/G23/G24); unchanged verification/Evidence/Assessment/Type is asserted for every row; and non-assumptive security behavior is covered by G02/G06/G07/G11/G15/G16/G18/G19/G21/G22.

## Current-Item Sanity Checks

These are paper-only applications to existing deterministic fixtures, not policy rules.

| Existing item | Current | Approved structured signals | Class | Proposed | Fallback? | Reason |
| --- | --- | --- | --- | --- | --- | --- |
| Placeholder/localization-like visible text | Low | No deterministic rule code | C7 | Low | yes | Category, screenshot, and wording cannot encode consequence. |
| Poster-image resource failure | Medium | Console identity/resource 404 only; no approved rule code | C7 | Medium | yes | Presentation-resource classification establishes Type, not impact magnitude. |
| Invalid SVG attribute observation | Low | Console identity only | C7 | Low | yes | Message prose cannot drive severity. |
| Cross-origin DNS observation | Low | Failed-request/DNS/origin identity only | C7 | Low | yes | Mechanism and observer attribution do not establish user consequence. |
| CORS observation | Low | CORS identity only | C7 | Low | yes | CORS mechanism does not establish functionality impact. |
| Passive HSTS-not-observed production rule | Low | `PS_HSTS_NOT_OBSERVED` + `defense-in-depth-gap` | C5 | Low | no | Exact current passive rule is deterministically covered. |
| Model-only finding (`Finding 1` fixture) | Medium | No approved code; AI-only model evidence | C7 | Medium | yes | Model severity is preserved, not trusted as a deterministic driver. |

The result is intentionally conservative: most current model/technical examples remain unchanged because CheckQuest does not yet store structured consequence magnitude for them.

## Proposed SeverityPolicyInput

Deferred future implementation boundary if Phase 5B.2 is ever reauthorized; do not add it to production code under the current decision:

```ts
type SeverityPolicyInput =
  | {
      sourceFamily: 'unified-finding';
      existingSeverity: FindingSeverity;
      deterministicRuleCode: ExistingPageFindingCode | null;
    }
  | {
      sourceFamily: 'passive-security';
      existingSeverity: PassiveSecuritySeverity;
      securityCode: PassiveSecurityObservation['code'];
      securityPosture: PassiveSecurityPosture;
    };
```

`sourceFamily` is routing-only and `existingSeverity` is fallback-only. The only severity-driving fields are `deterministicRuleCode`, `securityCode`, and `securityPosture`.

Any future implementation must preserve `implementation inputs ⊆ approved severity signals`; it must not broaden this boundary to accept a whole finding, report, or observation object.

Explicitly forbidden inputs: whole finding/report/observation objects; category; verification; evidence arrays/source/kind/relation/capability; confidence; occurrences/page count; title/description/reasoning/evidence/remediation/model wording; page/resource URL or hostname; technical identity/kind/resource type/origin relation/failure/status; targets; accessibility prose/facts as a driver; screenshot/presentation data; fingerprint/reference/display ID; artifact path/name; summaries/counts/ranking; and raw model severity separate from `existingSeverity`.

## 5B.2 Static Conformance Contract

If separately reauthorized, Phase 5B.2 would use a pure function accepting only `Readonly<SeverityPolicyInput>` and returning `{ severity, basis: 'policy' | 'fallback' }`. Call sites would construct object literals with `satisfies SeverityPolicyInput`; no object spread, `any`, type assertion, or whole-object parameter would be allowed at the policy boundary.

A future bounded deterministic conformance test would:

1. Assert the exact discriminated-union keys shown above and the exact known decision-table code lists.
2. Assert the policy module has one exported decision function and reads only those keys (a bounded source/interface check, not repository-wide data-flow analysis).
3. Assert the rule-code extractor accepts one unique recognized code when all internally tagged `page-finding` raw sources are recognized and resolve to that code, whether present once or repeated, and returns `null` for missing, conflicting, unknown, malformed, model, technical-identity-only, or fingerprint-only inputs.
4. Assert policy calls occur only in the report-assembly severity adapter.
5. Snapshot all non-severity fields before/after and prove item cardinality/canonical order, verification, evidence, identity, grouping, Type/Evidence/Assessment projections, and schema version are unchanged; separately acknowledge any existing presentation tie-break response to changed severity.
6. Prove JSON canonical collections and Markdown consume the same calibrated values; raw compatibility fields remain explicitly non-authoritative.

This makes the mechanical rule `implementation fields read ⊆ approved policy input fields` locally reviewable without a general analyzer.

## Golden-Matrix Implementation Contract

If Phase 5B.2 is reauthorized, every approved golden case in this document would require a corresponding deterministic executable test.

That future work could not drop, merge without proof, substitute “similar” examples, or silently change expected severity. If implementation exposed a matrix flaw, this document would need revision and review before code continued.

## New-Report-Only Scope

If separately reauthorized and implemented, this policy would apply only during generation of new reports after that implementation.

Historical report packages would remain unchanged. No migration, historical artifact editing, old-run normalization, repair tool, backfill, bulk rerun, or schema-version change is designed. Only newly assembled canonical severity scalars and their newly derived summaries could differ.

## Audit Accomplishments

The audit established:

- where severity authority currently lives;
- which structured fields are legitimate consequence signals;
- which tempting inputs must not drive severity;
- why verification, evidence, and breadth must remain independent;
- the safe fallback rule;
- a bounded future ownership point;
- a fail-closed deterministic provenance contract; and
- the conditions under which centralized implementation would become worthwhile.

No current blocker or failed audit is being recorded. Phase 5B is closed because the audited implementation would not improve current reachable report severity. Phase 5B.2 remains deferred unless a reconsideration trigger independently justifies reauthorization.
