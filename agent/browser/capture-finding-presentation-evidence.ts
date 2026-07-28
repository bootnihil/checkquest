import {
  mkdir
} from 'node:fs/promises';
import {
  join
} from 'node:path';

import type {
  Page
} from '@playwright/test';

import type {
  ExploratoryQaFinding,
  FindingPresentationTarget
} from '../analysis/exploratory-qa-schema';
import {
  runPageOperationWithCancellation
} from './run-page-operation-with-cancellation';

type InvestigationEvidenceTarget =
  NonNullable<
    ExploratoryQaFinding[
      'evidenceTarget'
    ]
  >;

export type FindingVisualTarget =
  FindingPresentationTarget |
  InvestigationEvidenceTarget;

export interface VisualTargetBox {
  x:
    number;
  y:
    number;
  width:
    number;
  height:
    number;
}

export interface FocusedEvidenceTargetGroup {
  boxes:
    VisualTargetBox[];
}

export interface FocusedEvidenceClip {
  x:
    number;
  y:
    number;
  width:
    number;
  height:
    number;
}

export interface FocusedEvidenceCapture {
  screenshotPaths:
    string[];
  totalTargetCount:
    number;
  shownTargetCount:
    number;
  replay:
    {
      action:
        'select-option';
      restored:
        boolean;
    } |
    null;
}

export interface FocusedEvidenceCaptureDependencies {
  captureScreenshot?:
    (
      page:
        Page,
      filePath:
        string,
      clip:
        FocusedEvidenceClip
    ) => Promise<unknown>;
}

const maximumFocusedEvidenceImages =
  3;
const focusedEvidencePadding =
  28;
const annotationAttribute =
  'data-checkquest-presentation-evidence';

function formatSequenceNumber(
  value:
    number
): string {
  return String(
    value
  ).padStart(
    2,
    '0'
  );
}

export function groupFocusedEvidenceTargets(
  boxes:
    readonly VisualTargetBox[],
  viewportHeight:
    number
): FocusedEvidenceTargetGroup[] {
  const sortedBoxes =
    [
      ...boxes
    ].sort(
      (
        left,
        right
      ) =>
        left.y -
          right.y ||
        left.x -
          right.x
    );
  const groups:
    FocusedEvidenceTargetGroup[] =
      [];

  for (
    const box of
      sortedBoxes
  ) {
    const currentGroup =
      groups.at(
        -1
      );

    if (
      currentGroup ===
        undefined
    ) {
      groups.push({
        boxes:
          [
            box
          ]
      });
      continue;
    }

    const groupTop =
      Math.min(
        ...currentGroup
          .boxes
          .map(
            item =>
              item.y
          )
      );
    const combinedBottom =
      Math.max(
        box.y +
          box.height,
        ...currentGroup
          .boxes
          .map(
            item =>
              item.y +
              item.height
          )
      );

    if (
      combinedBottom -
        groupTop <=
      viewportHeight
    ) {
      currentGroup
        .boxes
        .push(
          box
        );
    } else {
      groups.push({
        boxes:
          [
            box
          ]
      });
    }
  }

  return groups;
}

export function calculateFocusedEvidenceClip(
  group:
    FocusedEvidenceTargetGroup,
  documentSize: {
    width:
      number;
    height:
      number;
  },
  padding =
    focusedEvidencePadding
): FocusedEvidenceClip {
  const left =
    Math.min(
      ...group.boxes.map(
        box =>
          box.x
      )
    );
  const top =
    Math.min(
      ...group.boxes.map(
        box =>
          box.y
      )
    );
  const right =
    Math.max(
      ...group.boxes.map(
        box =>
          box.x +
          box.width
      )
    );
  const bottom =
    Math.max(
      ...group.boxes.map(
        box =>
          box.y +
          box.height
      )
    );
  const x =
    Math.max(
      0,
      Math.floor(
        left -
          padding
      )
    );
  const y =
    Math.max(
      0,
      Math.floor(
        top -
          padding
      )
    );
  const clippedRight =
    Math.min(
      documentSize.width,
      Math.ceil(
        right +
          padding
      )
    );
  const clippedBottom =
    Math.min(
      documentSize.height,
      Math.ceil(
        bottom +
          padding
      )
    );

  return {
    x,
    y,
    width:
      Math.max(
        1,
        clippedRight -
          x
      ),
    height:
      Math.max(
        1,
        clippedBottom -
          y
      )
  };
}

async function resolveVisualTargetBoxes(
  page:
    Page,
  target:
    FindingVisualTarget
): Promise<VisualTargetBox[]> {
  return page.evaluate(
    targetValue => {
      /*
       * Object methods remain browser-native when TS runtime loaders
       * serialize this callback. Assigned helper functions may be
       * decorated with Node-side naming helpers that do not exist here.
       */
      const browserUtilities = {
        normalize(
          value:
            string | null
        ): string {
          return (
            value ??
            ''
          )
            .replace(
              /\s+/g,
              ' '
            )
            .trim();
        },
        isVisible(
          element:
            Element
        ): boolean {
          const style =
            window
              .getComputedStyle(
                element
              );
          const rectangle =
            element
              .getBoundingClientRect();

          return (
            style.display !==
              'none' &&
            style.visibility !==
              'hidden' &&
            Number(
              style.opacity
            ) !==
              0 &&
            rectangle.width >
              0 &&
            rectangle.height >
              0
          );
        },
        accessibleName(
          element:
            Element
        ): string {
          const labelledBy =
            element.getAttribute(
              'aria-labelledby'
            );

          if (
            labelledBy !==
              null
          ) {
            const labelledText =
              labelledBy
                .split(
                  /\s+/
                )
                .map(
                  id =>
                    document
                      .getElementById(
                        id
                      )
                      ?.textContent ??
                    ''
                )
                .join(
                  ' '
                );

            if (
              browserUtilities.normalize(
                labelledText
              ) !==
                ''
            ) {
              return browserUtilities.normalize(
                labelledText
              );
            }
          }

          return browserUtilities.normalize(
            element.getAttribute(
              'aria-label'
            ) ??
            element.textContent
          );
        }
      };
      let candidates:
        Element[];

      if (
        targetValue.kind ===
          'visible-text'
      ) {
        const selector =
          targetValue
            .elementKind ===
              'heading'
            ? 'h1,h2,h3,h4,h5,h6,[role="heading"]'
            : targetValue
                .elementKind ===
                  'link'
              ? 'a,[role="link"]'
              : 'button,[role="button"],input[type="button"],input[type="submit"]';

        candidates =
          [
            ...document
              .querySelectorAll(
                selector
              )
          ].filter(
            element =>
              browserUtilities.accessibleName(
                element
              ) ===
                browserUtilities.normalize(
                  targetValue.text
                )
          );
      } else if (
        targetValue.kind ===
          'select-option'
      ) {
        candidates =
          [
            ...document
              .querySelectorAll(
                'select'
              )
          ].filter(
            element => {
              const select =
                element as
                  HTMLSelectElement;
              const labels =
                [
                  ...document
                    .querySelectorAll(
                      'label'
                    )
                ]
                  .filter(
                    label =>
                      label.htmlFor ===
                        select.id ||
                      label.contains(
                        select
                      )
                  )
                  .map(
                    label =>
                      browserUtilities.normalize(
                        label.textContent
                      )
                  );
              const matchesIdentity =
                (
                  targetValue
                    .controlId !==
                    null &&
                  select.id ===
                    targetValue
                      .controlId
                ) ||
                (
                  targetValue
                    .controlName !==
                    null &&
                  select.name ===
                    targetValue
                      .controlName
                ) ||
                (
                  targetValue
                    .controlLabel !==
                    null &&
                  labels.includes(
                    browserUtilities.normalize(
                      targetValue
                        .controlLabel
                    )
                  )
                );
              const hasOption =
                [
                  ...select.options
                ].some(
                  option =>
                    browserUtilities.normalize(
                      option.textContent
                    ) ===
                      browserUtilities.normalize(
                        targetValue
                          .optionText
                      )
                );

              return (
                matchesIdentity &&
                hasOption
              );
            }
          );
      } else {
        const expectedRole =
          targetValue.kind ===
            'tab-state'
            ? 'tab'
            : 'button';
        candidates =
          [
            ...document
              .querySelectorAll(
                `[role="${expectedRole}"],button,[id]`
              )
          ].filter(
            element =>
              (
                targetValue
                  .controlId !==
                  null &&
                element.id ===
                  targetValue
                    .controlId
              ) ||
              (
                targetValue
                  .accessibleName !==
                  null &&
                browserUtilities.accessibleName(
                  element
                ) ===
                  browserUtilities.normalize(
                    targetValue
                      .accessibleName
                  )
              )
          );
      }

      return candidates
        .filter(
          (
            element,
            index,
            all
          ) =>
            browserUtilities.isVisible(
              element
            ) &&
            all.indexOf(
              element
            ) ===
              index
        )
        .map(
          element => {
            const rectangle =
              element
                .getBoundingClientRect();

            return {
              x:
                rectangle.left +
                window.scrollX,
              y:
                rectangle.top +
                window.scrollY,
              width:
                rectangle.width,
              height:
                rectangle.height
            };
          }
        );
    },
    target
  );
}

async function addEvidenceAnnotations(
  page:
    Page,
  boxes:
    readonly VisualTargetBox[]
): Promise<void> {
  await page.evaluate(
    (
      input
    ) => {
      for (
        const [
          index,
          box
        ] of
        input.boxes.entries()
      ) {
        const annotation =
          document.createElement(
            'div'
          );
        annotation.setAttribute(
          input.attribute,
          'true'
        );
        Object.assign(
          annotation.style,
          {
            position:
              'absolute',
            zIndex:
              '2147483647',
            pointerEvents:
              'none',
            boxSizing:
              'border-box',
            left:
              `${box.x - 3}px`,
            top:
              `${box.y - 3}px`,
            width:
              `${box.width + 6}px`,
            height:
              `${box.height + 6}px`,
            border:
              '3px solid #e11d48',
            borderRadius:
              '4px',
            background:
              'transparent',
            overflow:
              'visible'
          }
        );
        const label =
          document.createElement(
            'span'
          );
        label.textContent =
          `CheckQuest evidence ${index + 1}`;
        Object.assign(
          label.style,
          {
            position:
              'absolute',
            left:
              '-3px',
            top:
              box.y >
                24
                ? '-24px'
                : `${box.height + 6}px`,
            color:
              '#ffffff',
            background:
              'rgba(225, 29, 72, 0.96)',
            borderRadius:
              '3px',
            font:
              '600 12px/18px system-ui, sans-serif',
            padding:
              '1px 5px',
            whiteSpace:
              'nowrap'
          }
        );
        annotation.append(
          label
        );
        document.body.append(
          annotation
        );
      }
    },
    {
      boxes,
      attribute:
        annotationAttribute
    }
  );
}

async function removeEvidenceAnnotations(
  page:
    Page,
  scrollPosition: {
    x:
      number;
    y:
      number;
  }
): Promise<void> {
  await page.evaluate(
    (
      input
    ) => {
      for (
        const annotation of
        document.querySelectorAll(
          `[${input.attribute}]`
        )
      ) {
        annotation.remove();
      }

      window.scrollTo(
        input.scrollPosition.x,
        input.scrollPosition.y
      );
    },
    {
      attribute:
        annotationAttribute,
      scrollPosition
    }
  );
}

export async function captureFindingPresentationEvidence(
  page:
    Page,
  input: {
    runId:
      string;
    pageNumber:
      number;
    candidateNumber:
      number;
    target:
      FindingVisualTarget;
    allowObservedStateReplay?:
      boolean;
    signal?:
      AbortSignal;
  },
  dependencies: FocusedEvidenceCaptureDependencies =
    {}
): Promise<FocusedEvidenceCapture> {
  if (
    input.target.kind ===
      'select-option' &&
    input.allowObservedStateReplay !==
      true
  ) {
    return {
      screenshotPaths:
        [],
      totalTargetCount:
        0,
      shownTargetCount:
        0,
      replay:
        null
    };
  }

  const [
    boxes,
    viewport,
    documentSize,
    scrollPosition
  ] =
    await Promise.all([
      resolveVisualTargetBoxes(
        page,
        input.target
      ),
      page.evaluate(
        () => ({
          width:
            window.innerWidth,
          height:
            window.innerHeight
        })
      ),
      page.evaluate(
        () => ({
          width:
            Math.max(
              document.documentElement
                .scrollWidth,
              document.body
                ?.scrollWidth ??
                0,
              window.innerWidth
            ),
          height:
            Math.max(
              document.documentElement
                .scrollHeight,
              document.body
                ?.scrollHeight ??
                0,
              window.innerHeight
            )
        })
      ),
      page.evaluate(
        () => ({
          x:
            window.scrollX,
          y:
            window.scrollY
        })
      )
    ]);

  if (
    boxes.length ===
      0
  ) {
    return {
      screenshotPaths:
        [],
      totalTargetCount:
        0,
      shownTargetCount:
        0,
      replay:
        null
    };
  }

  const selectedGroups =
    groupFocusedEvidenceTargets(
      boxes,
      viewport.height
    ).slice(
      0,
      maximumFocusedEvidenceImages
    );
  const selectedBoxes =
    selectedGroups.flatMap(
      group =>
        group.boxes
    );
  const screenshotPaths:
    string[] =
      [];
  const evidenceDirectory =
    join(
      'agent-results',
      input.runId,
      'evidence'
    );

  await mkdir(
    evidenceDirectory,
    {
      recursive:
        true
    }
  );

  let replayOriginalValue:
    string | null =
      null;
  let replayRestored =
    false;

  if (
    input.target.kind ===
      'select-option'
  ) {
    replayOriginalValue =
      await page.evaluate(
        target => {
          const select =
            [
              ...document.querySelectorAll(
                'select'
              )
            ].find(
              candidate =>
                (
                  target.controlId !==
                    null &&
                  candidate.id ===
                    target.controlId
                ) ||
                (
                  target.controlName !==
                    null &&
                  candidate.getAttribute(
                    'name'
                  ) ===
                    target.controlName
                )
            ) as
              HTMLSelectElement |
              undefined;
          const option =
            select ===
              undefined
              ? undefined
              : [
                  ...select.options
                ].find(
                  item =>
                    (
                      item.textContent ??
                      ''
                    )
                      .replace(
                        /\s+/g,
                        ' '
                      )
                      .trim() ===
                    target.optionText
                );

          if (
            select ===
              undefined ||
            option ===
              undefined
          ) {
            return null;
          }

          const originalValue =
            select.value;
          select.value =
            option.value;
          select.dispatchEvent(
            new Event(
              'input',
              {
                bubbles:
                  true
              }
            )
          );
          select.dispatchEvent(
            new Event(
              'change',
              {
                bubbles:
                  true
              }
            )
          );
          return originalValue;
        },
        input.target
      );

    if (
      replayOriginalValue ===
        null
    ) {
      return {
        screenshotPaths:
          [],
        totalTargetCount:
          0,
        shownTargetCount:
          0,
        replay:
          null
      };
    }
  }

  try {
    await addEvidenceAnnotations(
      page,
      selectedBoxes
    );

    for (
      const [
        groupIndex,
        group
      ] of
      selectedGroups.entries()
    ) {
      const filePath =
        join(
          evidenceDirectory,
          `page-${formatSequenceNumber(
            input.pageNumber
          )}-finding-${formatSequenceNumber(
            input.candidateNumber
          )}-evidence-${formatSequenceNumber(
            groupIndex + 1
          )}.png`
        );
      const clip =
        calculateFocusedEvidenceClip(
          group,
          documentSize
        );
      const desiredScrollY =
        Math.min(
          clip.y,
          Math.max(
            0,
            documentSize.height -
              viewport.height
          )
        );

      await page.evaluate(
        scrollY =>
          window.scrollTo(
            0,
            scrollY
          ),
        desiredScrollY
      );
      const actualScrollY =
        await page.evaluate(
          () =>
            window.scrollY
        );
      const viewportY =
        Math.max(
          0,
          clip.y -
            actualScrollY
        );
      const viewportClip: FocusedEvidenceClip = {
        x:
          clip.x,
        y:
          viewportY,
        width:
          Math.min(
            clip.width,
            viewport.width -
              clip.x
          ),
        height:
          Math.max(
            1,
            Math.min(
              clip.height,
              viewport.height -
                viewportY
            )
          )
      };

      await runPageOperationWithCancellation(
        page,
        async () =>
          dependencies
            .captureScreenshot !==
              undefined
            ? dependencies
                .captureScreenshot(
                  page,
                  filePath,
                  viewportClip
                )
            : page.screenshot({
                path:
                  filePath,
                clip:
                  viewportClip
              }),
        {
          signal:
            input.signal,
          runId:
            input.runId,
          phase:
            'focused-evidence-screenshot'
        }
      );
      screenshotPaths.push(
        filePath
      );
    }
  } finally {
    if (
      !page.isClosed()
    ) {
      await removeEvidenceAnnotations(
        page,
        scrollPosition
      ).catch(
        () => undefined
      );

      if (
        input.target.kind ===
          'select-option' &&
        replayOriginalValue !==
          null
      ) {
        replayRestored =
          await page.evaluate(
            (
              restore
            ) => {
              const select =
                [
                  ...document.querySelectorAll(
                    'select'
                  )
                ].find(
                  candidate =>
                    (
                      restore.controlId !==
                        null &&
                      candidate.id ===
                        restore.controlId
                    ) ||
                    (
                      restore.controlName !==
                        null &&
                      candidate.getAttribute(
                        'name'
                      ) ===
                        restore.controlName
                    )
                ) as
                  HTMLSelectElement |
                  undefined;

              if (
                select ===
                  undefined
              ) {
                return false;
              }

              select.value =
                restore.value;
              select.dispatchEvent(
                new Event(
                  'input',
                  {
                    bubbles:
                      true
                  }
                )
              );
              select.dispatchEvent(
                new Event(
                  'change',
                  {
                    bubbles:
                      true
                  }
                )
              );
              return (
                select.value ===
                restore.value
              );
            },
            {
              controlId:
                input.target
                  .controlId,
              controlName:
                input.target
                  .controlName,
              value:
                replayOriginalValue
            }
          ).catch(
            () =>
              false
          );
      }
    }
  }

  return {
    screenshotPaths,
    totalTargetCount:
      boxes.length,
    shownTargetCount:
      selectedBoxes.length,
    replay:
      input.target.kind ===
        'select-option'
        ? {
            action:
              'select-option',
            restored:
              replayRestored
          }
        : null
  };
}
