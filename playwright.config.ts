import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright smoke tests.
 *
 * Default target: http://localhost:4173 (Vite preview server, so a
 * contributor running `bunx playwright test` without setting the env
 * var won't accidentally send traffic to a deployed environment).
 * Override with: PLAYWRIGHT_BASE_URL=<url> bunx playwright test
 *
 * Tests live in tests/e2e/. They are intentionally shallow (page
 * loads, no console errors, key routes return 200), plus the
 * marketing-forms.spec.ts interactive suite that stubs /api/signup
 * to validate the client/server schema contract. Deeper integration
 * tests land alongside the features they test.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30 * 1000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["html", { open: "never" }], ["list"]] : "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:4173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  // Cross-browser + cross-form-factor matrix. Chromium is the default
  // dev target and the only one required for a green PR; the others
  // run in CI's nightly matrix (see .github/workflows/deploy.yml) so
  // a desktop-only Chrome change can't ship a WebKit-broken landing
  // page. Roadmap item: mobile-responsiveness verification (#15).
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "mobile-safari",
      use: { ...devices["iPhone 14"] },
    },
  ],
});
