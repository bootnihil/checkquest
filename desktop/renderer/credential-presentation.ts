export interface DesktopCredentialPresentation {
  inputRequired: boolean;
  requirementVisible: boolean;
  helpText: string;
  placeholderText: string;
  accessibleStateText: string;
  available: boolean;
}

export function getDesktopCredentialPresentation(
  sessionCredentialAvailable: boolean
): DesktopCredentialPresentation {
  return sessionCredentialAvailable
    ? {
        inputRequired: false,
        requirementVisible: false,
        helpText: 'Kept only until you close CheckQuest',
        placeholderText: '✓ API key ready for this session — enter a new key to replace it',
        accessibleStateText: 'API key ready for this session. Enter a new key to replace it.',
        available: true
      }
    : {
        inputRequired: true,
        requirementVisible: true,
        helpText: 'Kept only until you close CheckQuest',
        placeholderText: '',
        accessibleStateText: '',
        available: false
      };
}
