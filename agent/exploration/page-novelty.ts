import { createHash } from 'node:crypto';

import type { ExtractedPageContent } from '../browser/extracted-page-content';

import type { NavigationLink } from '../browser/inspect-navigation';

export interface PredictedPageIdentity {
  areaKey: string;
  routeFamilyKey: string;
}

export interface InspectedPageNovelty {
  predictedIdentity: PredictedPageIdentity;
  observedTemplateKey: string;
}

export type NavigationNoveltyTier = 'unseen-area' | 'unseen-route-family' | 'seen-route-family';

export interface NoveltyNavigationCandidate {
  link: NavigationLink;
  predictedIdentity: PredictedPageIdentity;
  noveltyTier: NavigationNoveltyTier;
  areaVisitCount: number;
  routeFamilyVisitCount: number;
  observedTemplateVisitCount: number;
}

export interface PageNoveltyState {
  areaVisitCounts: Map<string, number>;
  routeFamilyVisitCounts: Map<string, number>;
  observedTemplateVisitCounts: Map<string, number>;
  routeFamilyObservedTemplates: Map<string, Set<string>>;
}

interface RouteFamilyContext {
  repeatedSiblingParents: Set<string>;
}

const numericSegmentPattern = /^\d+$/;

const uuidSegmentPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const dateSegmentPattern = /^\d{4}(?:-\d{1,2}(?:-\d{1,2})?)?$/;

const opaqueSegmentPattern = /^(?=.{16,}$)(?=.*[a-z])(?=.*\d)[a-z\d]+$/i;

const detailSlugPattern = /^(?=.{12,}$)[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+){2,}$/u;

function normalizePathSegment(segment: string): string {
  let decodedSegment = segment;

  try {
    decodedSegment = decodeURIComponent(segment);
  } catch {
    /*
     * Keep the URL parser's encoded representation when a segment
     * cannot be decoded independently.
     */
  }

  return decodedSegment.normalize('NFKC').toLocaleLowerCase('en-US');
}

function isObviouslyVariableSegment(segment: string): boolean {
  return (
    numericSegmentPattern.test(segment) ||
    uuidSegmentPattern.test(segment) ||
    dateSegmentPattern.test(segment) ||
    opaqueSegmentPattern.test(segment)
  );
}

function getNormalizedPathSegments(rawUrl: string): string[] {
  return new URL(rawUrl).pathname
    .split('/')
    .filter(segment => segment.length > 0)
    .map(normalizePathSegment);
}

function normalizeSegmentForFamily(segment: string): string {
  return isObviouslyVariableSegment(segment) ? ':variable' : segment;
}

function createSiblingParentKey(rawUrl: string): string | null {
  const url = new URL(rawUrl);

  const segments = getNormalizedPathSegments(rawUrl);

  if (segments.length < 2) {
    return null;
  }

  const parentSegments = segments.slice(0, -1).map(normalizeSegmentForFamily);

  return [url.origin.toLocaleLowerCase('en-US'), segments.length, parentSegments.join('/')].join(
    '|'
  );
}

function buildRouteFamilyContext(links: NavigationLink[]): RouteFamilyContext {
  const siblingDetails = new Map<string, Set<string>>();

  for (const link of links) {
    const parentKey = createSiblingParentKey(link.url);

    if (parentKey === null) {
      continue;
    }

    const segments = getNormalizedPathSegments(link.url);

    const finalSegment = segments[segments.length - 1];

    if (!detailSlugPattern.test(finalSegment) && !isObviouslyVariableSegment(finalSegment)) {
      continue;
    }

    const existingDetails = siblingDetails.get(parentKey) ?? new Set<string>();

    existingDetails.add(finalSegment);

    siblingDetails.set(parentKey, existingDetails);
  }

  return {
    repeatedSiblingParents: new Set(
      Array.from(siblingDetails.entries())
        .filter(([, details]) => details.size >= 3)
        .map(([parentKey]) => parentKey)
    )
  };
}

function createPredictedPageIdentityWithContext(
  rawUrl: string,
  context: RouteFamilyContext
): PredictedPageIdentity {
  const url = new URL(rawUrl);

  const segments = getNormalizedPathSegments(rawUrl);

  if (segments.length === 0) {
    return {
      areaKey: 'root',

      routeFamilyKey: '/'
    };
  }

  const areaKey = segments[0];

  if (segments.length === 1) {
    return {
      areaKey,

      routeFamilyKey: `/${segments[0]}`
    };
  }

  const familySegments = segments.map(normalizeSegmentForFamily);

  const siblingParentKey = createSiblingParentKey(rawUrl);

  if (siblingParentKey !== null && context.repeatedSiblingParents.has(siblingParentKey)) {
    familySegments[familySegments.length - 1] = ':detail';
  }

  const queryKeys = Array.from(
    new Set(
      Array.from(url.searchParams.keys()).map(key =>
        key.normalize('NFKC').toLocaleLowerCase('en-US')
      )
    )
  ).sort();

  const queryShape = queryKeys.length > 0 ? `?${queryKeys.map(key => `${key}=*`).join('&')}` : '';

  return {
    areaKey,

    routeFamilyKey: `/${familySegments.join('/')}${queryShape}`
  };
}

function incrementCount(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function getCountBucket(count: number): string {
  if (count === 0) {
    return '0';
  }

  if (count === 1) {
    return '1';
  }

  if (count === 2) {
    return '2';
  }

  if (count <= 5) {
    return '3-5';
  }

  if (count <= 10) {
    return '6-10';
  }

  if (count <= 20) {
    return '11-20';
  }

  if (count <= 50) {
    return '21-50';
  }

  return '51+';
}

export function createPageNoveltyState(): PageNoveltyState {
  return {
    areaVisitCounts: new Map(),

    routeFamilyVisitCounts: new Map(),

    observedTemplateVisitCounts: new Map(),

    routeFamilyObservedTemplates: new Map()
  };
}

export function predictPageIdentity(
  rawUrl: string,
  availableLinks: NavigationLink[] = []
): PredictedPageIdentity {
  return createPredictedPageIdentityWithContext(rawUrl, buildRouteFamilyContext(availableLinks));
}

export function registerPredictedPageIdentity(
  state: PageNoveltyState,
  identity: PredictedPageIdentity
): void {
  incrementCount(state.areaVisitCounts, identity.areaKey);

  incrementCount(state.routeFamilyVisitCounts, identity.routeFamilyKey);
}

export function createObservedTemplateKey(content: ExtractedPageContent): string {
  const textFieldInventory = content.textFields
    .map(field =>
      [
        field.tagName,
        field.inputType.toLocaleLowerCase('en-US'),
        field.required ? 'required' : 'optional',
        field.disabled ? 'disabled' : 'enabled',
        field.readOnly ? 'readonly' : 'editable'
      ].join(':')
    )
    .sort();

  const selectInventory = content.selects
    .map(select =>
      [
        select.required ? 'required' : 'optional',
        select.disabled ? 'disabled' : 'enabled',
        `options-${getCountBucket(select.totalOptions)}`
      ].join(':')
    )
    .sort();

  const canonicalProfile = {
    version: 1,

    headingCount: getCountBucket(content.headings.length),

    linkCount: getCountBucket(content.links.length),

    buttonCount: getCountBucket(content.buttons.length),

    textFieldCount: getCountBucket(content.textFields.length),

    selectCount: getCountBucket(content.selects.length),

    textFieldInventory,
    selectInventory
  };

  const fingerprint = createHash('sha256')
    .update(JSON.stringify(canonicalProfile))
    .digest('hex')
    .slice(0, 16);

  return `observed-v1:${fingerprint}`;
}

export function registerInspectedPageNovelty(
  state: PageNoveltyState,
  predictedIdentity: PredictedPageIdentity,
  content: ExtractedPageContent
): InspectedPageNovelty {
  const observedTemplateKey = createObservedTemplateKey(content);

  registerPredictedPageIdentity(state, predictedIdentity);

  incrementCount(state.observedTemplateVisitCounts, observedTemplateKey);

  const observedTemplates =
    state.routeFamilyObservedTemplates.get(predictedIdentity.routeFamilyKey) ?? new Set<string>();

  observedTemplates.add(observedTemplateKey);

  state.routeFamilyObservedTemplates.set(predictedIdentity.routeFamilyKey, observedTemplates);

  return {
    predictedIdentity,
    observedTemplateKey
  };
}

export function buildNoveltyCandidateWindow(
  unvisitedLinks: NavigationLink[],
  allDiscoveredLinks: NavigationLink[],
  state: PageNoveltyState,
  maximumCandidates = 20
): NoveltyNavigationCandidate[] {
  if (maximumCandidates <= 0) {
    return [];
  }

  const context = buildRouteFamilyContext(allDiscoveredLinks);

  const candidates = unvisitedLinks.map(link => {
    const predictedIdentity = createPredictedPageIdentityWithContext(link.url, context);

    const areaVisitCount = state.areaVisitCounts.get(predictedIdentity.areaKey) ?? 0;

    const routeFamilyVisitCount =
      state.routeFamilyVisitCounts.get(predictedIdentity.routeFamilyKey) ?? 0;

    const observedTemplateVisitCount = Array.from(
      state.routeFamilyObservedTemplates.get(predictedIdentity.routeFamilyKey) ?? []
    ).reduce(
      (total, templateKey) => total + (state.observedTemplateVisitCounts.get(templateKey) ?? 0),
      0
    );

    const noveltyTier: NavigationNoveltyTier =
      areaVisitCount === 0
        ? 'unseen-area'
        : routeFamilyVisitCount === 0
          ? 'unseen-route-family'
          : 'seen-route-family';

    return {
      link,
      predictedIdentity,
      noveltyTier,
      areaVisitCount,
      routeFamilyVisitCount,
      observedTemplateVisitCount
    };
  });

  const tierOrder: NavigationNoveltyTier[] = [
    'unseen-area',
    'unseen-route-family',
    'seen-route-family'
  ];

  const selected: NoveltyNavigationCandidate[] = [];

  for (const tier of tierOrder) {
    const familyQueues = new Map<string, NoveltyNavigationCandidate[]>();

    for (const candidate of candidates) {
      if (candidate.noveltyTier !== tier) {
        continue;
      }

      const familyKey = candidate.predictedIdentity.routeFamilyKey;

      const familyQueue = familyQueues.get(familyKey) ?? [];

      familyQueue.push(candidate);

      familyQueues.set(familyKey, familyQueue);
    }

    const orderedFamilyQueues = Array.from(familyQueues.values()).sort((left, right) => {
      const visitDifference = left[0].routeFamilyVisitCount - right[0].routeFamilyVisitCount;

      if (visitDifference !== 0) {
        return visitDifference;
      }

      const templateVisitDifference =
        left[0].observedTemplateVisitCount - right[0].observedTemplateVisitCount;

      if (templateVisitDifference !== 0) {
        return templateVisitDifference;
      }

      return candidates.indexOf(left[0]) - candidates.indexOf(right[0]);
    });

    let familyOffset = 0;

    while (selected.length < maximumCandidates) {
      let addedInRound = false;

      for (const familyQueue of orderedFamilyQueues) {
        const candidate = familyQueue[familyOffset];

        if (!candidate) {
          continue;
        }

        selected.push(candidate);

        addedInRound = true;

        if (selected.length >= maximumCandidates) {
          return selected;
        }
      }

      if (!addedInRound) {
        break;
      }

      familyOffset += 1;
    }
  }

  return selected;
}
