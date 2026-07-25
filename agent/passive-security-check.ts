import assert from 'node:assert/strict';

import {
  evaluatePassiveSecurity
} from './security/evaluate-passive-security';

import {
  sanitizePassiveSecurityHeaderValue
} from './security/capture-main-document-security';

import type {
  PassivePageSecuritySnapshot,
  PassiveSecurityObservation
} from './security/passive-security-model';

import {
  createPassiveSecurityRegistry,
  getPassiveSecurityReport,
  registerPassiveSecuritySnapshot
} from './security/passive-security-registry';

function createSnapshot(
  input: {
    finalUrl?: string;
    pageTitle?: string;
    headers?:
      PassivePageSecuritySnapshot[
        'headers'
      ];
  } = {}
): PassivePageSecuritySnapshot {
  const finalUrl =
    input.finalUrl ??
    'https://example.com/page';

  const url =
    new URL(
      finalUrl
    );

  return {
    requestedUrl:
      finalUrl,
    finalUrl,
    responseUrl:
      finalUrl,
    responseStatus:
      200,
    responseReceived:
      true,
    finalScheme:
      url.protocol as
        'http:' | 'https:',
    origin:
      url.origin,
    pageTitle:
      input.pageTitle ??
      url.pathname,
    redirects:
      [],
    headers:
      input.headers ?? {
        'strict-transport-security': [
          'max-age=31536000'
        ],
        'content-security-policy': [
          "default-src 'self'; frame-ancestors 'self'"
        ],
        'x-content-type-options': [
          'nosniff'
        ]
      }
  };
}

function findDraft(
  snapshot:
    PassivePageSecuritySnapshot,
  code:
    string,
  subject?:
    string
) {
  return evaluatePassiveSecurity(
    snapshot
  ).find(
    draft =>
      draft.code ===
        code &&
      (
        subject ===
          undefined ||
        draft.subject ===
          subject
      )
  );
}

function requireDraft(
  snapshot:
    PassivePageSecuritySnapshot,
  code:
    string,
  subject?:
    string
) {
  const draft =
    findDraft(
      snapshot,
      code,
      subject
    );

  assert.ok(
    draft,
    `Expected ${code}${subject ? `/${subject}` : ''}.`
  );

  return draft;
}

function assertClassification(
  observation:
    Pick<
      PassiveSecurityObservation,
      | 'posture'
      | 'severity'
      | 'confidence'
    >,
  expected: {
    posture:
      PassiveSecurityObservation[
        'posture'
      ];
    severity:
      PassiveSecurityObservation[
        'severity'
      ];
    confidence:
      PassiveSecurityObservation[
        'confidence'
      ];
  }
): void {
  assert.deepEqual(
    {
      posture:
        observation.posture,
      severity:
        observation.severity,
      confidence:
        observation.confidence
    },
    expected
  );
}

function main(): void {
  const cspSecrets = [
    'NONCE_SECRET',
    'SHA256_SECRET',
    'SHA384_SECRET',
    'SHA512_SECRET',
    'QUERY_SECRET',
    'FRAGMENT_SECRET',
    'USER_SECRET',
    'PASSWORD_SECRET',
    'PROTOCOL_RELATIVE_SECRET',
    'REPORT_SECRET'
  ] as const;

  const sanitizedCsp =
    sanitizePassiveSecurityHeaderValue(
      'content-security-policy',
      [
        "default-src 'self';",
        "script-src 'nonce-NONCE_SECRET' 'sha256-SHA256_SECRET' 'sha384-SHA384_SECRET' 'sha512-SHA512_SECRET';",
        'connect-src https://USER_SECRET:PASSWORD_SECRET@api.example.test/path?token=QUERY_SECRET#FRAGMENT_SECRET',
        '//cdn.example.test/library.js?api_key=PROTOCOL_RELATIVE_SECRET;',
        'report-uri /csp-report?token=REPORT_SECRET;',
        'report-to csp-endpoint;',
        "frame-ancestors 'self'"
      ].join(
        ' '
      )
    );

  for (
    const secret of
      cspSecrets
  ) {
    assert.equal(
      sanitizedCsp.includes(
        secret
      ),
      false,
      `Sanitized CSP retained ${secret}.`
    );
  }

  assert.match(
    sanitizedCsp,
    /script-src 'nonce-\[redacted\]' 'sha256-\[redacted\]' 'sha384-\[redacted\]' 'sha512-\[redacted\]'; connect-src/
  );

  assert.match(
    sanitizedCsp,
    /https:\/\/api\.example\.test\/path/
  );

  assert.match(
    sanitizedCsp,
    /\/\/cdn\.example\.test\/library\.js/
  );

  assert.match(
    sanitizedCsp,
    /report-uri \/csp-report\?\[redacted\]; report-to csp-endpoint;/
  );

  const normalizedWhitespace =
    sanitizePassiveSecurityHeaderValue(
      'content-security-policy',
      "default-src\t'self';\r\n  frame-ancestors   'none'"
    );

  assert.equal(
    normalizedWhitespace,
    "default-src 'self'; frame-ancestors 'none'"
  );

  const maximumLengthValue =
    sanitizePassiveSecurityHeaderValue(
      'server',
      `  ${'a'.repeat(4_100)}  `
    );

  assert.equal(
    maximumLengthValue.length,
    4_000
  );

  const httpSnapshot =
    createSnapshot({
      finalUrl:
        'http://example.com/page'
    });

  const httpObservation =
    requireDraft(
      httpSnapshot,
      'PS_HTTP_DOCUMENT'
    );

  assertClassification(
    httpObservation,
    {
      posture:
        'misconfiguration',
      severity:
        'medium',
      confidence:
        'high'
    }
  );

  assert.equal(
    findDraft(
      createSnapshot(),
      'PS_HTTP_DOCUMENT'
    ),
    undefined
  );

  assert.equal(
    findDraft(
      createSnapshot(),
      'PS_HSTS_NOT_OBSERVED'
    ),
    undefined
  );

  assert.equal(
    findDraft(
      createSnapshot(),
      'PS_HSTS_NOT_ENFORCING'
    ),
    undefined
  );

  const absentHsts =
    requireDraft(
      createSnapshot({
        headers: {
          'content-security-policy': [
            "frame-ancestors 'self'"
          ],
          'x-content-type-options': [
            'nosniff'
          ]
        }
      }),
      'PS_HSTS_NOT_OBSERVED'
    );

  assertClassification(
    absentHsts,
    {
      posture:
        'defense-in-depth-gap',
      severity:
        'low',
      confidence:
        'medium'
    }
  );

  for (
    const value of
      [
        'includeSubDomains',
        'max-age=banana',
        'max-age=0'
      ]
  ) {
    const notEnforcing =
      requireDraft(
        createSnapshot({
          headers: {
            'strict-transport-security': [
              value
            ],
            'content-security-policy': [
              "frame-ancestors 'self'"
            ],
            'x-content-type-options': [
              'nosniff'
            ]
          }
        }),
        'PS_HSTS_NOT_ENFORCING'
      );

    assertClassification(
      notEnforcing,
      {
        posture:
          'misconfiguration',
        severity:
          'low',
        confidence:
          'high'
      }
    );
  }

  assert.equal(
    findDraft(
      createSnapshot({
        finalUrl:
          'http://example.com/page',
        headers: {
          'content-security-policy': [
            "frame-ancestors 'self'"
          ],
          'x-content-type-options': [
            'nosniff'
          ]
        }
      }),
      'PS_HSTS_NOT_OBSERVED'
    ),
    undefined
  );

  assert.equal(
    findDraft(
      createSnapshot({
        finalUrl:
          'http://example.com/page',
        headers: {
          'strict-transport-security': [
            'max-age=0'
          ],
          'content-security-policy': [
            "frame-ancestors 'self'"
          ],
          'x-content-type-options': [
            'nosniff'
          ]
        }
      }),
      'PS_HSTS_NOT_ENFORCING'
    ),
    undefined
  );

  const reportOnlySnapshot =
    createSnapshot({
      headers: {
        'strict-transport-security': [
          'max-age=1'
        ],
        'content-security-policy-report-only': [
          "default-src 'self'"
        ],
        'x-content-type-options': [
          'nosniff'
        ],
        'x-frame-options': [
          'DENY'
        ]
      }
    });

  const missingEnforcingCsp =
    requireDraft(
      reportOnlySnapshot,
      'PS_CSP_RESPONSE_HEADER_NOT_OBSERVED'
    );

  assertClassification(
    missingEnforcingCsp,
    {
      posture:
        'defense-in-depth-gap',
      severity:
        'low',
      confidence:
        'high'
    }
  );

  assert.equal(
    findDraft(
      createSnapshot(),
      'PS_CSP_RESPONSE_HEADER_NOT_OBSERVED'
    ),
    undefined
  );

  assert.equal(
    findDraft(
      createSnapshot({
        headers: {
          'strict-transport-security': [
            'max-age=1'
          ],
          'content-security-policy': [
            "default-src 'self'; frame-ancestors https://trusted.example"
          ],
          'x-content-type-options': [
            'nosniff'
          ]
        }
      }),
      'PS_FRAME_POLICY_NOT_OBSERVED'
    ),
    undefined
  );

  for (
    const xfoValue of
      [
        'DENY',
        'sameorigin'
      ]
  ) {
    assert.equal(
      findDraft(
        createSnapshot({
          headers: {
            'strict-transport-security': [
              'max-age=1'
            ],
            'content-security-policy': [
              "default-src 'self'"
            ],
            'x-content-type-options': [
              'nosniff'
            ],
            'x-frame-options': [
              xfoValue
            ]
          }
        }),
        'PS_FRAME_POLICY_NOT_OBSERVED'
      ),
      undefined
    );
  }

  const allowFromFrame =
    requireDraft(
      createSnapshot({
        headers: {
          'strict-transport-security': [
            'max-age=1'
          ],
          'content-security-policy': [
            "default-src 'self'"
          ],
          'x-content-type-options': [
            'nosniff'
          ],
          'x-frame-options': [
            'ALLOW-FROM https://trusted.example'
          ]
        }
      }),
      'PS_FRAME_POLICY_NOT_OBSERVED'
    );

  assertClassification(
    allowFromFrame,
    {
      posture:
        'informational',
      severity:
        'info',
      confidence:
        'high'
    }
  );

  for (
    const validNosniff of
      [
        'nosniff',
        ' NoSnIfF '
      ]
  ) {
    assert.equal(
      findDraft(
        createSnapshot({
          headers: {
            'strict-transport-security': [
              'max-age=1'
            ],
            'content-security-policy': [
              "frame-ancestors 'self'"
            ],
            'x-content-type-options': [
              validNosniff
            ]
          }
        }),
        'PS_NOSNIFF_NOT_ENFORCING'
      ),
      undefined
    );
  }

  for (
    const invalidNosniff of
      [
        undefined,
        'nosniff extra',
        'sniff'
      ]
  ) {
    const headers:
      PassivePageSecuritySnapshot[
        'headers'
      ] = {
        'strict-transport-security': [
          'max-age=1'
        ],
        'content-security-policy': [
          "frame-ancestors 'self'"
        ]
      };

    if (
      invalidNosniff !==
      undefined
    ) {
      headers[
        'x-content-type-options'
      ] = [
        invalidNosniff
      ];
    }

    const nosniff =
      requireDraft(
        createSnapshot({
          headers
        }),
        'PS_NOSNIFF_NOT_ENFORCING'
      );

    assertClassification(
      nosniff,
      {
        posture:
          'defense-in-depth-gap',
        severity:
          'low',
        confidence:
          'high'
      }
    );
  }

  const technologyDrafts =
    evaluatePassiveSecurity(
      createSnapshot({
        headers: {
          'strict-transport-security': [
            'max-age=1'
          ],
          'content-security-policy': [
            "frame-ancestors 'self'"
          ],
          'x-content-type-options': [
            'nosniff'
          ],
          server: [
            'fixture-server'
          ],
          'x-powered-by': [
            'fixture-runtime'
          ]
        }
      })
    )
      .filter(
        draft =>
          draft.code ===
          'PS_TECHNOLOGY_DISCLOSURE'
      );

  assert.deepEqual(
    technologyDrafts.map(
      draft =>
        draft.subject
    ),
    [
      'server',
      'x-powered-by'
    ]
  );

  for (
    const draft of
      technologyDrafts
  ) {
    assertClassification(
      draft,
      {
        posture:
          'informational',
        severity:
          'info',
        confidence:
          'high'
      }
    );
  }

  const registry =
    createPassiveSecurityRegistry();

  for (
    let pageNumber = 5;
    pageNumber >=
      1;
    pageNumber -=
      1
  ) {
    registerPassiveSecuritySnapshot(
      registry,
      createSnapshot({
        finalUrl:
          `https://example.com/page-${pageNumber}`,
        headers: {
          'content-security-policy': [
            "frame-ancestors 'self'"
          ],
          'x-content-type-options': [
            'nosniff'
          ]
        }
      })
    );
  }

  registerPassiveSecuritySnapshot(
    registry,
    createSnapshot({
      finalUrl:
        'https://other.example/page',
      headers: {
        'content-security-policy': [
          "frame-ancestors 'self'"
        ],
        'x-content-type-options': [
          'nosniff'
        ]
      }
    })
  );

  const report =
    getPassiveSecurityReport(
      registry
    );

  const equivalentRegistry =
    createPassiveSecurityRegistry();

  for (
    let pageNumber = 1;
    pageNumber <=
      5;
    pageNumber +=
      1
  ) {
    registerPassiveSecuritySnapshot(
      equivalentRegistry,
      createSnapshot({
        finalUrl:
          `https://example.com/page-${pageNumber}`,
        headers: {
          'content-security-policy': [
            "frame-ancestors 'self'"
          ],
          'x-content-type-options': [
            'nosniff'
          ]
        }
      })
    );
  }

  registerPassiveSecuritySnapshot(
    equivalentRegistry,
    createSnapshot({
      finalUrl:
        'https://other.example/page',
      headers: {
        'content-security-policy': [
          "frame-ancestors 'self'"
        ],
        'x-content-type-options': [
          'nosniff'
        ]
      }
    })
  );

  const equivalentReport =
    getPassiveSecurityReport(
      equivalentRegistry
    );

  assert.deepEqual(
    equivalentReport.observations,
    report.observations
  );

  assert.deepEqual(
    equivalentReport.summary,
    report.summary
  );

  const hstsObservations =
    report.observations.filter(
      observation =>
        observation.code ===
        'PS_HSTS_NOT_OBSERVED'
    );

  assert.equal(
    hstsObservations.length,
    2
  );

  assert.equal(
    hstsObservations.find(
      observation =>
        observation.scope.key ===
        'https://example.com'
    )
      ?.occurrences.length,
    5
  );

  assert.equal(
    report.summary.originsObserved,
    2
  );

  assert.deepEqual(
    report.observations.map(
      observation =>
        observation
          .observationReference
    ),
    report.observations.map(
      (
        _,
        index
      ) =>
        `security-observation-${index + 1}`
    )
  );

  assert.deepEqual(
    report.observations.map(
      observation =>
        observation.fingerprint
    ),
    [
      ...report
        .observations
        .map(
          observation =>
            observation.fingerprint
        )
    ].sort(
      (
        left,
        right
      ) =>
        left.localeCompare(
          right
        )
    )
  );

  assert.deepEqual(
    hstsObservations.find(
      observation =>
        observation.scope.key ===
        'https://example.com'
    )
      ?.occurrences
      .map(
        occurrence =>
          occurrence.pageUrl
      ),
    [
      1,
      2,
      3,
      4,
      5
    ].map(
      pageNumber =>
        `https://example.com/page-${pageNumber}`
    )
  );

  console.log(
    'Stage 7.1 deterministic passive-security rule and aggregation checks passed.'
  );
}

main();
