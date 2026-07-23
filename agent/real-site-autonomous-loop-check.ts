import { chromium } from '@playwright/test';

import { analyzePageForQa } from './analysis/analyze-page-for-qa';
import { classifyDiagnostics } from './analysis/classify-diagnostics';
import { evaluatePageObservation } from './analysis/evaluate-page';
import { collectPageDiagnostics } from './browser/collect-page-diagnostics';
import { extractPageContent } from './browser/extract-page-content';
import { inspectNavigation } from './browser/inspect-navigation';
import { visitApprovedLink } from './browser/visit-approved-link';
import { assignPageCandidateReferences } from './investigation/page-candidates';
import { runExploratoryLoop } from './planning/run-exploratory-loop';
import { getSiteConfig } from './sites';

async function main(): Promise<void> {
  const siteId =
    process.argv[2] ?? 'aidoc';

  const site =
    getSiteConfig(siteId);

const maxSteps =
  site.maxExploratoryStepsPerPage;

  console.log(
    'Running constrained real-site autonomous exploration...\n'
  );

  console.log(
    `Selected site: ${site.name}`
  );

  console.log(
    `Start URL: ${site.startUrl}`
  );

  console.log(
    `Maximum autonomous steps: ${maxSteps}`
  );

  console.log(
    `Form submission allowed by site config: ${site.allowFormSubmission}`
  );

  if (
    site.allowFormSubmission !== false
  ) {
    throw new Error(
      'This controlled real-site autonomous check requires allowFormSubmission=false.'
    );
  }

  const browser =
    await chromium.launch({
      headless: true
    });

  try {
    const page =
      await browser.newPage({
        viewport: {
          width: 1280,
          height: 720
        }
      });

    const diagnosticsCollector =
      collectPageDiagnostics(page);

    try {
      /*
       * Phase 1:
       * Safely reach one approved real page.
       */
      const homepageResponse =
        await page.goto(
          site.startUrl,
          {
            waitUntil:
              'domcontentloaded',

            timeout:
              30_000
          }
        );

      const homepageUrl =
        new URL(
          page.url()
        );

      if (
        !site.allowedHosts.includes(
          homepageUrl.hostname
        )
      ) {
        throw new Error(
          `Homepage redirected to disallowed host "${homepageUrl.hostname}".`
        );
      }

      console.log(
        '\nHomepage opened:'
      );

      console.log(
        `HTTP status: ${homepageResponse?.status() ?? 'unknown'}`
      );

      console.log(
        `Final URL: ${homepageUrl.toString()}`
      );

      console.log(
        `Title: ${await page.title()}`
      );

      const navigationLinks =
        await inspectNavigation(
          page,
          site.allowedHosts
        );

      const targetLink =
        navigationLinks.find(
          link =>
            link.url !==
              site.startUrl &&
            link.url !==
              homepageUrl.toString()
        );

      if (!targetLink) {
        throw new Error(
          'No safe non-homepage navigation target was found.'
        );
      }

      console.log(
        '\nDeterministically selected autonomous test page:'
      );

      console.log(
        `Text: ${targetLink.text}`
      );

      console.log(
        `URL: ${targetLink.url}`
      );

      diagnosticsCollector.reset();

      const pageObservation =
        await visitApprovedLink(
          page,
          targetLink,
          site.allowedHosts
        );

      await page.waitForTimeout(
        1_000
      );

      console.log(
        '\nApproved page opened:'
      );

      console.log(
        `HTTP status: ${pageObservation.httpStatus ?? 'unknown'}`
      );

      console.log(
        `Final URL: ${pageObservation.finalUrl}`
      );

      console.log(
        `Title: ${pageObservation.title}`
      );

      /*
       * Phase 2:
       * Observe the page before autonomous interaction.
       */
      const diagnostics =
        diagnosticsCollector.snapshot();

      const classifiedDiagnostics =
        classifyDiagnostics(
          diagnostics
        );

      const ruleBasedFindings =
        evaluatePageObservation(
          pageObservation
        );

      const initialContent =
        await extractPageContent(
          page
        );

      console.log(
        '\nInitial structured page observation:'
      );

      console.log(
        `Headings: ${initialContent.headings.length}`
      );

      console.log(
        `Buttons: ${initialContent.buttons.length}`
      );

      console.log(
        `Text fields: ${initialContent.textFields.length}`
      );

      console.log(
        `Select controls: ${initialContent.selects.length}`
      );

      console.log(
        `Links: ${initialContent.links.length}`
      );

      const containsPasswordField =
        initialContent.textFields.some(
          field =>
            field.inputType ===
            'password'
        );

      if (containsPasswordField) {
        throw new Error(
          'Controlled real-site autonomous run aborted because a password field was detected.'
        );
      }

      /*
       * Phase 3:
       * Let the existing exploratory QA analyzer inspect the page.
       *
       * Its findings are hypotheses/candidate issues.
       * They are not yet treated as confirmed defects.
       */
      console.log(
        '\nRunning exploratory QA analysis before autonomous interaction...'
      );

      const exploratoryQaAnalysis =
        await analyzePageForQa({
          observation:
            pageObservation,

          content:
            initialContent,

          classifiedDiagnostics,

          ruleBasedFindings
        });

      const pageCandidates =
        assignPageCandidateReferences(
          exploratoryQaAnalysis.findings
        );

      console.log(
        '\nCandidate QA findings:'
      );

      if (
        exploratoryQaAnalysis.findings.length ===
        0
      ) {
        console.log(
          'No candidate findings were produced.'
        );
      } else {
        for (
          let index = 0;
          index <
          exploratoryQaAnalysis.findings.length;
          index += 1
        ) {
          const finding =
            exploratoryQaAnalysis.findings[
              index
            ];

          console.log(
            `\nCandidate ${index + 1}:`
          );

          console.log(
            `Title: ${finding.title}`
          );

          console.log(
            `Category: ${finding.category}`
          );

          console.log(
            `Severity: ${finding.severity}`
          );

          console.log(
            `Confidence: ${finding.confidence}`
          );

          console.log(
            `Evidence: ${finding.evidence}`
          );

          console.log(
            `Suggested check: ${finding.suggestedCheck}`
          );

          console.log(
            `Evidence target: ${JSON.stringify(
              finding.evidenceTarget
            )}`
          );
        }
      }

      /*
       * Phase 4:
       * Give the autonomous planner BOTH:
       *
       * - the live browser state;
       * - candidate findings from the QA analyzer.
       *
       * The planner may prioritize a candidate finding when a safe
       * supported action can investigate it.
       */
      console.log(
        '\nAutonomous planner is now active.'
      );

      console.log(
        'Safety boundaries:'
      );

      console.log(
        '- maximum 3 planner decisions'
      );

      console.log(
        '- no form submission action exists'
      );

      console.log(
        '- no arbitrary click action exists'
      );

      console.log(
        '- no arbitrary selectors'
      );

      console.log(
        '- no arbitrary JavaScript'
      );

      console.log(
        '- deterministic Playwright executor only'
      );

      console.log(
        `- candidate findings supplied: ${exploratoryQaAnalysis.findings.length}`
      );

      const result =
        await runExploratoryLoop(
          page,
          pageObservation.finalUrl,
          maxSteps,
          pageCandidates
        );

      /*
       * Confirm that autonomous interaction remained inside the
       * configured host boundary.
       */
      const finalUrl =
        new URL(
          page.url()
        );

      if (
        !site.allowedHosts.includes(
          finalUrl.hostname
        )
      ) {
        throw new Error(
          `Autonomous exploration escaped to disallowed host "${finalUrl.hostname}".`
        );
      }

      console.log(
        '\nReal-site autonomous exploration completed.\n'
      );

      console.log(
        `Stop reason: ${result.stopReason}`
      );

      console.log(
        `Planner decisions: ${result.plannerDecisionCount}/${result.maxPlannerDecisions}`
      );

      console.log(
        `Executed candidate-investigation actions: ${result.executedInvestigationActionCount}`
      );

      console.log(
        `Final URL: ${finalUrl.toString()}`
      );

      console.log(
        '\nAutonomous action history:'
      );

      for (
        const step of result.steps
      ) {
        console.log(
          `\n--- Step ${step.step} ---`
        );

        console.log(
          `Hypothesis: ${step.decision.hypothesis}`
        );

        console.log(
          `Reasoning: ${step.decision.reasoning}`
        );

        console.log(
          `Action: ${JSON.stringify(
            step.decision.action
          )}`
        );

        console.log(
          `Expected observation: ${step.decision.expectedObservation}`
        );

        console.log(
          `Execution status: ${step.executionResult.status}`
        );

        console.log(
          `Execution detail: ${step.executionResult.detail}`
        );
      }

      const finalContent =
        await extractPageContent(
          page
        );

      console.log(
        '\nFinal interactive page state:\n'
      );

      console.log(
        JSON.stringify(
          {
            textFields:
              finalContent.textFields,

            selects:
              finalContent.selects
          },
          null,
          2
        )
      );

      if (
        result.plannerDecisionCount >
        maxSteps
      ) {
        throw new Error(
          `Autonomous loop exceeded hard limit of ${maxSteps} steps.`
        );
      }

      console.log(
        '\nConstrained analyzer-guided real-site autonomous exploration check passed.'
      );

      console.log(
        '\nFlow proven on real site:'
      );

      console.log(
        'Observe → Analyze → Prioritize Candidate → Plan → Validate → Execute → Observe → Repeat'
      );
    } finally {
      diagnosticsCollector.dispose();
    }
  } finally {
    await browser.close();
  }
}

main().catch(
  (error: unknown) => {
    console.error(
      '\nReal-site autonomous exploration check failed.'
    );

    if (
      error instanceof Error
    ) {
      console.error(
        error.message
      );
    } else {
      console.error(
        error
      );
    }

    process.exitCode = 1;
  }
);
