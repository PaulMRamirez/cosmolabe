import { defineConfig, devices } from '@playwright/test';

// Builds the canonical web app and serves the production bundle, then runs the
// suite against it. "Renders" is asserted by loading a fixture and checking a
// non-empty WebGL frame, never by visual judgement (SPEC Section 8).
// The preview port defaults to 4173 (CI) but honors E2E_PORT so a developer can
// run the suite on an isolated port when another instance already holds 4173.
const PORT = Number(process.env.E2E_PORT ?? 4173);

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'line' : 'list',
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  webServer: {
    command: `pnpm --filter @bessel/web build && pnpm --filter @bessel/web preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /electron-.*\.spec\.ts/,
    },
    {
      // Electron tests launch the built desktop app directly (no web server).
      name: 'electron',
      testMatch: /electron-.*\.spec\.ts/,
    },
  ],
});
