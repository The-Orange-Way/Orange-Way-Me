import { defineConfig, devices } from "@playwright/test";
import { AUTH_STATE_PATH } from "./tests/e2e/auth-state-path";

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
// Specs that only work inside the `authenticated` project, because they need
// the storage state auth.setup.ts produces. ONE list, referenced by both
// sides: the unauthenticated projects ignore exactly this set, and the
// authenticated project matches exactly this set. The same literal used to be
// repeated in six places, so adding a spec and forgetting one testIgnore ran
// it, unauthenticated, in that browser.
const AUTHENTICATED_SPECS = /authenticated-routes\.spec\.ts|stealth-sync-run-record\.spec\.ts/;

// The same set plus the setup spec, which is its own project and must never be
// picked up by an unauthenticated one.
const AUTHENTICATED_SPECS_AND_SETUP =
  /authenticated-routes\.spec\.ts|stealth-sync-run-record\.spec\.ts|auth\.setup\.ts/;

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
  // Project graph:
  //
  //   unauthenticated projects (chromium, firefox, webkit,
  //   mobile-chrome, mobile-safari) cover the marketing + public
  //   surface. Chromium is the only one CI runs on every deploy; the
  //   others are opt-in locally and slated for a nightly matrix.
  //
  //   authenticated-setup runs auth.setup.ts which logs in + unlocks
  //   the vault, then writes the storage state to AUTH_STATE_PATH.
  //
  //   authenticated depends on authenticated-setup and reuses the
  //   saved state. Tests under this project skip the login dance and
  //   start already authenticated, so they're fast and they don't
  //   re-tickle Supabase rate limits on every spec.
  //
  // Contributors without E2E_USER_EMAIL / E2E_USER_PASSWORD /
  // E2E_VAULT_PASSWORD set should pass `--project=chromium` (or
  // omit `--project` entirely to run all unauthenticated projects)
  // so the authenticated suite is skipped instead of failing.
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: AUTHENTICATED_SPECS_AND_SETUP,
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
      testIgnore: AUTHENTICATED_SPECS_AND_SETUP,
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
      testIgnore: AUTHENTICATED_SPECS_AND_SETUP,
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"] },
      testIgnore: AUTHENTICATED_SPECS_AND_SETUP,
    },
    {
      name: "mobile-safari",
      use: { ...devices["iPhone 14"] },
      testIgnore: AUTHENTICATED_SPECS_AND_SETUP,
    },
    {
      // The setup project types the Supabase password, the vault
      // password, and briefly holds an unlocked session before saving
      // state. The global `trace: "on-first-retry"` would otherwise
      // embed all of that into the trace.zip on a retry. Override to
      // "off" here so the same protections the authenticated project
      // gets also apply to the producer.
      name: "authenticated-setup",
      testMatch: /auth\.setup\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        trace: "off",
        screenshot: "off",
      },
    },
    {
      // Chromium only by default: the authenticated session state is
      // browser-engine-agnostic, so cross-engine adds coverage of
      // rendering quirks, not new failure modes. Cross-engine
      // authenticated runs are tracked as a follow-up (nightly
      // matrix workflow).
      //
      // Trace + on-failure screenshot are disabled here on purpose.
      // The default config sets trace: "on-first-retry"; an
      // authenticated retry would otherwise embed the Supabase JWT,
      // the refresh token, and full DOM snapshots of the unlocked
      // vault into the trace.zip. If the HTML report ever gets
      // uploaded as a workflow artifact (currently not, but the
      // config shouldn't trust that to stay true), those credentials
      // leak. The harness's own page.screenshot() calls write to a
      // gitignored dir for human review and are unaffected.
      name: "authenticated",
      testMatch: AUTHENTICATED_SPECS,
      use: {
        ...devices["Desktop Chrome"],
        storageState: AUTH_STATE_PATH,
        trace: "off",
        screenshot: "off",
      },
      dependencies: ["authenticated-setup"],
    },
  ],
});
