export interface FloatingRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface FloatingViewport {
  width: number;
  height: number;
}

export interface FloatingPosition {
  left: number;
  top: number;
  arrowLeft: number;
  placement: 'above' | 'below';
}

export interface FloatingPositionOptions {
  horizontal?: 'center' | 'end';
  gap?: number;
  margin?: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

export function calculateFloatingPosition(
  anchor: FloatingRect,
  overlay: Pick<FloatingRect, 'width' | 'height'>,
  viewport: FloatingViewport,
  options: FloatingPositionOptions = {}
): FloatingPosition {
  const gap = options.gap ?? 10;
  const margin = options.margin ?? 12;
  const desiredLeft =
    options.horizontal === 'end'
      ? anchor.right - overlay.width
      : anchor.left + (anchor.width - overlay.width) / 2;
  const left = clamp(desiredLeft, margin, viewport.width - overlay.width - margin);
  const belowTop = anchor.bottom + gap;
  const aboveTop = anchor.top - gap - overlay.height;
  const availableBelow = viewport.height - anchor.bottom - margin;
  const availableAbove = anchor.top - margin;
  const placement: FloatingPosition['placement'] =
    overlay.height <= availableBelow || availableBelow >= availableAbove ? 'below' : 'above';
  const unclampedTop = placement === 'below' ? belowTop : aboveTop;
  const top = clamp(unclampedTop, margin, viewport.height - overlay.height - margin);
  const arrowLeft = clamp(anchor.left + anchor.width / 2 - left, 14, overlay.width - 14);

  return {
    left,
    top,
    arrowLeft,
    placement
  };
}
