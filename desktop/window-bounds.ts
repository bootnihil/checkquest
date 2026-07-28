export interface DesktopWorkAreaSize {
  width:
    number;
  height:
    number;
}

export interface DesktopInitialWindowBounds {
  width:
    number;
  height:
    number;
}

export const desktopMinimumWindowSize = {
  width:
    720,
  height:
    560
} as const;

export function getDesktopInitialWindowBounds(
  workArea:
    DesktopWorkAreaSize
): DesktopInitialWindowBounds {
  const availableWidth =
    Math.max(
      desktopMinimumWindowSize
        .width,
      workArea.width -
        48
    );
  const availableHeight =
    Math.max(
      desktopMinimumWindowSize
        .height,
      workArea.height -
        48
    );
  const preferredWidth =
    Math.max(
      desktopMinimumWindowSize
        .width,
      Math.round(
        workArea.width *
          0.64
      )
    );
  const preferredHeight =
    Math.max(
      desktopMinimumWindowSize
        .height,
      Math.round(
        workArea.height *
          0.62
      )
    );

  return {
    width:
      Math.min(
        800,
        availableWidth,
        preferredWidth
      ),
    height:
      Math.min(
        620,
        availableHeight,
        preferredHeight
      )
  };
}
