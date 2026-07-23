import {
  exploratoryQaAnalysisSchema
} from './analysis/exploratory-qa-schema';

const validResponse = {
  findings: [
    {
      category: 'content',
      severity: 'low',
      confidence: 'high',
      title: 'Possible placeholder text',
      evidence:
        'The visible page text contains "Lorem ipsum".',
      reasoning:
        'Placeholder copy may indicate unfinished content.',
      suggestedCheck:
        'Confirm whether the text is intentionally published.',
      evidenceTarget: null
    }
  ],
  summary:
    'One potential content-quality issue was identified.'
};

const targetedResponse = {
  findings: [
    {
      category: 'content',
      severity: 'low',
      confidence: 'high',
      title:
        'Misspelled country option in dropdown',
      evidence:
        'The Country dropdown contains both "Ecuador" and "Equador".',
      reasoning:
        '"Equador" appears to be an additional misspelled option.',
      suggestedCheck:
        'Verify the intended country list and remove or correct the misspelled option.',
      evidenceTarget: {
        kind: 'select-option',
        controlLabel: 'Country',
        controlName: 'country',
        controlId: 'country',
        optionText: 'Equador'
      }
    }
  ],
  summary:
    'One dropdown content issue was identified.'
};

const disclosureTargetedResponse = {
  findings: [
    {
      category:
        'interaction',
      severity:
        'low',
      confidence:
        'medium',
      title:
        'Informational disclosure requires state verification',
      evidence:
        'Structured evidence identifies an eligible disclosure control.',
      reasoning:
        'The control can be safely investigated through a reversible state transition.',
      suggestedCheck:
        'Expand the disclosure and verify its controlled region.',
      evidenceTarget: {
        kind:
          'disclosure-state',
        controlId:
          'faq-control',
        accessibleName:
          'What does CheckQuest test?',
        controlledRegionId:
          'faq-answer',
        desiredState:
          'expanded'
      }
    }
  ],
  summary:
    'One disclosure candidate was identified.'
};

const tabTargetedResponse = {
  findings: [
    {
      category:
        'interaction',
      severity:
        'low',
      confidence:
        'medium',
      title:
        'Tab content requires state verification',
      evidence:
        'Structured evidence identifies an eligible conventional tab.',
      reasoning:
        'The tab can be safely investigated through a reversible selection.',
      suggestedCheck:
        'Select the exact tab and verify its panel.',
      evidenceTarget: {
        kind:
          'tab-state',
        controlId:
          'details-tab',
        accessibleName:
          'Details',
        tabListId:
          'product-tabs',
        controlledPanelId:
          'details-panel',
        desiredState:
          'selected'
      }
    }
  ],
  summary:
    'One tab candidate was identified.'
};

const emptyResponse = {
  findings: [],
  summary:
    'No evidence-grounded exploratory QA issues were identified.'
};

const invalidResponse = {
  findings: [
    {
      category: 'definitely-a-bug',
      severity: 'critical',
      confidence: 'absolutely',
      title: '',
      evidence: '',
      reasoning: '',
      suggestedCheck: '',
      evidenceTarget: null
    }
  ],
  summary: ''
};

console.log('Valid response:');

const parsedValid =
  exploratoryQaAnalysisSchema.safeParse(
    validResponse
  );

console.log(
  JSON.stringify(
    parsedValid,
    null,
    2
  )
);

console.log(
  '\nTargeted response:'
);

const parsedTargeted =
  exploratoryQaAnalysisSchema.safeParse(
    targetedResponse
  );

const parsedDisclosureTargeted =
  exploratoryQaAnalysisSchema.safeParse(
    disclosureTargetedResponse
  );

if (
  !parsedDisclosureTargeted.success
) {
  throw new Error(
    `Disclosure target should be accepted: ${parsedDisclosureTargeted.error.message}`
  );
}

const parsedTabTargeted =
  exploratoryQaAnalysisSchema.safeParse(
    tabTargetedResponse
  );

if (!parsedTabTargeted.success) {
  throw new Error(
    `Tab target should be accepted: ${parsedTabTargeted.error.message}`
  );
}

console.log(
  JSON.stringify(
    parsedTargeted,
    null,
    2
  )
);

console.log(
  '\nEmpty findings response:'
);

const parsedEmpty =
  exploratoryQaAnalysisSchema.safeParse(
    emptyResponse
  );

console.log(
  JSON.stringify(
    parsedEmpty,
    null,
    2
  )
);

console.log(
  '\nInvalid response:'
);

const parsedInvalid =
  exploratoryQaAnalysisSchema.safeParse(
    invalidResponse
  );

console.log(
  JSON.stringify(
    parsedInvalid,
    null,
    2
  )
);

console.log('\nSummary:');

console.log(
  `Valid accepted: ${parsedValid.success}`
);

console.log(
  `Targeted accepted: ${parsedTargeted.success}`
);

console.log(
  `Empty accepted: ${parsedEmpty.success}`
);

console.log(
  `Invalid rejected: ${!parsedInvalid.success}`
);
