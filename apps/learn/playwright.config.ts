import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  timeout: 30000,
  fullyParallel: true,
  use: {
    baseURL: 'http://127.0.0.1:5178',
    headless: true,
    channel: process.env.CI ? undefined : 'chrome',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm dev',
    url: 'http://127.0.0.1:5178',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
