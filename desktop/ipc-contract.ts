import { z } from 'zod';

import type { DesktopRunEvent } from './run-event-contract';
import type { DesktopRunFieldErrors, DesktopStartRunInput } from './start-run-contract';

export type DesktopStartRunReply =
  | {
      accepted: true;
    }
  | {
      accepted: false;
      reason:
        | 'active-run'
        | 'invalid-request'
        | 'credential-rejected'
        | 'preflight-failed'
        | 'target-unreachable'
        | 'cancelled'
        | 'application-unavailable';
      message: string;
      fieldErrors?: DesktopRunFieldErrors;
    };

export interface DesktopCancelRunReply {
  requested: boolean;
}

export interface DesktopSessionCredentialStatus {
  available: boolean;
}

export interface CheckQuestDesktopApi {
  startRun: (input: DesktopStartRunInput) => Promise<DesktopStartRunReply>;
  cancelRun: () => Promise<DesktopCancelRunReply>;
  getSessionCredentialStatus: () => Promise<DesktopSessionCredentialStatus>;
  onRunEvent: (listener: (event: DesktopRunEvent) => void) => () => void;
}

export const desktopIpcChannels = {
  startRun: 'checkquest:start-run',
  cancelRun: 'checkquest:cancel-run',
  sessionCredentialStatus: 'checkquest:session-credential-status',
  runEvent: 'checkquest:run-event'
} as const;

const desktopStartRunReplySchema = z.union([
  z.object({
    accepted: z.literal(true)
  }),
  z.object({
    accepted: z.literal(false),
    reason: z.enum([
      'active-run',
      'invalid-request',
      'credential-rejected',
      'preflight-failed',
      'target-unreachable',
      'cancelled',
      'application-unavailable'
    ]),
    message: z.string().max(1_000),
    fieldErrors: z
      .object({
        targetUrl: z.string().max(1_000).optional(),
        pageBudget: z.string().max(1_000).optional(),
        navigationBudget: z.string().max(1_000).optional(),
        investigationStepsPerPage: z.string().max(1_000).optional(),
        geminiApiKey: z.string().max(1_000).optional()
      })
      .optional()
  })
]);

export function parseDesktopStartRunReply(value: unknown): DesktopStartRunReply {
  const result = desktopStartRunReplySchema.safeParse(value);

  if (result.success) {
    return result.data;
  }

  return {
    accepted: false,
    reason: 'application-unavailable',
    message: 'The desktop application could not start the run.'
  };
}

const desktopCancelRunReplySchema = z.object({
  requested: z.boolean()
});

export function parseDesktopCancelRunReply(value: unknown): DesktopCancelRunReply {
  const result = desktopCancelRunReplySchema.safeParse(value);

  return result.success
    ? result.data
    : {
        requested: false
      };
}

const desktopSessionCredentialStatusSchema = z.object({
  available: z.boolean()
});

export function parseDesktopSessionCredentialStatus(
  value: unknown
): DesktopSessionCredentialStatus {
  const result = desktopSessionCredentialStatusSchema.safeParse(value);

  return result.success
    ? result.data
    : {
        available: false
      };
}
