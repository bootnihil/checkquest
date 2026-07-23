import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

import type {
  ExtractedPageContent
} from './browser/extract-page-content';

import {
  inspectNavigation,
  type NavigationLink
} from './browser/inspect-navigation';

import {
  applyAgentRunOptions,
  parseAgentRunOptions
} from './config/agent-run-options';

import type {
  SiteConfig
} from './config/site-config';

import {
  buildNoveltyCandidateWindow,
  createObservedTemplateKey,
  createPageNoveltyState,
  predictPageIdentity,
  registerInspectedPageNovelty,
  registerPredictedPageIdentity
} from './exploration/page-novelty';

import {
  getUnvisitedLinks,
  markUrlVisited,
  normalizeUrlForComparison
} from './exploration/visited-links';

function createLink(
  path: string,
  text = path
): NavigationLink {
  return {
    text,
    url:
      new URL(
        path,
        'https://example.com/'
      )
        .toString()
  };
}

function createPageContent(
  options: {
    title: string;
    headings: string[];
    links: number;
    buttons: string[];
    textFieldTypes?: string[];
    selectOptionCounts?: number[];
  }
): ExtractedPageContent {
  return {
    title:
      options.title,

    headings:
      options.headings,

    bodyText:
      `Page-specific body content for ${options.title}.`,

    links:
      Array.from(
        {
          length:
            options.links
        },
        (
          _unused,
          index
        ) => ({
          text:
            `Link ${index + 1}`,
          url:
            `https://example.com/link-${index + 1}`
        })
      ),

    buttons:
      options.buttons,

    textFields:
      (
        options.textFieldTypes ??
        []
      )
        .map(
          (
            inputType,
            index
          ) => ({
            tagName:
              'input' as const,
            inputType,
            label:
              `Field ${index + 1}`,
            name:
              `field-${index + 1}`,
            id:
              `field-${index + 1}`,
            placeholder:
              `Enter ${index + 1}`,
            required:
              false,
            disabled:
              false,
            readOnly:
              false,
            value:
              `different-value-${index + 1}`,
            valid:
              true,
            validationMessage:
              null,
            ariaInvalid:
              null
          })
        ),

    selects:
      (
        options.selectOptionCounts ??
        []
      )
        .map(
          (
            totalOptions,
            index
          ) => ({
            label:
              `Select ${index + 1}`,
            name:
              `select-${index + 1}`,
            id:
              `select-${index + 1}`,
            required:
              false,
            disabled:
              false,
            totalOptions,
            optionsTruncated:
              false,
            options:
              []
          })
        ),

    disclosures:
      []
  };
}

async function main():
  Promise<void> {
  /*
   * Exact URL identity remains controlled by the existing URL
   * normalization and visited-link helpers.
   */
  assert.equal(
    normalizeUrlForComparison(
      'https://example.com/articles/'
    ),
    'https://example.com/articles'
  );

  assert.equal(
    normalizeUrlForComparison(
      'https://example.com/articles#latest'
    ),
    'https://example.com/articles'
  );

  const visitedUrls =
    new Set<string>();

  markUrlVisited(
    visitedUrls,
    'https://example.com/articles/'
  );

  assert.deepEqual(
    getUnvisitedLinks(
      [
        createLink(
          '/articles'
        ),
        createLink(
          '/pricing'
        )
      ],
      visitedUrls
    )
      .map(
        link =>
          new URL(
            link.url
          )
            .pathname
      ),
    [
      '/pricing'
    ]
  );

  const articleLinks = [
    createLink(
      '/articles/how-clinical-ai-improves-workflows'
    ),
    createLink(
      '/articles/building-safer-diagnostic-systems'
    ),
    createLink(
      '/articles/introducing-the-new-imaging-platform'
    )
  ];

  const articleFamilyKeys =
    articleLinks.map(
      link =>
        predictPageIdentity(
          link.url,
          articleLinks
        )
          .routeFamilyKey
    );

  assert.equal(
    new Set(
      articleFamilyKeys
    )
      .size,
    1
  );

  assert.equal(
    articleFamilyKeys[0],
    '/articles/:detail'
  );

  const rootFunctionalLinks = [
    createLink(
      '/pricing'
    ),
    createLink(
      '/contact'
    ),
    createLink(
      '/login'
    )
  ];

  assert.deepEqual(
    rootFunctionalLinks.map(
      link =>
        predictPageIdentity(
          link.url,
          rootFunctionalLinks
        )
          .routeFamilyKey
    ),
    [
      '/pricing',
      '/contact',
      '/login'
    ]
  );

  const unseenAreaState =
    createPageNoveltyState();

  registerPredictedPageIdentity(
    unseenAreaState,
    predictPageIdentity(
      articleLinks[0].url,
      articleLinks
    )
  );

  const unseenAreaWindow =
    buildNoveltyCandidateWindow(
      [
        articleLinks[1],
        createLink(
          '/pricing'
        )
      ],
      [
        ...articleLinks,
        createLink(
          '/pricing'
        )
      ],
      unseenAreaState
    );

  assert.equal(
    new URL(
      unseenAreaWindow[0]
        .link
        .url
    )
      .pathname,
    '/pricing'
  );

  assert.equal(
    unseenAreaWindow[0]
      .noveltyTier,
    'unseen-area'
  );

  const resourceLinks = [
    createLink(
      '/resources/articles/how-teams-adopt-clinical-ai'
    ),
    createLink(
      '/resources/articles/building-modern-care-workflows'
    ),
    createLink(
      '/resources/articles/measuring-impact-across-hospitals'
    ),
    createLink(
      '/resources/webinars/upcoming-events'
    )
  ];

  const knownAreaState =
    createPageNoveltyState();

  registerPredictedPageIdentity(
    knownAreaState,
    predictPageIdentity(
      resourceLinks[0].url,
      resourceLinks
    )
  );

  const knownAreaWindow =
    buildNoveltyCandidateWindow(
      [
        resourceLinks[1],
        resourceLinks[3]
      ],
      resourceLinks,
      knownAreaState
    );

  assert.equal(
    new URL(
      knownAreaWindow[0]
        .link
        .url
    )
      .pathname,
    '/resources/webinars/upcoming-events'
  );

  assert.equal(
    knownAreaWindow[0]
      .noveltyTier,
    'unseen-route-family'
  );

  const browser =
    await chromium.launch({
      headless:
        true
    });

  try {
    const page =
      await browser.newPage();

    const articleMarkup =
      Array.from(
        {
          length:
            27
        },
        (
          _unused,
          index
        ) =>
          `<a href="https://example.com/articles/long-form-article-number-${index + 1}">Article ${index + 1}</a>`
      )
        .join('');

    await page.setContent(
      `<nav>${articleMarkup}<a href="https://example.com/pricing">Pricing</a><a href="https://example.com/contact">Contact</a><a href="https://example.com/login">Login</a></nav>`
    );

    const discoveredLinks =
      await inspectNavigation(
        page,
        [
          'example.com'
        ]
      );

    assert.equal(
      discoveredLinks.length,
      30
    );

    const diversifiedWindow =
      buildNoveltyCandidateWindow(
        discoveredLinks,
        discoveredLinks,
        createPageNoveltyState(),
        20
      );

    assert.equal(
      diversifiedWindow.length,
      20
    );

    const diversifiedPaths =
      diversifiedWindow.map(
        candidate =>
          new URL(
            candidate.link.url
          )
            .pathname
      );

    assert.ok(
      diversifiedPaths.includes(
        '/pricing'
      )
    );

    assert.ok(
      diversifiedPaths.includes(
        '/contact'
      )
    );

    assert.ok(
      diversifiedPaths.includes(
        '/login'
      )
    );

    assert.ok(
      diversifiedPaths.filter(
        path =>
          path.startsWith(
            '/articles/'
          )
      )
        .length <
        20
    );
  } finally {
    await browser.close();
  }

  const seenOnlyLinks = [
    createLink(
      '/pricing'
    ),
    createLink(
      '/contact'
    )
  ];

  const seenOnlyState =
    createPageNoveltyState();

  for (
    const link of
      seenOnlyLinks
  ) {
    registerPredictedPageIdentity(
      seenOnlyState,
      predictPageIdentity(
        link.url,
        seenOnlyLinks
      )
    );
  }

  const seenOnlyWindow =
    buildNoveltyCandidateWindow(
      seenOnlyLinks,
      seenOnlyLinks,
      seenOnlyState
    );

  assert.equal(
    seenOnlyWindow.length,
    2
  );

  assert.ok(
    seenOnlyWindow.every(
      candidate =>
        candidate.noveltyTier ===
        'seen-route-family'
    )
  );

  const contentPageA =
    createPageContent({
      title:
        'First article',
      headings: [
        'A different heading'
      ],
      links:
        8,
      buttons: [
        'Read more'
      ]
    });

  const contentPageB =
    createPageContent({
      title:
        'Second article',
      headings: [
        'Unrelated content'
      ],
      links:
        8,
      buttons: [
        'Continue'
      ]
    });

  assert.equal(
    createObservedTemplateKey(
      contentPageA
    ),
    createObservedTemplateKey(
      contentPageB
    )
  );

  const interactivePage =
    createPageContent({
      title:
        'Contact form',
      headings: [
        'Contact us'
      ],
      links:
        8,
      buttons: [
        'Continue'
      ],
      textFieldTypes: [
        'email'
      ],
      selectOptionCounts: [
        5
      ]
    });

  assert.notEqual(
    createObservedTemplateKey(
      contentPageA
    ),
    createObservedTemplateKey(
      interactivePage
    )
  );

  const structuralPriorityLinks = [
    createLink(
      '/articles/how-clinical-ai-improves-workflows'
    ),
    createLink(
      '/articles/building-safer-diagnostic-systems'
    ),
    createLink(
      '/articles/introducing-the-new-imaging-platform'
    ),
    createLink(
      '/news/how-clinical-ai-improves-workflows'
    ),
    createLink(
      '/news/building-safer-diagnostic-systems'
    ),
    createLink(
      '/news/introducing-the-new-imaging-platform'
    ),
    createLink(
      '/guides/how-clinical-ai-improves-workflows'
    ),
    createLink(
      '/guides/building-safer-diagnostic-systems'
    ),
    createLink(
      '/guides/introducing-the-new-imaging-platform'
    )
  ];

  const structuralPriorityState =
    createPageNoveltyState();

  registerInspectedPageNovelty(
    structuralPriorityState,
    predictPageIdentity(
      structuralPriorityLinks[0].url,
      structuralPriorityLinks
    ),
    contentPageA
  );

  registerInspectedPageNovelty(
    structuralPriorityState,
    predictPageIdentity(
      structuralPriorityLinks[3].url,
      structuralPriorityLinks
    ),
    contentPageB
  );

  registerInspectedPageNovelty(
    structuralPriorityState,
    predictPageIdentity(
      structuralPriorityLinks[6].url,
      structuralPriorityLinks
    ),
    interactivePage
  );

  const structuralPriorityWindow =
    buildNoveltyCandidateWindow(
      [
        structuralPriorityLinks[1],
        structuralPriorityLinks[7]
      ],
      structuralPriorityLinks,
      structuralPriorityState
    );

  assert.equal(
    new URL(
      structuralPriorityWindow[0]
        .link
        .url
    )
      .pathname,
    '/guides/building-safer-diagnostic-systems'
  );

  const baseSite:
    SiteConfig = {
    id:
      'bounded-check',
    name:
      'Bounded check',
    startUrl:
      'https://example.com/',
    allowedHosts: [
      'example.com'
    ],
    maxPages:
      3,
    maxAgentSteps:
      4,
    maxExploratoryStepsPerPage:
      0,
    allowFormSubmission:
      false
  };

  const boundedSite =
    applyAgentRunOptions(
      baseSite,
      parseAgentRunOptions([
        'bounded-check',
        '--pages',
        '2',
        '--navigation-steps',
        '1'
      ])
    );

  assert.equal(
    boundedSite.maxPages,
    2
  );

  assert.equal(
    boundedSite.maxAgentSteps,
    1
  );

  console.log(
    'All Stage 2 page novelty checks passed.'
  );
}

main().catch(
  (
    error:
      unknown
  ) => {
    console.error(
      'Stage 2 page novelty check failed:',
      error
    );

    process.exitCode =
      1;
  }
);
