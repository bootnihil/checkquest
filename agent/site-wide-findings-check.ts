import type {
  ExploratoryQaFinding
} from './analysis/exploratory-qa-schema';

import {
  buildSiteWideExploratoryFindings
} from './reporting/build-site-wide-exploratory-findings';
import {
  reconcileFindingObservations
} from './findings/reconcile-finding-observations';
import {
  createUnifiedFindingRegistry,
  getUnifiedFindings,
  registerUnifiedPageFindings
} from './findings/unified-finding-registry';

function createCountryFinding(
  title: string,
  controlLabel: string | null,
  controlName: string | null,
  category:
    ExploratoryQaFinding['category'] =
      'content'
): ExploratoryQaFinding {
  return {
    category,

    severity:
      'low',

    confidence:
      'high',

    title,

    evidence:
      'The country dropdown contains both "Ecuador" and "Equador".',

    reasoning:
      'Equador appears to be a misspelling of Ecuador.',

    suggestedCheck:
      'Confirm whether both options are selectable.',

    evidenceTarget: {
      kind:
        'select-option',

      controlLabel,

      controlName,

      controlId:
        null,

      optionText:
        'Equador'
    }
  };
}

function main(): void {
  const registry =
    createUnifiedFindingRegistry();

  const pages:
    {
      pageUrl: string;
      pageTitle: string;
      screenshotPath: string;
      modelFindings:
        ExploratoryQaFinding[];
    }[] = [
    {
        pageUrl:
          'https://example.com/radiology',

        pageTitle:
          'Radiology',

        screenshotPath:
          'page-01.png',

        modelFindings: [
          createCountryFinding(
            'Misspelled country name in selection list',
            'COUNTRY*',
            'country'
          )
        ]
      },
    {
        pageUrl:
          'https://example.com/platform',

        pageTitle:
          'Platform',

        screenshotPath:
          'page-02.png',

        modelFindings: [
          createCountryFinding(
            'Misspelled country name in registration form',
            'Country',
            'country'
          )
        ]
      },
    {
        pageUrl:
          'https://example.com/solutions',

        pageTitle:
          'Solutions',

        screenshotPath:
          'page-03.png',

        modelFindings: [
          /*
           * Deliberately classify this occurrence differently
           * from the first two.
           *
           * Structured target identity should still group all
           * three occurrences into one site-wide finding.
           */
          createCountryFinding(
            'Misspelled country option in form',
            null,
            'country',
            'consistency'
          ),

          {
            category:
              'content',

            severity:
              'medium',

            confidence:
              'high',

            title:
              'Broken product heading',

            evidence:
              'The heading contains repeated text.',

            reasoning:
              'Repeated words reduce content quality.',

            suggestedCheck:
              'Review the heading copy.',

            evidenceTarget:
              null
          }
        ]
      }
  ];

  for (
    const page of
      pages
  ) {
    const reconciled =
      reconcileFindingObservations({
        pageUrl:
          page.pageUrl,
        pageTitle:
          page.pageTitle,
        ruleFindings: [],
        modelFindings:
          page.modelFindings,
        screenshotReferences: [
          page.screenshotPath
        ]
      });

    registerUnifiedPageFindings(
      registry,
      reconciled.findings
    );
  }

  const canonicalFindings =
    getUnifiedFindings(
      registry
    );

  /*
   * Deliberately change both finding order and occurrence order.
   *
   * Compatibility page numbers must still come from the authoritative
   * inspected-page sequence rather than first occurrence traversal.
   */
  const reorderedCanonicalFindings =
    [
      ...canonicalFindings
    ]
      .reverse()
      .map(
        finding => ({
          ...finding,
          occurrences: [
            ...finding.occurrences
          ].reverse()
        })
      );

  const siteWideFindings =
    buildSiteWideExploratoryFindings(
      reorderedCanonicalFindings,
      pages.map(
        page =>
          page.pageUrl
      )
    );

  if (
    siteWideFindings.length !==
    2
  ) {
    throw new Error(
      `Expected 2 site-wide findings, received ${siteWideFindings.length}.`
    );
  }

  const countryFinding =
    siteWideFindings.find(
      finding =>
        finding.fingerprint ===
        'target|select-option|country|equador'
    );

  if (
    !countryFinding
  ) {
    throw new Error(
      'The repeated country-option issue was not grouped under the expected fingerprint.'
    );
  }

  if (
    countryFinding.occurrenceCount !==
    3
  ) {
    throw new Error(
      `Expected 3 country finding occurrences, received ${countryFinding.occurrenceCount}.`
    );
  }

  if (
    countryFinding.affectedPageCount !==
    3
  ) {
    throw new Error(
      `Expected 3 affected pages, received ${countryFinding.affectedPageCount}.`
    );
  }

  const pageNumberByUrl =
    new Map(
      countryFinding
        .occurrences
        .map(
          occurrence => [
            occurrence.pageUrl,
            occurrence.pageNumber
          ]
        )
    );

  if (
    pageNumberByUrl.get(
      'https://example.com/radiology'
    ) !==
      1 ||
    pageNumberByUrl.get(
      'https://example.com/platform'
    ) !==
      2 ||
    pageNumberByUrl.get(
      'https://example.com/solutions'
    ) !==
      3
  ) {
    throw new Error(
      'Compatibility page numbers became detached from the authoritative inspected-page sequence.'
    );
  }

  const brokenHeadingFinding =
    siteWideFindings.find(
      finding =>
        finding.fingerprint !==
        countryFinding.fingerprint
    );

  if (
    brokenHeadingFinding
      ?.occurrences[0]
      ?.pageNumber !==
    3
  ) {
    throw new Error(
      'A finding encountered first during aggregation incorrectly renumbered its inspected page.'
    );
  }

  console.log(
    'Site-wide exploratory finding grouping passed.'
  );

  console.log(
    JSON.stringify(
      siteWideFindings,
      null,
      2
    )
  );
}

main();
