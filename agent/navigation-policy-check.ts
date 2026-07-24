import assert from 'node:assert/strict';

import type {
  ExtractedPageContent
} from './browser/extract-page-content';
import type {
  NavigationLink
} from './browser/inspect-navigation';

import {
  buildNavigationPolicyWindow,
  consumeNavigationDecision,
  createNavigationBudgetContext,
  createNavigationFrontier,
  registerDiscoveredNavigationLinks
} from './exploration/navigation-policy';

import {
  createPageNoveltyState,
  predictPageIdentity,
  registerInspectedPageNovelty,
  registerPredictedPageIdentity
} from './exploration/page-novelty';

import {
  createNavigationUrlState,
  hasNavigationUrlBeenAttempted,
  markFinalUrlInspected,
  markNavigationUrlAttempted,
  recordNavigationResolution
} from './exploration/visited-links';

import {
  runPageInspectionSequence
} from './exploration/run-page-inspection-sequence';

function createLink(
  path: string
): NavigationLink {
  return {
    text:
      path,
    url:
      new URL(
        path,
        'https://example.com/'
      ).toString()
  };
}

function createEmptyPageContent(
  title: string
): ExtractedPageContent {
  return {
    title,
    headings:
      [],
    bodyText:
      title,
    links:
      [],
    buttons:
      [],
    textFields:
      [],
    selects:
      [],
    disclosures:
      [],
    tabs:
      []
  };
}

function candidatePaths(
  candidates:
    ReturnType<
      typeof buildNavigationPolicyWindow
    >['candidates']
): string[] {
  return candidates.map(
    candidate =>
      new URL(
        candidate.link.url
      ).pathname
  );
}

function createPolicyWindow(
  links: NavigationLink[],
  options: {
    inspectedUrls?: string[];
    remainingPages?: number;
    remainingDecisions?: number;
  } = {}
) {
  const frontier =
    createNavigationFrontier();

  registerDiscoveredNavigationLinks(
    frontier,
    links,
    'https://example.com/',
    0
  );

  const pageNoveltyState =
    createPageNoveltyState();

  for (
    const inspectedUrl of
      options.inspectedUrls ??
      []
  ) {
    registerPredictedPageIdentity(
      pageNoveltyState,
      predictPageIdentity(
        inspectedUrl,
        links
      )
    );
  }

  return {
    frontier,
    pageNoveltyState,
    urlState:
      createNavigationUrlState(),
    window:
      buildNavigationPolicyWindow({
        frontier,
        urlState:
          createNavigationUrlState(),
        pageNoveltyState,
        budget: {
          remainingPageSlots:
            options.remainingPages ??
            3,
          remainingNavigationDecisionSlots:
            options.remainingDecisions ??
            3,
          remainingPotentialInspections:
            Math.min(
              options.remainingPages ??
                3,
              options.remainingDecisions ??
                3
            )
        }
      })
  };
}

async function main():
  Promise<void> {
  const breadthLinks = [
    createLink(
      '/area-a'
    ),
    createLink(
      '/area-b'
    )
  ];

  const breadthFrontier =
    createNavigationFrontier();

  registerDiscoveredNavigationLinks(
    breadthFrontier,
    breadthLinks,
    'https://example.com/',
    0
  );

  registerDiscoveredNavigationLinks(
    breadthFrontier,
    [
      createLink(
        '/area-a/deeper'
      )
    ],
    'https://example.com/area-a',
    1
  );

  const breadthNoveltyState =
    createPageNoveltyState();

  registerPredictedPageIdentity(
    breadthNoveltyState,
    predictPageIdentity(
      'https://example.com/area-a',
      breadthLinks
    )
  );

  const breadthWindow =
    buildNavigationPolicyWindow({
      frontier:
        breadthFrontier,
      urlState:
        createNavigationUrlState(),
      pageNoveltyState:
        breadthNoveltyState,
      budget:
        createNavigationBudgetContext(
          3,
          2,
          3,
          1
        )
    });

  assert.equal(
    breadthWindow.policyBand,
    'unseen-area'
  );
  assert.deepEqual(
    candidatePaths(
      breadthWindow.candidates
    ),
    [
      '/area-b'
    ]
  );

  registerPredictedPageIdentity(
    breadthNoveltyState,
    predictPageIdentity(
      'https://example.com/area-b',
      breadthLinks
    )
  );

  const depthWindow =
    buildNavigationPolicyWindow({
      frontier:
        breadthFrontier,
      urlState:
        createNavigationUrlState(),
      pageNoveltyState:
        breadthNoveltyState,
      budget:
        createNavigationBudgetContext(
          4,
          3,
          4,
          2
        )
    });

  assert.equal(
    depthWindow.policyBand,
    'unseen-route-family'
  );
  assert.ok(
    candidatePaths(
      depthWindow.candidates
    ).includes(
      '/area-a/deeper'
    )
  );
  assert.equal(
    depthWindow
      .candidates
      .find(
        candidate =>
          new URL(
            candidate.link.url
          ).pathname ===
          '/area-a/deeper'
      )
      ?.minimumDiscoveryDepth,
    2
  );

  const manyAreaALinks =
    Array.from(
      {
        length:
          25
      },
      (
        _unused,
        index
      ) =>
        createLink(
          `/area-a/family-${String.fromCharCode(97 + index)}`
        )
    );

  const diversified =
    createPolicyWindow(
      [
        ...manyAreaALinks,
        createLink(
          '/area-b'
        )
      ],
      {
        inspectedUrls: [
          'https://example.com/'
        ],
        remainingPages:
          2,
        remainingDecisions:
          2
      }
    ).window;

  assert.equal(
    diversified
      .candidates
      .length,
    2
  );
  assert.equal(
    diversified
      .areaBreadthConstrained,
    true
  );
  assert.ok(
    candidatePaths(
      diversified.candidates
    ).includes(
      '/area-b'
    )
  );
  assert.ok(
    diversified
      .candidates
      .length <=
      20
  );

  const cappedWindow =
    createPolicyWindow(
      Array.from(
        {
          length:
            30
        },
        (
          _unused,
          index
        ) =>
          createLink(
            `/area-a/route-${index}`
          )
      ),
      {
        remainingPages:
          30,
        remainingDecisions:
          30
      }
    ).window;

  assert.equal(
    cappedWindow
      .candidates
      .length,
    20
  );

  const noveltyLinks = [
    createLink(
      '/known/existing'
    ),
    createLink(
      '/known/new-family'
    ),
    createLink(
      '/unseen'
    )
  ];

  const unseenArea =
    createPolicyWindow(
      noveltyLinks,
      {
        inspectedUrls: [
          'https://example.com/known/existing'
        ]
      }
    ).window;

  assert.equal(
    unseenArea.policyBand,
    'unseen-area'
  );
  assert.deepEqual(
    candidatePaths(
      unseenArea.candidates
    ),
    [
      '/unseen'
    ]
  );

  const unseenFamily =
    createPolicyWindow(
      noveltyLinks.slice(
        0,
        2
      ),
      {
        inspectedUrls: [
          'https://example.com/known/existing'
        ]
      }
    ).window;

  assert.equal(
    unseenFamily.policyBand,
    'unseen-route-family'
  );
  assert.deepEqual(
    candidatePaths(
      unseenFamily.candidates
    ),
    [
      '/known/new-family'
    ]
  );

  const seenFamily =
    createPolicyWindow(
      [
        createLink(
          '/known/existing'
        )
      ],
      {
        inspectedUrls: [
          'https://example.com/known/existing'
        ]
      }
    ).window;

  assert.equal(
    seenFamily.policyBand,
    'seen-route-family'
  );

  const attemptedFrontier =
    createNavigationFrontier();

  registerDiscoveredNavigationLinks(
    attemptedFrontier,
    [
      createLink(
        '/attempt-once'
      )
    ],
    'https://example.com/',
    0
  );

  const attemptedState =
    createNavigationUrlState();

  markNavigationUrlAttempted(
    attemptedState,
    'https://example.com/attempt-once'
  );

  assert.equal(
    hasNavigationUrlBeenAttempted(
      attemptedState,
      'https://example.com/attempt-once/'
    ),
    true
  );

  assert.equal(
    buildNavigationPolicyWindow({
      frontier:
        attemptedFrontier,
      urlState:
        attemptedState,
      pageNoveltyState:
        createPageNoveltyState(),
      budget:
        createNavigationBudgetContext(
          2,
          1,
          2,
          0
        )
    }).candidates.length,
    0
  );

  const aliasState =
    createNavigationUrlState();

  const aliasNoveltyState =
    createPageNoveltyState();

  markNavigationUrlAttempted(
    aliasState,
    'https://example.com/alias-a'
  );

  const firstAliasResolution =
    recordNavigationResolution(
      aliasState,
      'https://example.com/alias-a',
      'https://example.com/target'
    );

  assert.equal(
    firstAliasResolution
      .finalUrlAlreadyInspected,
    false
  );

  if (
    !firstAliasResolution
      .finalUrlAlreadyInspected
  ) {
    registerInspectedPageNovelty(
      aliasNoveltyState,
      predictPageIdentity(
        firstAliasResolution
          .finalUrl
      ),
      createEmptyPageContent(
        'Target'
      )
    );

    markFinalUrlInspected(
      aliasState,
      firstAliasResolution
        .finalUrl
    );
  }

  markNavigationUrlAttempted(
    aliasState,
    'https://example.com/alias-b'
  );

  const secondAliasResolution =
    recordNavigationResolution(
      aliasState,
      'https://example.com/alias-b',
      'https://example.com/target'
    );

  assert.equal(
    secondAliasResolution
      .finalUrlAlreadyInspected,
    true
  );

  assert.equal(
    aliasNoveltyState
      .areaVisitCounts
      .get(
        'target'
      ),
    1
  );
  assert.equal(
    Array.from(
      aliasNoveltyState
        .observedTemplateVisitCounts
        .values()
    ).reduce(
      (
        total,
        count
      ) =>
        total +
        count,
      0
    ),
    1
  );
  assert.equal(
    aliasState
      .requestedToFinalAliases
      .size,
    2
  );

  const redirectedIdentityState =
    createPageNoveltyState();

  const redirectedFinalUrl =
    recordNavigationResolution(
      createNavigationUrlState(),
      'https://example.com/requested-area/alias',
      'https://example.com/actual-area/page'
    ).finalUrl;

  registerInspectedPageNovelty(
    redirectedIdentityState,
    predictPageIdentity(
      redirectedFinalUrl
    ),
    createEmptyPageContent(
      'Redirected final'
    )
  );

  assert.equal(
    redirectedIdentityState
      .areaVisitCounts
      .get(
        'actual-area'
      ),
    1
  );
  assert.equal(
    redirectedIdentityState
      .areaVisitCounts
      .has(
        'requested-area'
      ),
    false
  );

  const startState =
    createNavigationUrlState();

  markNavigationUrlAttempted(
    startState,
    'https://example.com/start'
  );

  recordNavigationResolution(
    startState,
    'https://example.com/start',
    'https://example.com/'
  );

  markFinalUrlInspected(
    startState,
    'https://example.com/'
  );

  const startAliasResolution =
    recordNavigationResolution(
      startState,
      'https://example.com/home-alias',
      'https://example.com/'
    );

  assert.equal(
    startAliasResolution
      .finalUrlAlreadyInspected,
    true
  );

  const inspectedSequence =
    await runPageInspectionSequence({
      startPage: {
        id:
          'start',
        depth:
          0
      },
      maxPages:
        2,
      inspectPage:
        async page =>
          page,
      getNextPage:
        async inspectedPages => ({
          id:
            `page-${inspectedPages.length + 1}`,
          depth:
            inspectedPages.length
        })
    });

  assert.equal(
    inspectedSequence.length,
    2
  );
  assert.deepEqual(
    inspectedSequence[0],
    {
      id:
        'start',
      depth:
        0
    }
  );
  assert.equal(
    inspectedSequence.filter(
      page =>
        page.id ===
        'start'
    ).length,
    1
  );

  assert.deepEqual(
    createNavigationBudgetContext(
      5,
      4,
      2,
      0
    ),
    {
      remainingPageSlots:
        1,
      remainingNavigationDecisionSlots:
        2,
      remainingPotentialInspections:
        1
    }
  );

  let consumedDecisions =
    0;

  consumedDecisions =
    consumeNavigationDecision(
      2,
      consumedDecisions
    );

  const beforeFinalDecision =
    createNavigationBudgetContext(
      5,
      4,
      2,
      consumedDecisions
    );

  assert.equal(
    beforeFinalDecision
      .remainingNavigationDecisionSlots,
    1
  );

  /*
   * Production increments the consumed decision count immediately before
   * Gemini, so this same transition applies whether Gemini selects a link or
   * returns FINISH.
   */
  consumedDecisions =
    consumeNavigationDecision(
      2,
      consumedDecisions
    );

  const afterFinishDecision =
    createNavigationBudgetContext(
      5,
      4,
      2,
      consumedDecisions
    );

  assert.equal(
    afterFinishDecision
      .remainingNavigationDecisionSlots,
    0
  );
  assert.equal(
    afterFinishDecision
      .remainingPotentialInspections,
    0
  );
  assert.throws(
    () =>
      consumeNavigationDecision(
        2,
        consumedDecisions
      ),
    /No navigation-decision slots remain/
  );

  const rediscoveryFrontier =
    createNavigationFrontier();

  registerDiscoveredNavigationLinks(
    rediscoveryFrontier,
    [
      createLink(
        '/shared'
      )
    ],
    'https://example.com/deep/page',
    3
  );

  registerDiscoveredNavigationLinks(
    rediscoveryFrontier,
    [
      createLink(
        '/shared'
      )
    ],
    'https://example.com/shallow',
    1
  );

  const sharedEntry =
    Array.from(
      rediscoveryFrontier
        .entries
        .values()
    )[0];

  assert.equal(
    sharedEntry
      .firstDiscoveredFromUrl,
    'https://example.com/deep/page'
  );
  assert.equal(
    sharedEntry
      .minimumDiscoveryDepth,
    2
  );
  assert.equal(
    sharedEntry
      .minimumDepthDiscoveredFromUrl,
    'https://example.com/shallow'
  );

  console.log(
    'All Stage 6.1 navigation policy checks passed.'
  );
}

main().catch(
  error => {
    console.error(
      'Stage 6.1 navigation policy check failed.'
    );
    console.error(
      error
    );
    process.exitCode =
      1;
  }
);
