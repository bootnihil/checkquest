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

interface ResolvedVisualTargetBox extends
  VisualTargetBox {
  targetIndex:
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
const targetAttribute =
  'data-checkquest-presentation-evidence-target';
const highlightAttribute =
  'data-checkquest-presentation-evidence-highlight';
const annotationStyleAttribute =
  'data-checkquest-presentation-evidence-style';

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
): Promise<ResolvedVisualTargetBox[]> {
  return page.evaluate(
    input => {
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

          if (
            'checkVisibility' in
              element &&
            !element.checkVisibility({
              checkOpacity:
                true,
              checkVisibilityCSS:
                true
            })
          ) {
            return false;
          }

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
      const targetValue =
        input.target;
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

      const visibleCandidates =
        candidates
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
        );

      for (
        const staleTarget of
          document.querySelectorAll(
            `[${input.targetAttribute}]`
          )
      ) {
        staleTarget.removeAttribute(
          input.targetAttribute
        );
      }

      return visibleCandidates
        .map(
          (
            element,
            targetIndex
          ) => {
            const rectangle =
              element
                .getBoundingClientRect();

            element.setAttribute(
              input.targetAttribute,
              String(
                targetIndex
              )
            );

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
                rectangle.height,
              targetIndex
            };
          }
        );
    },
    {
      target,
      targetAttribute
    }
  );
}

async function addEvidenceAnnotations(
  page:
    Page,
  boxes:
    readonly ResolvedVisualTargetBox[],
  target:
    FindingVisualTarget
): Promise<ResolvedVisualTargetBox[]> {
  return page.evaluate(
    (
      input
    ) => {
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
          const rectangle =
            element
              .getBoundingClientRect();

          if (
            rectangle.width <=
              0 ||
            rectangle.height <=
              0
          ) {
            return false;
          }

          if (
            'checkVisibility' in
              element &&
            !element.checkVisibility({
              checkOpacity:
                true,
              checkVisibilityCSS:
                true
            })
          ) {
            return false;
          }

          return true;
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
        },
        matchesTarget(
          element:
            Element
        ): boolean {
          if (
            input.target.kind !==
              'visible-text'
          ) {
            return true;
          }

          return (
            browserUtilities.accessibleName(
              element
            ) ===
            browserUtilities.normalize(
              input.target.text
            )
          );
        }
      };
      const style =
        document.createElement(
          'style'
        );
      style.setAttribute(
        input.styleAttribute,
        'true'
      );
      style.textContent = `
        [${input.highlightAttribute}] {
          outline: 3px solid #e11d48 !important;
          outline-offset: 0 !important;
        }
      `;
      document.documentElement
        .append(
          style
        );
      const shownBoxes:
        ResolvedVisualTargetBox[] =
        [];

      for (
        const [
          index,
          box
        ] of
        input.boxes.entries()
      ) {
        const element =
          document.querySelector(
            `[${input.targetAttribute}="${box.targetIndex}"]`
          );

        if (
          element ===
            null ||
          !browserUtilities.isVisible(
            element
          ) ||
          !browserUtilities.matchesTarget(
            element
          )
        ) {
          continue;
        }

        const rectangle =
          element
            .getBoundingClientRect();

        element.setAttribute(
          input.highlightAttribute,
          'true'
        );
        const annotation =
          document.createElement(
            'div'
          );
        annotation.setAttribute(
          input.annotationAttribute,
          String(
            box.targetIndex
          )
        );
        annotation.textContent =
          `CheckQuest evidence ${index + 1}`;
        Object.assign(
          annotation.style,
          {
            position:
              'fixed',
            zIndex:
              '2147483647',
            pointerEvents:
              'none',
            boxSizing:
              'border-box',
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
        document.documentElement
          .append(
            annotation
          );

        shownBoxes.push({
          x:
            rectangle.left +
            window.scrollX,
          y:
            rectangle.top +
            window.scrollY,
          width:
            rectangle.width,
          height:
            rectangle.height,
          targetIndex:
            box.targetIndex
        });
      }

      return shownBoxes;
    },
    {
      boxes,
      target,
      targetAttribute,
      highlightAttribute,
      annotationAttribute,
      styleAttribute:
        annotationStyleAttribute
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

      for (
        const target of
          document.querySelectorAll(
            `[${input.targetAttribute}]`
          )
      ) {
        target.removeAttribute(
          input.targetAttribute
        );
        target.removeAttribute(
          input.highlightAttribute
        );
      }

      for (
        const style of
          document.querySelectorAll(
            `[${input.styleAttribute}]`
          )
      ) {
        style.remove();
      }

      window.scrollTo(
        input.scrollPosition.x,
        input.scrollPosition.y
      );
    },
    {
      attribute:
        annotationAttribute,
      targetAttribute,
      highlightAttribute,
      styleAttribute:
        annotationStyleAttribute,
      scrollPosition
    }
  );
}

async function retainCaptureableEvidenceAnnotations(
  page:
    Page,
  boxes:
    readonly ResolvedVisualTargetBox[],
  clip:
    FocusedEvidenceClip,
  sequenceOffset:
    number
): Promise<number[]> {
  return page.evaluate(
    input => {
      const captureableTargetIndices:
        number[] =
        [];

      for (
        const box of
          input.boxes
      ) {
        const element =
          document.querySelector(
            `[${input.targetAttribute}="${box.targetIndex}"]`
          );

        if (
          element ===
            null ||
          element.getAttribute(
            input.highlightAttribute
          ) !==
            'true'
        ) {
          continue;
        }

        const rectangle =
          element
            .getBoundingClientRect();
        const isInsideClip =
          rectangle.left >=
            input.clip.x &&
          rectangle.top >=
            input.clip.y &&
          rectangle.right <=
            input.clip.x +
              input.clip.width &&
          rectangle.bottom <=
            input.clip.y +
              input.clip.height;
        const topmostAtCenter =
          document.elementFromPoint(
            rectangle.left +
              rectangle.width /
                2,
            rectangle.top +
              rectangle.height /
                2
          );
        const isUnobscuredAtCenter =
          topmostAtCenter !==
            null &&
          (
            topmostAtCenter ===
              element ||
            element.contains(
              topmostAtCenter
            )
          );

        if (
          isInsideClip &&
          isUnobscuredAtCenter
        ) {
          captureableTargetIndices
            .push(
              box.targetIndex
            );
          continue;
        }

        element.removeAttribute(
          input.highlightAttribute
        );
        document.querySelector(
          `[${input.annotationAttribute}="${box.targetIndex}"]`
        )?.remove();
      }

      for (
        const [
          index,
          targetIndex
        ] of
        captureableTargetIndices
          .entries()
      ) {
        const element =
          document.querySelector(
            `[${input.targetAttribute}="${targetIndex}"]`
          );
        const annotation =
          document.querySelector(
            `[${input.annotationAttribute}="${targetIndex}"]`
          ) as
            HTMLElement |
            null;

        if (
          element ===
            null ||
          annotation ===
            null
        ) {
          continue;
        }

        const rectangle =
          element
            .getBoundingClientRect();
        annotation.textContent =
          `CheckQuest evidence ${input.sequenceOffset + index + 1}`;
        annotation.style.left =
          `${rectangle.left - 3}px`;
        annotation.style.top =
          rectangle.top >
            24
            ? `${rectangle.top - 24}px`
            : `${rectangle.bottom + 6}px`;
      }

      return captureableTargetIndices;
    },
    {
      boxes,
      clip,
      sequenceOffset,
      targetAttribute,
      highlightAttribute,
      annotationAttribute
    }
  );
}

async function resolveAnnotatedTargetViewportBoxes(
  page:
    Page,
  boxes:
    readonly ResolvedVisualTargetBox[]
): Promise<ResolvedVisualTargetBox[]> {
  return page.evaluate(
    input =>
      input.boxes.flatMap(
        box => {
          const element =
            document.querySelector(
              `[${input.targetAttribute}="${box.targetIndex}"]`
            );

          if (
            element ===
              null ||
            element.getAttribute(
              input.highlightAttribute
            ) !==
              'true'
          ) {
            return [];
          }

          const rectangle =
            element
              .getBoundingClientRect();

          return [{
            x:
              rectangle.left,
            y:
              rectangle.top,
            width:
              rectangle.width,
            height:
              rectangle.height,
            targetIndex:
              box.targetIndex
          }];
        }
      ),
    {
      boxes,
      targetAttribute,
      highlightAttribute
    }
  );
}

async function waitForPresentationLayoutStability(
  page:
    Page
): Promise<void> {
  await page.evaluate(
    input =>
      new Promise<void>(
        resolve => {
          let previousSignature =
            '';
          let stableFrameCount =
            0;
          let remainingFrameCount =
            60;
          const tracker = {
            check(): void {
              const targetRectangles =
                [
                  ...document
                    .querySelectorAll(
                      `[${input.targetAttribute}]`
                    )
                ].map(
                  element => {
                    const rectangle =
                      element
                        .getBoundingClientRect();

                    return [
                      rectangle.x,
                      rectangle.y,
                      rectangle.width,
                      rectangle.height
                    ]
                      .map(
                        value =>
                          value.toFixed(
                            2
                          )
                      )
                      .join(
                        ','
                      );
                  }
                );
              const signature =
                [
                  window.scrollX,
                  window.scrollY,
                  ...targetRectangles
                ].join(
                  '|'
                );

              stableFrameCount =
                signature ===
                  previousSignature
                  ? stableFrameCount +
                    1
                  : 0;
              previousSignature =
                signature;
              remainingFrameCount -=
                1;

              if (
                stableFrameCount >=
                  3 ||
                remainingFrameCount <=
                  0
              ) {
                resolve();
                return;
              }

              window.requestAnimationFrame(
                () =>
                  tracker.check()
              );
            }
          };

          window.requestAnimationFrame(
            () =>
              tracker.check()
          );
        }
      ),
    {
      targetAttribute
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

  const selectedCandidateGroups =
    groupFocusedEvidenceTargets(
      boxes,
      viewport.height
    ).slice(
      0,
      maximumFocusedEvidenceImages
    );
  const selectedBoxes =
    selectedCandidateGroups.flatMap(
      group =>
        group.boxes
    ) as
      ResolvedVisualTargetBox[];
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
      await removeEvidenceAnnotations(
        page,
        scrollPosition
      ).catch(
        () => undefined
      );

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

  const capturedTargetIndices =
    new Set<number>();

  try {
    const shownBoxes =
      await addEvidenceAnnotations(
        page,
        selectedBoxes,
        input.target
      );
    const selectedGroups =
      groupFocusedEvidenceTargets(
        shownBoxes,
        viewport.height
      ).slice(
        0,
        maximumFocusedEvidenceImages
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
      const groupTop =
        Math.min(
          ...group.boxes.map(
            box =>
              box.y
          )
        );
      const groupBottom =
        Math.max(
          ...group.boxes.map(
            box =>
              box.y +
              box.height
          )
        );
      const centeredGroupTop =
        Math.max(
          focusedEvidencePadding,
          (
            viewport.height -
            (
              groupBottom -
              groupTop
            )
          ) /
            2
        );
      const desiredScrollY =
        Math.min(
          Math.max(
            0,
            groupTop -
              centeredGroupTop
          ),
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
      await waitForPresentationLayoutStability(
        page
      );
      const currentViewportBoxes =
        await resolveAnnotatedTargetViewportBoxes(
          page,
          group.boxes as
            ResolvedVisualTargetBox[]
        );

      if (
        currentViewportBoxes
          .length ===
          0
      ) {
        continue;
      }

      const viewportClip =
        calculateFocusedEvidenceClip(
          {
            boxes:
              currentViewportBoxes
          },
          {
            width:
              viewport.width,
            height:
              viewport.height
          }
        );
      const captureableTargetIndices =
        await retainCaptureableEvidenceAnnotations(
          page,
          currentViewportBoxes,
          viewportClip,
          capturedTargetIndices.size
        );

      if (
        captureableTargetIndices
          .length ===
          0
      ) {
        continue;
      }

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

      for (
        const targetIndex of
          captureableTargetIndices
      ) {
        capturedTargetIndices.add(
          targetIndex
        );
      }
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
      capturedTargetIndices.size,
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
