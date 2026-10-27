import assert from 'node:assert/strict';

import { chooseNavigationLink } from '../../agent/decisions/choose-navigation-link';
import { aiConfig } from '../../agent/config/ai-config';
import { CheckQuestError } from '../../agent/errors/checkquest-error';
import {
  buildNavigationPolicyWindow,
  createNavigationFrontier,
  registerDiscoveredNavigationLinks
} from '../../agent/exploration/navigation-policy';
import { createPageNoveltyState } from '../../agent/exploration/page-novelty';
import { createNavigationUrlState } from '../../agent/exploration/visited-links';

interface NavigationRequest {
  input: string;
  model: string;
  stream: boolean;
  store: boolean;
  tools: unknown[];
  generation_config: { tool_choice: string; thinking_level: string };
}

const site = {
  id: 'navigation-contract',
  name: 'Mixed business website',
  startUrl: 'https://example.test/',
  allowedHosts: ['example.test'],
  maxPages: 6,
  maxAgentSteps: 9,
  maxExploratoryStepsPerPage: 3,
  allowFormSubmission: false
};
const budget = {
  remainingPageSlots: 3,
  remainingNavigationDecisionSlots: 5,
  remainingPotentialInspections: 3
};
const links = [
  { text: 'Company & documentation', url: 'https://example.test/company' },
  { text: 'Compare products', url: 'https://example.test/products?view=compare' },
  { text: 'Search the catalog', url: 'https://example.test/search' },
  { text: 'Contact us: "Your question"', url: 'https://example.test/contact' },
  { text: 'Sign in', url: 'https://example.test/account' },
  { text: 'Delete workspace', url: 'https://example.test/workspace/remove' }
];

async function main(): Promise<void> {
  const frontier = createNavigationFrontier();
  registerDiscoveredNavigationLinks(frontier, links, site.startUrl, 0);
  const candidates = buildNavigationPolicyWindow({
    frontier,
    urlState: createNavigationUrlState(),
    pageNoveltyState: createPageNoveltyState(),
    budget
  }).candidates;
  assert.deepEqual(
    candidates.map(candidate => candidate.link),
    links
  );
  const originalCandidates = structuredClone(candidates);
  const originalBudget = structuredClone(budget);
  const requests: NavigationRequest[] = [];
  const originalFetch = globalThis.fetch;
  let steps: { type: string; name: string; arguments: Record<string, unknown> }[] = [];

  try {
    // Capture the real SDK request locally; never delegate to the network.
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      assert.equal(request.method, 'POST');
      assert.ok(new URL(request.url).pathname.endsWith('/interactions'));
      requests.push((await request.json()) as NavigationRequest);
      return new Response(JSON.stringify({ id: 'offline-navigation', steps }), {
        headers: { 'content-type': 'application/json' }
      });
    };

    const choose = async (offered = candidates) => {
      const before = requests.length;
      try {
        return await chooseNavigationLink(site, offered, budget, {
          geminiApiKey: 'synthetic-navigation-contract-key'
        });
      } finally {
        assert.equal(requests.length - before, offered.length === 0 ? 0 : 1);
      }
    };

    // Each page category alone, then the same candidates on a mixed website.
    for (const offered of [
      ...candidates.map(candidate => [candidate]),
      candidates,
      [...candidates].reverse()
    ]) {
      const linkIndex = offered.length === 1 ? 0 : 1;
      steps = [
        {
          type: 'function_call',
          name: 'choose_navigation_link',
          arguments: { linkIndex, reason: 'Synthetic contract response.' }
        }
      ];
      const decision = await choose(offered);
      assert.equal(decision.type, 'link');
      if (decision.type !== 'link') {
        assert.fail('Expected the supplied fixture selection.');
      }
      // This injected response tests index mapping, not Gemini preference or URL safety.
      assert.equal(decision.link, offered[linkIndex].link);
      assert.equal(decision.policyCandidate, offered[linkIndex]);
      assert.equal(decision.predictedIdentity, offered[linkIndex].predictedIdentity);
      assert.equal(decision.reason, 'Synthetic contract response.');

      const request = requests.at(-1)!;
      assert.equal(request.model, aiConfig.model);
      assert.equal(request.stream, false);
      assert.equal(request.store, false);
      assert.deepEqual(request.generation_config, { tool_choice: 'any', thinking_level: 'low' });
      const [guidance, serializedCandidates] = request.input.split('Safe navigation links:\n');
      assert.ok(serializedCandidates);
      assert.deepEqual(
        JSON.parse(serializedCandidates),
        offered.map((candidate, index) => ({
          index,
          text: candidate.link.text,
          url: candidate.link.url,
          areaKey: candidate.predictedIdentity.areaKey,
          routeFamilyKey: candidate.predictedIdentity.routeFamilyKey,
          novelty: candidate.noveltyTier,
          traversalDepth: candidate.minimumDiscoveryDepth,
          firstDiscoveredFromUrl: candidate.firstDiscoveredFromUrl,
          minimumDepthDiscoveredFromUrl: candidate.minimumDepthDiscoveredFromUrl,
          policyBand: candidate.policyBand,
          valueClass: candidate.valueClass,
          valueReasons: candidate.valueReasons,
          policyReason: candidate.policyReason,
          previousAreaVisits: candidate.areaVisitCount,
          previousRouteFamilyVisits: candidate.routeFamilyVisitCount,
          previousObservedTemplateVisits: candidate.observedTemplateVisitCount
        }))
      );
      assert.ok(guidance.includes(site.name));
      assert.ok(guidance.includes(`Remaining page slots: ${budget.remainingPageSlots}`));
      assert.ok(
        guidance.includes(
          `Remaining navigation-decision slots: ${budget.remainingNavigationDecisionSlots}`
        )
      );
      assert.doesNotMatch(guidance, /Prefer an informative content or product page/i);
      assert.doesNotMatch(guidance, /Do not choose a form, demo-booking page, search page/i);
      for (const concept of [
        /exploratory[^\n]*(?:QA|quality assurance)/i,
        /inspect[^\n]*observable behavio[u]?r/i,
        /functionality/i,
        /content correctness/i,
        /potential (?:problems|issues)/i,
        /consider.*novelty.*representative coverage.*remaining.*budgets/i,
        /informational.*documentation.*valid/i,
        /do not automatically (?:prefer|prioritize).*functional pages/i,
        /do not[^\n]*favor interactive pages.*controls/i,
        /provided link information.*(?:do not|never) invent.*functionality.*defects/i,
        /visiting.*inputs.*forms.*search.*login.*separate from using.*controls/i,
        /page category alone.*not grounds for exclusion.*safe navigation/i,
        /selecting a URL.*no permission.*subsequent interactions/i,
        /do not navigate.*known or reasonably suspected.*destructive or state-changing/i,
        /same-host URLs.*not automatically safe/i,
        /do not[^\n]*authenticate.*submit forms.*purchase.*download.*destructive/i,
        /protocol.*host.*candidate.*browser safety/i,
        /never[^\n]*model judgment.*bypass.*safeguards/i,
        /safety.*materially uncertain.*safer supplied alternative.*finish/i,
        /choose only from the supplied numbered list/i,
        /do not invent a URL/i,
        /policy metadata.*never as permission to bypass safety/i,
        /low-value routes remain valid targets/i
      ]) {
        assert.match(guidance, concept);
      }
      assert.deepEqual(request.tools, [
        {
          type: 'function',
          name: 'choose_navigation_link',
          description:
            'Choose one safe navigation link from the supplied numbered list for the next QA inspection.',
          parameters: {
            type: 'object',
            properties: {
              linkIndex: {
                type: 'integer',
                minimum: 0,
                maximum: offered.length - 1,
                description: 'The zero-based list position of the navigation link to inspect.'
              },
              reason: {
                type: 'string',
                description: 'Why this link is a useful and safe next QA target.'
              }
            },
            required: ['linkIndex', 'reason']
          }
        },
        {
          type: 'function',
          name: 'finish',
          description:
            'Choose this when none of the available navigation links should be inspected.',
          parameters: {
            type: 'object',
            properties: {
              summary: {
                type: 'string',
                description: 'A short explanation of why no navigation link should be selected.'
              }
            },
            required: ['summary']
          }
        }
      ]);
    }

    steps = [
      { type: 'function_call', name: 'finish', arguments: { summary: 'Safety is uncertain.' } }
    ];
    assert.deepEqual(await choose(), { type: 'finish', summary: 'Safety is uncertain.' });
    assert.deepEqual(await choose([]), {
      type: 'finish',
      summary: 'No safe navigation links were available.'
    });

    const isModelResponseError = (error: unknown) =>
      error instanceof CheckQuestError && error.code === 'MODEL_RESPONSE';
    for (const linkIndex of [-1, 0.5, candidates.length, '0']) {
      steps = [
        {
          type: 'function_call',
          name: 'choose_navigation_link',
          arguments: { linkIndex, reason: 'Invalid fixture index.' }
        }
      ];
      await assert.rejects(choose(), isModelResponseError);
    }
    for (const invalidSteps of [
      [],
      [steps[0], steps[0]],
      [{ type: 'function_call', name: 'invent_navigation', arguments: {} }],
      [{ type: 'function_call', name: 'finish', arguments: { summary: '' } }]
    ]) {
      steps = invalidSteps;
      await assert.rejects(choose(), isModelResponseError);
    }
    assert.deepEqual(candidates, originalCandidates);
    assert.deepEqual(budget, originalBudget);
  } finally {
    globalThis.fetch = originalFetch;
  }
  console.log(
    'Navigation request contract checks passed: category-neutral QA guidance, safety, candidate parity and decision contracts; offline SDK only, no browser.'
  );
}

main().catch((error: unknown) => {
  console.error('Navigation request contract check failed.', error);
  process.exitCode = 1;
});
