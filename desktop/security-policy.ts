import type { WebPreferences } from 'electron';

export const desktopRendererSecurityPreferences = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  webSecurity: true
} as const satisfies Pick<
  WebPreferences,
  'contextIsolation' | 'sandbox' | 'nodeIntegration' | 'webSecurity'
>;
