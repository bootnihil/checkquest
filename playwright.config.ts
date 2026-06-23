import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',

  timeout: 30_000,

  fullyParallel: true,

  forbidOnly: !!process.env.CI,

  retries: process.env.CI ? 1 : 0,

  workers: process.env.CI ? 1 : undefined,

  reporter: [
    ['list'],
    ['html', { open: 'never' }]
  ],

  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },

  projects: [
    {
      name: 'ui-chromium',
      testMatch: /.*\.ui\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome']
      }
    },

    {
      name: 'api',
      testMatch: /.*\.api\.spec\.ts/,
        use: {
        baseURL: 'https://jsonplaceholder.typicode.com'
        }
    }
  ]
});