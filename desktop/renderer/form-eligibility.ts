import { validateDesktopStartRunInput, type DesktopStartRunInput } from '../start-run-contract';

export function isDesktopRunLocallyEligible(
  request: DesktopStartRunInput,
  sessionCredentialAvailable: boolean
): boolean {
  return validateDesktopStartRunInput(request, {
    sessionCredentialAvailable
  }).success;
}
