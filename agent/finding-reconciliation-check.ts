import assert from 'node:assert/strict';

import type {
  ExploratoryQaFinding
} from './analysis/exploratory-qa-schema';
import type {
  PageFinding
} from './analysis/evaluate-page';
import {
  createRuleFindingFingerprint,
  reconcileFindingObservations
} from './findings/reconcile-finding-observations';
import type {
  FindingEvidence
} from './findings/finding-model';
import {
  createExploratoryFindingFingerprint
} from './investigation/finding-fingerprint';

const pageUrl =
  'https://example.com/checkout';

function createRuleFinding(
  code: string,
  overrides: Partial<PageFinding> = {}
): PageFinding {
  return {
    code,
    severity: 'medium',
    title: `Rule title for ${code}`,
    evidence: `Rule evidence for ${code}.`,
    url: pageUrl,
    ...overrides
  };
}

function createModelFinding(
  overrides:
    Partial<ExploratoryQaFinding> = {}
): ExploratoryQaFinding {
  return {
    category: 'content',
    severity: 'low',
    confidence: 'medium',
    title: 'Possible checkout wording issue',
    evidence:
      'The checkout wording appears incomplete.',
    reasoning:
      'A customer may not understand the instruction.',
    suggestedCheck:
      'Review the rendered checkout instruction.',
    evidenceTarget: null,
    ...overrides
  };
}

function createRuleLinkedModelFinding(
  ruleFinding: PageFinding,
  overrides:
    Partial<ExploratoryQaFinding> = {}
): ExploratoryQaFinding {
  return createModelFinding({
    relatedRuleCode:
      ruleFinding.code,
    title:
      ruleFinding.title,
    evidence:
      ruleFinding.evidence,
    evidenceTarget:
      null,
    ...overrides
  });
}

function reconcile(
  ruleFindings: PageFinding[],
  modelFindings: ExploratoryQaFinding[],
  evidenceContributions:
    {
      fingerprint: string;
      evidence: FindingEvidence;
    }[] = []
) {
  return reconcileFindingObservations({
    pageUrl,
    pageTitle: 'Checkout',
    ruleFindings,
    modelFindings,
    evidenceContributions
  });
}

function createDeterministicEvidence(
  id: string,
  relation:
    'supports' |
    'contradicts'
): FindingEvidence {
  return {
    evidenceReference:
      `evidence-${id}`,
    source: 'browser',
    kind: 'browser-observation',
    relation,
    verificationCapable: true,
    summary:
      `Deterministic evidence ${relation} the exact assertion.`
  };
}

function runChecks(): void {
  const emptyTitleRule =
    createRuleFinding(
      'EMPTY_PAGE_TITLE',
      {
        severity: 'medium',
        title:
          'Page has no browser title'
      }
    );

  const linkedModel =
    createRuleLinkedModelFinding(
      emptyTitleRule,
      {
        severity: 'high'
      }
    );

  const linked =
    reconcile(
      [emptyTitleRule],
      [linkedModel]
    );

  assert.equal(
    linked.findings.length,
    1,
    '1. exact same-page rule identity merges rule and model observations'
  );

  assert.equal(
    linked.findings[0].occurrences[0]
      .evidence.length,
    2,
    '2. merged finding preserves deterministic and model evidence'
  );

  assert.equal(
    linked.findings[0]
      .verification.state,
    'verified',
    '3. verification-capable empty-title evidence verifies the merged finding'
  );

  assert.deepEqual(
    {
      severity:
        linked.findings[0].severity,
      title:
        linked.findings[0].title,
      category:
        linked.findings[0].category
    },
    {
      severity: 'medium',
      title:
        'Page has no browser title',
      category: 'technical'
    },
    '4. deterministic rule presentation owns severity, title, and category'
  );

  const linkedModelEvidence =
    linked.findings[0]
      .occurrences[0]
      .evidence.find(
        evidence =>
          evidence.source ===
          'model'
      );

  assert.deepEqual(
    linkedModelEvidence
      ?.rawSource?.value,
    linkedModel,
    '5. the original correlated model observation remains traceable'
  );

  const mismatchedTargetlessReference =
    reconcile(
      [emptyTitleRule],
      [
        createModelFinding({
          relatedRuleCode:
            'EMPTY_PAGE_TITLE',
          title:
            'Navigation button has an unclear label',
          evidence:
            'The primary navigation button reads Go.'
        })
      ]
    );

  assert.equal(
    mismatchedTargetlessReference
      .findings.length,
    2,
    '6. a real same-page rule code cannot merge a different targetless assertion'
  );

  assert.equal(
    mismatchedTargetlessReference
      .modelReconciliations[0]
      .acceptedRelatedRuleCode,
    null,
    '7. relatedRuleCode alone is not trusted as finding identity'
  );

  const incompatibleStructuredModel =
    createRuleLinkedModelFinding(
      emptyTitleRule,
      {
        evidenceTarget: {
          kind: 'select-option',
          controlLabel: 'Country',
          controlName: 'country',
          controlId: 'country',
          optionText: 'Equador'
        }
      }
    );

  const incompatibleStructuredReference =
    reconcile(
      [emptyTitleRule],
      [incompatibleStructuredModel]
    );

  assert.equal(
    incompatibleStructuredReference
      .findings.length,
    2,
    '8. a structured target cannot be swallowed by a targetless rule reference'
  );

  assert.equal(
    incompatibleStructuredReference
      .modelReconciliations[0]
      .acceptedRelatedRuleCode,
    null,
    '9. incompatible structured identity rejects the rule association'
  );

  assert.equal(
    incompatibleStructuredReference
      .findings.some(
        finding =>
          finding.fingerprint ===
          createExploratoryFindingFingerprint(
            incompatibleStructuredModel
          )
      ),
    true,
    '10. the independently fingerprinted structured model finding is preserved'
  );

  const httpClientErrorRule =
    createRuleFinding(
      'HTTP_CLIENT_ERROR',
      {
        severity: 'high'
      }
    );

  const linkedHttpClientError =
    reconcile(
      [
        httpClientErrorRule
      ],
      [
        createRuleLinkedModelFinding(
          httpClientErrorRule
        )
      ]
    );

  assert.equal(
    linkedHttpClientError
      .findings.length,
    1,
    '5. an explicitly linked HTTP client-error observation merges'
  );

  assert.equal(
    linkedHttpClientError
      .findings[0]
      .verification.state,
    'verified',
    '6. direct HTTP client-error rule evidence verifies the merged finding'
  );

  const visibleErrorRule =
    createRuleFinding(
      'VISIBLE_ERROR_PAGE'
    );

  const heuristic =
    reconcile(
      [
        visibleErrorRule
      ],
      [
        createRuleLinkedModelFinding(
          visibleErrorRule
        )
      ]
    );

  assert.equal(
    heuristic.findings[0]
      .verification.state,
    'inconclusive',
    '7. heuristic rule evidence remains non-verifying after a model merge'
  );

  const modelOnly =
    reconcile(
      [],
      [createModelFinding()]
    );

  assert.equal(
    modelOnly.findings[0]
      .verification.state,
    'inconclusive',
    '8. model-only findings remain inconclusive'
  );

  const ruleOnly =
    reconcile(
      [
        createRuleFinding(
          'HTTP_CLIENT_ERROR'
        )
      ],
      []
    );

  assert.equal(
    ruleOnly.findings[0]
      .verification.state,
    'verified',
    '9. verification-capable rule-only findings are verified'
  );

  const unknownStatus =
    reconcile(
      [
        createRuleFinding(
          'HTTP_STATUS_UNKNOWN'
        )
      ],
      []
    );

  assert.equal(
    unknownStatus.findings[0]
      .verification.state,
    'inconclusive',
    '10. measurement-limitation rules remain inconclusive'
  );

  const unavailableRelationship =
    reconcile(
      [emptyTitleRule],
      [
        createModelFinding({
          relatedRuleCode:
            'HTTP_CLIENT_ERROR'
        })
      ]
    );

  assert.equal(
    unavailableRelationship
      .findings.length,
    2,
    '11. a valid rule code that is absent from this page does not merge'
  );

  assert.equal(
    unavailableRelationship
      .modelReconciliations[0]
      .acceptedRelatedRuleCode,
    null,
    '12. same-page validation rejects a rule relationship absent from the page'
  );

  const absentRelationship =
    reconcile(
      [emptyTitleRule],
      [
        createModelFinding({
          title:
            'Page appears to lack a title',
          evidence:
            'The visible page seems untitled.'
        })
      ]
    );

  assert.equal(
    absentRelationship.findings.length,
    2,
    '13. similar prose does not merge without an explicit exact relationship'
  );

  const unknownRelationship =
    reconcile(
      [emptyTitleRule],
      [
        createModelFinding({
          relatedRuleCode:
            'INVENTED_RULE'
        })
      ]
    );

  assert.equal(
    unknownRelationship.findings.length,
    2,
    '14. an unknown relatedRuleCode is ignored'
  );

  assert.equal(
    unknownRelationship
      .modelReconciliations[0]
      .acceptedRelatedRuleCode,
    null,
    '15. audit output does not accept an unavailable same-page rule'
  );

  const duplicateFallback =
    reconcile(
      [],
      [
        createModelFinding({
          reasoning:
            'First source observation.'
        }),
        createModelFinding({
          reasoning:
            'Second source observation.'
        })
      ]
    );

  assert.equal(
    duplicateFallback.findings.length,
    2,
    '16. unstructured model prose never supplies substantive merge identity'
  );

  assert.equal(
    duplicateFallback.findings[0]
      .occurrences[0].evidence.length,
    1,
    '17. each unstructured observation retains its own source evidence'
  );

  assert.equal(
    duplicateFallback
      .candidateFindings.length,
    2,
    '18. unstructured observations remain separate candidates'
  );

  const exactDuplicateSource =
    reconcile(
      [],
      [
        createModelFinding(),
        createModelFinding()
      ]
    );

  assert.equal(
    exactDuplicateSource.findings[0]
      .occurrences[0].evidence.length,
    1,
    '19. each byte-equivalent but unstructured observation keeps one evidence item'
  );

  const distinctFallback =
    reconcile(
      [],
      [
        createModelFinding(),
        createModelFinding({
          evidence:
            'The order summary total is missing.'
        })
      ]
    );

  assert.equal(
    distinctFallback.findings.length,
    2,
    '20. distinct fallback fingerprints remain separate'
  );

  const target = {
    kind:
      'select-option' as const,
    controlLabel: 'Country',
    controlName: 'country',
    controlId: 'country',
    optionText: 'Equador'
  };

  const sameTargetA =
    createModelFinding({
      title:
        'Country is misspelled',
      evidence:
        'Equador is shown.',
      evidenceTarget: target
    });

  const sameTargetB =
    createModelFinding({
      title:
        'Country option typo',
      evidence:
        'The option reads Equador.',
      evidenceTarget: {
        optionText: 'Equador',
        controlId: 'country',
        controlName: 'country',
        controlLabel: 'Country',
        kind: 'select-option'
      }
    });

  const structured =
    reconcile(
      [],
      [sameTargetA, sameTargetB]
    );

  assert.equal(
    structured.findings.length,
    1,
    '21. identical structured targets merge despite presentation differences'
  );

  assert.equal(
    structured.findings[0].fingerprint,
    createExploratoryFindingFingerprint(
      sameTargetA
    ),
    '22. structured-target reconciliation preserves the existing fingerprint'
  );

  const differentTargets =
    reconcile(
      [],
      [
        sameTargetA,
        createModelFinding({
          evidenceTarget: {
            ...target,
            optionText: 'Canada'
          }
        })
      ]
    );

  assert.equal(
    differentTargets.findings.length,
    2,
    '23. different structured targets remain separate'
  );

  const ruleFingerprint =
    createRuleFindingFingerprint(
      emptyTitleRule
    );

  const conflict =
    reconcile(
      [emptyTitleRule],
      [linkedModel],
      [
        {
          fingerprint:
            ruleFingerprint,
          evidence:
            createDeterministicEvidence(
              'contradiction',
              'contradicts'
            )
        }
      ]
    );

  assert.equal(
    conflict.findings[0]
      .verification.state,
    'inconclusive',
    '24. verification-capable support and contradiction produce an explicit conflict'
  );

  assert.match(
    conflict.findings[0]
      .occurrences[0]
      .verification.reason,
    /Conflicting deterministic evidence/,
    '25. the occurrence exposes the explicit deterministic conflict'
  );

  const contradictedModel =
    reconcile(
      [],
      [sameTargetA],
      [
        {
          fingerprint:
            createExploratoryFindingFingerprint(
              sameTargetA
            ),
          evidence:
            createDeterministicEvidence(
              'target-contradiction',
              'contradicts'
            )
        }
      ]
    );

  assert.equal(
    contradictedModel.findings[0]
      .verification.state,
    'not-verified',
    '26. exact deterministic contradiction can mark a model candidate not verified'
  );

  assert.equal(
    linked.findings[0]
      .occurrences[0]
      .evidence.find(
        evidence =>
          evidence.source ===
          'model'
      )
      ?.verificationCapable,
    false,
    '27. relatedRuleCode never makes model evidence verification-capable'
  );

  const duplicateLinked =
    reconcile(
      [emptyTitleRule],
      [
        linkedModel,
        {
          ...linkedModel,
          reasoning:
            'A second model observation.'
        }
      ]
    );

  assert.equal(
    duplicateLinked.candidateFindings.length,
    1,
    '28. duplicate same-rule model observations create one candidate'
  );

  assert.equal(
    duplicateLinked.findings[0]
      .occurrences[0]
      .evidence.length,
    3,
    '29. the rule group retains both materially different model observations'
  );

  console.log(
    'Finding reconciliation check passed (trust-boundary and reconciliation coverage, 35 assertions).'
  );
}

runChecks();
