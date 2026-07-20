import { GoogleGenAI } from '@google/genai';

import {
  chromium
} from '@playwright/test';

import {
  z
} from 'zod';

import {
  inspectNavigation
} from './browser/inspect-navigation';

import {
  getSiteConfig
} from './sites';

const inspectNavigationArguments =
  z.object({
    reason:
      z
        .string()
        .min(1)
  });

const finishArguments =
  z.object({
    summary:
      z
        .string()
        .min(1)
  });

const inspectNavigationTool = {
  type:
    'function' as const,

  name:
    'inspect_navigation',

  description:
    'Choose this when the current website should be explored further by inspecting its public navigation links.',

  parameters: {
    type:
      'object',

    properties: {
      reason: {
        type:
          'string',

        description:
          'Why inspecting the navigation is the best next QA action.'
      }
    },

    required: [
      'reason'
    ]
  }
};

const finishTool = {
  type:
    'function' as const,

  name:
    'finish',

  description:
    'Choose this when the available page information is sufficient and no further exploration is needed.',

  parameters: {
    type:
      'object',

    properties: {
      summary: {
        type:
          'string',

        description:
          'A short summary explaining why the run should finish.'
      }
    },

    required: [
      'summary'
    ]
  }
};

async function main(): Promise<void> {
  const siteId =
    process.argv[2] ??
    'aidoc';

  const site =
    getSiteConfig(
      siteId
    );

  const configuredStartUrl =
    new URL(
      site.startUrl
    );

  if (
    !site.allowedHosts.includes(
      configuredStartUrl.hostname
    )
  ) {
    throw new Error(
      `Configured start host "${configuredStartUrl.hostname}" is not included in the allowedHosts list.`
    );
  }

  console.log(
    `Selected site: ${site.name}`
  );

  console.log(
    `Start URL: ${site.startUrl}`
  );

  const browser =
    await chromium.launch({
      headless:
        true
    });

  try {
    const page =
      await browser.newPage();

    await page.goto(
      site.startUrl,
      {
        waitUntil:
          'domcontentloaded'
      }
    );

    const currentHost =
      new URL(
        page.url()
      ).hostname;

    if (
      !site.allowedHosts.includes(
        currentHost
      )
    ) {
      throw new Error(
        `Browser reached disallowed host "${currentHost}".`
      );
    }

    const headings =
      await page
        .locator(
          'h1, h2'
        )
        .allTextContents();

    const observations = {
      siteId:
        site.id,

      siteName:
        site.name,

      title:
        await page.title(),

      url:
        page.url(),

      headings:
        headings
          .map(
            heading =>
              heading.trim()
          )
          .filter(
            heading =>
              heading.length >
              0
          )
          .slice(
            0,
            10
          )
    };

    console.log(
      '\nPlaywright observations:'
    );

    console.log(
      JSON.stringify(
        observations,
        null,
        2
      )
    );

    const ai =
      new GoogleGenAI({});

    const interaction =
      await ai.interactions.create({
        model:
          'gemini-3.5-flash',

        /*
         * Explicitly request a non-streaming interaction so TypeScript
         * knows the returned value contains completed interaction steps.
         */
        stream:
          false,

        store:
          false,

        input: `
You are a cautious QA agent testing the public website "${site.name}".

Mission:
Decide whether the website's navigation should be inspected as the next testing action.

Rules:
- Use only the supplied observations.
- Do not invent website behavior.
- Do not request destructive actions.
- Form submission is allowed: ${site.allowFormSubmission}.
- Choose exactly one available function.

Page observations:
${JSON.stringify(
  observations,
  null,
  2
)}
`,

        tools: [
          inspectNavigationTool,
          finishTool
        ],

        generation_config: {
          tool_choice:
            'any',

          thinking_level:
            'low'
        }
      });

    const functionCalls =
      (
        interaction.steps ??
        []
      ).filter(
        step =>
          step.type ===
          'function_call'
      );

    if (
      functionCalls.length !==
      1
    ) {
      throw new Error(
        `Expected exactly one agent decision, received ${functionCalls.length}.`
      );
    }

    const decision =
      functionCalls[0];

    if (
      decision.name ===
      'inspect_navigation'
    ) {
      const argumentsResult =
        inspectNavigationArguments.parse(
          decision.arguments
        );

      console.log(
        '\nAgent decision: INSPECT NAVIGATION'
      );

      console.log(
        `Reason: ${argumentsResult.reason}`
      );

      const navigationLinks =
        await inspectNavigation(
          page,
          site.allowedHosts
        );

      console.log(
        `\nAction executed: found ${navigationLinks.length} safe navigation links.`
      );

      console.log(
        JSON.stringify(
          navigationLinks,
          null,
          2
        )
      );

      return;
    }

    if (
      decision.name ===
      'finish'
    ) {
      const argumentsResult =
        finishArguments.parse(
          decision.arguments
        );

      console.log(
        '\nAgent decision: FINISH'
      );

      console.log(
        `Summary: ${argumentsResult.summary}`
      );

      return;
    }

    throw new Error(
      `Unexpected agent function: ${decision.name}`
    );
  } finally {
    await browser.close();
  }
}

main().catch(
  (error: unknown) => {
    console.error(
      'Agent decision failed:',
      error
    );

    process.exitCode =
      1;
  }
);
