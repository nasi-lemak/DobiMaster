import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// Pre-installed Chromium in the dev container; elsewhere (CI) fall back to Playwright's own download.
const LOCAL_CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const chromium = process.env.PW_CHROMIUM || (existsSync(LOCAL_CHROMIUM) ? LOCAL_CHROMIUM : undefined);

/**
 * End-to-end tests against an ISOLATED stack so the dev servers (:3000 / :5173) and the
 * `dobimaster` / `dobimaster_test` databases are never touched:
 *
 *   Postgres  dobimaster_e2e  (re-seeded with demo data on every run)
 *   API       http://localhost:3100
 *   Web       http://localhost:5180  (Vite, proxying /api and /ws to :3100)
 *
 *   pnpm --filter @dobi/web test:e2e
 */
const API_PORT = 3100;
const WEB_PORT = 5180;
const DATABASE_URL = process.env.E2E_DATABASE_URL ?? 'postgres://dobi:dobi@localhost:5432/dobimaster_e2e';
const WEB_URL = `http://localhost:${WEB_PORT}`;
const API_URL = `http://localhost:${API_PORT}`;

export default defineConfig({
  testDir: './e2e',
  // One stack, one database: run serially so tests never race each other on shared demo data.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: WEB_URL,
    locale: 'en-MY',
    timezoneId: 'Asia/Kuala_Lumpur',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // The dev service worker caches the shell; tests always want the live Vite build.
    serviceWorkers: 'block',
    launchOptions: chromium ? { executablePath: chromium } : {},
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
      dependencies: ['setup'],
    },
  ],
  webServer: [
    {
      // Migrate + wipe + seed demo data, then start the API. Seeding happens here (not in globalSetup)
      // because Playwright starts web servers before globalSetup, and seeding wipes tables the running
      // API relies on (e.g. VAPID keys).
      command: `pnpm --filter @dobi/api seed && cd ../api && npx tsx src/main.ts`,
      url: `${API_URL}/health`,
      env: { PORT: String(API_PORT), DATABASE_URL, PUBLIC_URL: WEB_URL, NODE_ENV: 'development' },
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort --logLevel error`,
      url: WEB_URL,
      env: { API_URL },
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'ignore',
      // Vite logs a harmless "ws proxy error: ECONNRESET" whenever a test closes a page with a live socket.
      stderr: process.env.E2E_VITE_LOGS ? 'pipe' : 'ignore',
    },
  ],
});
