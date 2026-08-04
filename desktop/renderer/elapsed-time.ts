import type { DesktopUiPhase } from '../ui-state';

export const activeDesktopUiPhases: ReadonlySet<DesktopUiPhase> = new Set([
  'checking-credentials',
  'checking-website',
  'starting',
  'running',
  'inspecting',
  'navigating',
  'analyzing',
  'retrying',
  'cancelling'
]);

export function formatElapsedTime(elapsedMilliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMilliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const shortTime = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  return hours === 0 ? shortTime : `${String(hours).padStart(2, '0')}:${shortTime}`;
}

export function createElapsedStatusText(
  phase: DesktopUiPhase,
  runStartedAt: number | undefined,
  cancellationStartedAt: number | undefined,
  now: number
): string | null {
  if (!activeDesktopUiPhases.has(phase)) {
    return null;
  }

  if (phase === 'cancelling') {
    return formatElapsedTime(now - (cancellationStartedAt ?? now));
  }

  return formatElapsedTime(now - (runStartedAt ?? now));
}
