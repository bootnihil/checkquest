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

function assertBestPolicyBand(
  name: string,
  links: NavigationLink[],
  inspectedUrls: string[],
  expectedPolicyBand:
    ReturnType<
      typeof buildNavigationPolicyWindow
    >['policyBand'],
  expectedPath: string
): ReturnType<
  typeof buildNavigationPolicyWindow
> {
  const policyWindow =
    createPolicyWindow(
      links,
      {
        inspectedUrls
      }
    ).window;

  assert.equal(
    policyWindow.policyBand,
    expectedPolicyBand,
    name
  );

  assert.equal(
    candidatePaths(
      policyWindow.candidates
    )[0],
    expectedPath,
    name
  );

  return policyWindow;
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
    'neutral-unseen-area'
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
    'neutral-unseen-route-family'
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
    'neutral-unseen-area'
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
    'neutral-unseen-route-family'
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
    'neutral-seen-route-family'
  );

  const neutralBeforeWeakUnseenArea =
    assertBestPolicyBand(
      'Neutral unseen area must beat weak unseen area.',
      [
        createLink(
          '/platform'
        ),
        createLink(
          '/blog'
        )
      ],
      [],
      'neutral-unseen-area',
      '/platform'
    );

  assert.deepEqual(
    neutralBeforeWeakUnseenArea
      .eligibleValueClassCounts,
    {
      neutral:
        1,
      'weak-low-value':
        1,
      'strong-low-value':
        0
    }
  );
  assert.equal(
    neutralBeforeWeakUnseenArea
      .deferredValueReasonCounts[
        'content-route-segment'
      ],
    1
  );

  assertBestPolicyBand(
    'Weak unseen area must beat neutral unseen route family.',
    [
      createLink(
        '/blog'
      ),
      createLink(
        '/known/new'
      )
    ],
    [
      'https://example.com/known/existing'
    ],
    'weak-low-value-unseen-area',
    '/blog'
  );

  assertBestPolicyBand(
    'Neutral unseen route family must beat weak unseen route family.',
    [
      createLink(
        '/known/new'
      ),
      createLink(
        '/known/blog'
      )
    ],
    [
      'https://example.com/known/existing'
    ],
    'neutral-unseen-route-family',
    '/known/new'
  );

  assertBestPolicyBand(
    'Weak unseen route family must beat neutral seen route family.',
    [
      createLink(
        '/known/blog'
      ),
      createLink(
        '/known/existing'
      )
    ],
    [
      'https://example.com/known/existing'
    ],
    'weak-low-value-unseen-route-family',
    '/known/blog'
  );

  assertBestPolicyBand(
    'Neutral seen route family must beat weak seen route family.',
    [
      createLink(
        '/known/existing'
      ),
      createLink(
        '/blog'
      )
    ],
    [
      'https://example.com/known/existing',
      'https://example.com/blog'
    ],
    'neutral-seen-route-family',
    '/known/existing'
  );

  const nonStrongBands = [
    {
      name:
        'neutral unseen area',
      links: [
        createLink(
          '/platform'
        ),
        createLink(
          '/privacy-policy'
        )
      ],
      inspectedUrls:
        [],
      expectedBand:
        'neutral-unseen-area' as const,
      expectedPath:
        '/platform'
    },
    {
      name:
        'weak unseen area',
      links: [
        createLink(
          '/blog'
        ),
        createLink(
          '/privacy-policy'
        )
      ],
      inspectedUrls:
        [],
      expectedBand:
        'weak-low-value-unseen-area' as const,
      expectedPath:
        '/blog'
    },
    {
      name:
        'neutral unseen route family',
      links: [
        createLink(
          '/known/new'
        ),
        createLink(
          '/privacy-policy'
        )
      ],
      inspectedUrls: [
        'https://example.com/known/existing'
      ],
      expectedBand:
        'neutral-unseen-route-family' as const,
      expectedPath:
        '/known/new'
    },
    {
      name:
        'weak unseen route family',
      links: [
        createLink(
          '/known/blog'
        ),
        createLink(
          '/privacy-policy'
        )
      ],
      inspectedUrls: [
        'https://example.com/known/existing'
      ],
      expectedBand:
        'weak-low-value-unseen-route-family' as const,
      expectedPath:
        '/known/blog'
    },
    {
      name:
        'neutral seen route family',
      links: [
        createLink(
          '/known/existing'
        ),
        createLink(
          '/privacy-policy'
        )
      ],
      inspectedUrls: [
        'https://example.com/known/existing'
      ],
      expectedBand:
        'neutral-seen-route-family' as const,
      expectedPath:
        '/known/existing'
    },
    {
      name:
        'weak seen route family',
      links: [
        createLink(
          '/blog'
        ),
        createLink(
          '/privacy-policy'
        )
      ],
      inspectedUrls: [
        'https://example.com/blog'
      ],
      expectedBand:
        'weak-low-value-seen-route-family' as const,
      expectedPath:
        '/blog'
    }
  ];

  for (
    const testCase of
      nonStrongBands
  ) {
    assertBestPolicyBand(
      `${testCase.name} must beat a strong-low-value unseen area.`,
      testCase.links,
      testCase.inspectedUrls,
      testCase.expectedBand,
      testCase.expectedPath
    );
  }

  assertBestPolicyBand(
    'Strong unseen area must beat strong unseen route family.',
    [
      createLink(
        '/privacy-policy'
      ),
      createLink(
        '/known/terms-of-use'
      )
    ],
    [
      'https://example.com/known/existing'
    ],
    'strong-low-value-unseen-area',
    '/privacy-policy'
  );

  assertBestPolicyBand(
    'Strong unseen route family must beat strong seen route family.',
    [
      createLink(
        '/known/terms-of-use'
      ),
      createLink(
        '/cookie-policy'
      )
    ],
    [
      'https://example.com/known/existing',
      'https://example.com/cookie-policy'
    ],
    'strong-low-value-unseen-route-family',
    '/known/terms-of-use'
  );

  const strongOnlyWindow =
    assertBestPolicyBand(
      'Strong-low-value routes must remain selectable when nothing better remains.',
      [
        createLink(
          '/privacy-policy'
        )
      ],
      [],
      'strong-low-value-unseen-area',
      '/privacy-policy'
    );

  assert.equal(
    strongOnlyWindow
      .candidates
      .length,
    1
  );
  assert.equal(
    strongOnlyWindow
      .candidates[0]
      .valueClass,
    'strong-low-value'
  );
  assert.deepEqual(
    strongOnlyWindow
      .candidates[0]
      .valueReasons,
    [
      'administrative-document-segment'
    ]
  );

  const weakAreaDiversity =
    createPolicyWindow(
      [
        ...Array.from(
          {
            length:
              25
          },
          (
            _unused,
            index
          ) =>
            createLink(
              `/blog/family-${index}`
            )
        ),
        createLink(
          '/news'
        )
      ],
      {
        remainingPages:
          2,
        remainingDecisions:
          2
      }
    ).window;

  assert.equal(
    weakAreaDiversity
      .policyBand,
    'weak-low-value-unseen-area'
  );
  assert.equal(
    weakAreaDiversity
      .areaBreadthConstrained,
    true
  );
  assert.deepEqual(
    new Set(
      weakAreaDiversity
        .candidates
        .map(
          candidate =>
            candidate
              .predictedIdentity
              .areaKey
        )
    ),
    new Set([
      'blog',
      'news'
    ])
  );
  assert.ok(
    weakAreaDiversity
      .candidates
      .length <=
      20
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
    'All Stage 6.2 navigation policy checks passed.'
  );
}

main().catch(
  error => {
    console.error(
      'Stage 6.2 navigation policy check failed.'
    );
    console.error(
      error
    );
    process.exitCode =
      1;
  }
);
