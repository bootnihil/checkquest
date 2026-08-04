import { validateDesktopStartRunInput, type DesktopStartRunInput } from '../contracts';

export function isDesktopRunLocallyEligible(
  request: DesktopStartRunInput,
  sessionCredentialAvailable: boolean
): boolean {
  return validateDesktopStartRunInput(request, {
    sessionCredentialAvailable
  }).success;
}
