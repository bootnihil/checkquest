export const aiConfig = {
  model:
    process.env.GEMINI_MODEL ??
    'gemini-3.1-flash-lite',

  requestTimeoutMs: 30_000,

  maxRetries: 1,

  baseRetryDelayMs: 2_000,

  maxRetryDelayMs: 60_000
} as const;
