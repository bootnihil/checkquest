import type {
  NavigationLink
} from '../browser/inspect-navigation';

import {
  buildNoveltyCandidateWindow,
  type NavigationNoveltyTier,
  type NoveltyNavigationCandidate,
  type PageNoveltyState
} from './page-novelty';

import {
  isNavigationUrlEligible,
  normalizeUrlForComparison,
  type NavigationUrlState
} from './visited-links';

export const maximumNavigationCandidateWindow =
  20;

export interface NavigationFrontierEntry {
  link: NavigationLink;
  firstDiscoveryOrder: number;
  firstDiscoveredFromUrl: string;
  minimumDiscoveryDepth: number;
  minimumDepthDiscoveredFromUrl: string;
}

export interface NavigationFrontier {
  entries: Map<string, NavigationFrontierEntry>;
  nextDiscoveryOrder: number;
}

export interface NavigationBudgetContext {
  remainingPageSlots: number;
  remainingNavigationDecisionSlots: number;
  remainingPotentialInspections: number;
}

export interface NavigationPolicyCandidate
  extends NoveltyNavigationCandidate {
  firstDiscoveryOrder: number;
  firstDiscoveredFromUrl: string;
  minimumDiscoveryDepth: number;
  minimumDepthDiscoveredFromUrl: string;
  policyBand: NavigationNoveltyTier;
  policyReason: string;
}

export interface NavigationPolicyWindow {
  policyBand: NavigationNoveltyTier | null;
  candidates: NavigationPolicyCandidate[];
  budget: NavigationBudgetContext;
  areaBreadthConstrained: boolean;
}

export interface BuildNavigationPolicyWindowInput {
  frontier: NavigationFrontier;
  urlState: NavigationUrlState;
  pageNoveltyState: PageNoveltyState;
  budget: NavigationBudgetContext;
  maximumCandidates?: number;
}

export function createNavigationFrontier():
  NavigationFrontier {
  return {
    entries:
      new Map(),

    nextDiscoveryOrder:
      0
  };
}

export function registerDiscoveredNavigationLinks(
  frontier: NavigationFrontier,
  links: NavigationLink[],
  discoveredFromUrl: string,
  sourcePageDepth: number
): number {
  if (
    !Number.isInteger(
      sourcePageDepth
    ) ||
    sourcePageDepth <
      0
  ) {
    throw new Error(
      `sourcePageDepth must be a non-negative integer. Received: ${sourcePageDepth}.`
    );
  }

  const normalizedSourceUrl =
    normalizeUrlForComparison(
      discoveredFromUrl
    );

  const discoveryDepth =
    sourcePageDepth +
    1;

  let addedCount =
    0;

  for (
    const link of
      links
  ) {
    const normalizedUrl =
      normalizeUrlForComparison(
        link.url
      );

    const existingEntry =
      frontier
        .entries
        .get(
          normalizedUrl
        );

    if (
      existingEntry
    ) {
      if (
        discoveryDepth <
          existingEntry
            .minimumDiscoveryDepth
      ) {
        existingEntry
          .minimumDiscoveryDepth =
            discoveryDepth;

        existingEntry
          .minimumDepthDiscoveredFromUrl =
            normalizedSourceUrl;
      }

      continue;
    }

    frontier
      .entries
      .set(
        normalizedUrl,
        {
          link,
          firstDiscoveryOrder:
            frontier
              .nextDiscoveryOrder,
          firstDiscoveredFromUrl:
            normalizedSourceUrl,
          minimumDiscoveryDepth:
            discoveryDepth,
          minimumDepthDiscoveredFromUrl:
            normalizedSourceUrl
        }
      );

    frontier
      .nextDiscoveryOrder +=
        1;

    addedCount +=
      1;
  }

  return addedCount;
}

export function getNavigationFrontierEntries(
  frontier: NavigationFrontier
): NavigationFrontierEntry[] {
  return Array.from(
    frontier
      .entries
      .values()
  )
    .sort(
      (
        left,
        right
      ) =>
        left.firstDiscoveryOrder -
        right.firstDiscoveryOrder
    );
}

export function createNavigationBudgetContext(
  maxPages: number,
  fullyInspectedPageCount: number,
  maxNavigationDecisions: number,
  consumedNavigationDecisionCount: number
): NavigationBudgetContext {
  const remainingPageSlots =
    Math.max(
      0,
      maxPages -
        fullyInspectedPageCount
    );

  const remainingNavigationDecisionSlots =
    Math.max(
      0,
      maxNavigationDecisions -
        consumedNavigationDecisionCount
    );

  return {
    remainingPageSlots,
    remainingNavigationDecisionSlots,
    remainingPotentialInspections:
      Math.min(
        remainingPageSlots,
        remainingNavigationDecisionSlots
      )
  };
}

export function consumeNavigationDecision(
  maxNavigationDecisions: number,
  consumedNavigationDecisionCount: number
): number {
  if (
    !Number.isInteger(
      maxNavigationDecisions
    ) ||
    maxNavigationDecisions <
      1
  ) {
    throw new Error(
      `maxNavigationDecisions must be a positive integer. Received: ${maxNavigationDecisions}.`
    );
  }

  if (
    !Number.isInteger(
      consumedNavigationDecisionCount
    ) ||
    consumedNavigationDecisionCount <
      0
  ) {
    throw new Error(
      `consumedNavigationDecisionCount must be a non-negative integer. Received: ${consumedNavigationDecisionCount}.`
    );
  }

  if (
    consumedNavigationDecisionCount >=
      maxNavigationDecisions
  ) {
    throw new Error(
      `No navigation-decision slots remain (${consumedNavigationDecisionCount}/${maxNavigationDecisions}).`
    );
  }

  return (
    consumedNavigationDecisionCount +
    1
  );
}

function comparePolicyCandidates(
  left: NavigationPolicyCandidate,
  right: NavigationPolicyCandidate
): number {
  const areaVisitDifference =
    left.areaVisitCount -
    right.areaVisitCount;

  if (
    areaVisitDifference !==
    0
  ) {
    return areaVisitDifference;
  }

  const familyVisitDifference =
    left.routeFamilyVisitCount -
    right.routeFamilyVisitCount;

  if (
    familyVisitDifference !==
    0
  ) {
    return familyVisitDifference;
  }

  const templateVisitDifference =
    left.observedTemplateVisitCount -
    right.observedTemplateVisitCount;

  if (
    templateVisitDifference !==
    0
  ) {
    return templateVisitDifference;
  }

  const depthDifference =
    left.minimumDiscoveryDepth -
    right.minimumDiscoveryDepth;

  if (
    depthDifference !==
    0
  ) {
    return depthDifference;
  }

  return (
    left.firstDiscoveryOrder -
    right.firstDiscoveryOrder
  );
}

function buildAreaQueue(
  candidates: NavigationPolicyCandidate[]
): NavigationPolicyCandidate[] {
  const familyQueues =
    new Map<
      string,
      NavigationPolicyCandidate[]
    >();

  for (
    const candidate of
      candidates
  ) {
    const familyKey =
      candidate
        .predictedIdentity
        .routeFamilyKey;

    const familyQueue =
      familyQueues.get(
        familyKey
      ) ??
      [];

    familyQueue.push(
      candidate
    );

    familyQueues.set(
      familyKey,
      familyQueue
    );
  }

  const orderedFamilyQueues =
    Array.from(
      familyQueues.values()
    )
      .map(
        familyQueue =>
          familyQueue.sort(
            comparePolicyCandidates
          )
      )
      .sort(
        (
          left,
          right
        ) =>
          comparePolicyCandidates(
            left[0],
            right[0]
          )
      );

  const areaQueue:
    NavigationPolicyCandidate[] =
      [];

  let familyOffset =
    0;

  while (
    true
  ) {
    let addedInRound =
      false;

    for (
      const familyQueue of
        orderedFamilyQueues
    ) {
      const candidate =
        familyQueue[
          familyOffset
        ];

      if (
        !candidate
      ) {
        continue;
      }

      areaQueue.push(
        candidate
      );

      addedInRound =
        true;
    }

    if (
      !addedInRound
    ) {
      break;
    }

    familyOffset +=
      1;
  }

  return areaQueue;
}

export function buildNavigationPolicyWindow(
  input: BuildNavigationPolicyWindowInput
): NavigationPolicyWindow {
  const requestedMaximum =
    input.maximumCandidates ??
    maximumNavigationCandidateWindow;

  const maximumCandidates =
    Math.max(
      0,
      Math.min(
        maximumNavigationCandidateWindow,
        requestedMaximum
      )
    );

  if (
    maximumCandidates ===
      0 ||
    input
      .budget
      .remainingPageSlots ===
      0 ||
    input
      .budget
      .remainingNavigationDecisionSlots ===
      0
  ) {
    return {
      policyBand:
        null,
      candidates:
        [],
      budget:
        input.budget,
      areaBreadthConstrained:
        false
    };
  }

  const frontierEntries =
    getNavigationFrontierEntries(
      input.frontier
    );

  const eligibleEntries =
    frontierEntries.filter(
      entry =>
        isNavigationUrlEligible(
          input.urlState,
          entry.link.url
        )
    );

  if (
    eligibleEntries.length ===
    0
  ) {
    return {
      policyBand:
        null,
      candidates:
        [],
      budget:
        input.budget,
      areaBreadthConstrained:
        false
    };
  }

  /*
   * Stage 2 remains authoritative for dynamic area/family prediction and
   * novelty counts. Asking for every eligible candidate here avoids freezing
   * a stale classification before Stage 6 applies its own bounded window.
   */
  const noveltyCandidates =
    buildNoveltyCandidateWindow(
      eligibleEntries.map(
        entry =>
          entry.link
      ),
      frontierEntries.map(
        entry =>
          entry.link
      ),
      input.pageNoveltyState,
      eligibleEntries.length
    );

  const policyBand =
    noveltyCandidates[0]
      ?.noveltyTier ??
    null;

  if (
    policyBand ===
    null
  ) {
    return {
      policyBand,
      candidates:
        [],
      budget:
        input.budget,
      areaBreadthConstrained:
        false
    };
  }

  const entriesByUrl =
    new Map(
      eligibleEntries.map(
        entry => [
          normalizeUrlForComparison(
            entry.link.url
          ),
          entry
        ]
      )
    );

  const bandCandidates =
    noveltyCandidates
      .filter(
        candidate =>
          candidate.noveltyTier ===
          policyBand
      )
      .map(
        candidate => {
          const frontierEntry =
            entriesByUrl.get(
              normalizeUrlForComparison(
                candidate.link.url
              )
            );

          if (
            !frontierEntry
          ) {
            throw new Error(
              `Navigation frontier metadata is missing for ${candidate.link.url}.`
            );
          }

          return {
            ...candidate,
            firstDiscoveryOrder:
              frontierEntry
                .firstDiscoveryOrder,
            firstDiscoveredFromUrl:
              frontierEntry
                .firstDiscoveredFromUrl,
            minimumDiscoveryDepth:
              frontierEntry
                .minimumDiscoveryDepth,
            minimumDepthDiscoveredFromUrl:
              frontierEntry
                .minimumDepthDiscoveredFromUrl,
            policyBand,
            policyReason:
              `Highest eligible Stage 6.1 novelty band: ${policyBand}; area-diversified before route-family repetition.`
          };
        }
      );

  const candidatesByArea =
    new Map<
      string,
      NavigationPolicyCandidate[]
    >();

  for (
    const candidate of
      bandCandidates
  ) {
    const areaKey =
      candidate
        .predictedIdentity
        .areaKey;

    const areaCandidates =
      candidatesByArea.get(
        areaKey
      ) ??
      [];

    areaCandidates.push(
      candidate
    );

    candidatesByArea.set(
      areaKey,
      areaCandidates
    );
  }

  const orderedAreaQueues =
    Array.from(
      candidatesByArea.values()
    )
      .map(
        areaCandidates =>
          buildAreaQueue(
            areaCandidates
          )
      )
      .sort(
        (
          left,
          right
        ) =>
          comparePolicyCandidates(
            left[0],
            right[0]
          )
      );

  const areaBreadthConstrained =
    orderedAreaQueues.length >
      1 &&
    input
      .budget
      .remainingPotentialInspections <=
      orderedAreaQueues.length;

  const selected:
    NavigationPolicyCandidate[] =
      [];

  let areaOffset =
    0;

  while (
    selected.length <
      maximumCandidates
  ) {
    let addedInRound =
      false;

    for (
      const areaQueue of
        orderedAreaQueues
    ) {
      const candidate =
        areaQueue[
          areaOffset
        ];

      if (
        !candidate
      ) {
        continue;
      }

      selected.push({
        ...candidate,
        policyReason:
          areaBreadthConstrained
            ? `${candidate.policyReason} Remaining budget restricts this window to one candidate per area.`
            : candidate.policyReason
      });

      addedInRound =
        true;

      if (
        selected.length >=
          maximumCandidates
      ) {
        break;
      }
    }

    if (
      !addedInRound ||
      areaBreadthConstrained
    ) {
      break;
    }

    areaOffset +=
      1;
  }

  return {
    policyBand,
    candidates:
      selected,
    budget:
      input.budget,
    areaBreadthConstrained
  };
}
