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
      testIgnore: /authenticated-routes\.spec\.ts|auth\.setup\.ts/,
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
      testIgnore: /authenticated-routes\.spec\.ts|auth\.setup\.ts/,
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
      testIgnore: /authenticated-routes\.spec\.ts|auth\.setup\.ts/,
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"] },
      testIgnore: /authenticated-routes\.spec\.ts|auth\.setup\.ts/,
    },
    {
      name: "mobile-safari",
      use: { ...devices["iPhone 14"] },
      testIgnore: /authenticated-routes\.spec\.ts|auth\.setup\.ts/,
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
      // vault into the trace.zip.
      //
      // The HTML report, stated exactly, because these two settings
      // do not cover it and the details decide what that costs.
      //
      // The deploy workflow does have an upload step: on failure it
      // uploads playwright-report/ as an artifact with 7 day
      // retention. It has nothing to collect today. The same workflow
      // runs `playwright test --project=chromium --reporter=list`,
      // and a reporter passed on the command line replaces the
      // reporter configured at the top of this file, so the html
      // reporter never runs and playwright-report/ is never written.
      // (An earlier version of this comment said the report was
      // "currently not" uploaded, which was wrong the other way
      // round: the upload step is real.)
      //
      // So nothing is exposed today for two independent reasons, and
      // each is one edit away from stopping being true. The reporter
      // flag means no report exists at all. Chromium never
      // authenticates, so a report could not contain a signed-in
      // session even if one were written.
      //
      // Turning trace and screenshot off does NOT empty a report that
      // does get written. Playwright puts error context, DOM snippets
      // and stack traces in the report itself. So if an authenticated
      // project is added to that job AND the html reporter is in
      // play, a failing run ships a report built from an
      // unlocked-vault session.
      //
      // Two things follow, and the second is the one that gets
      // missed. Trace and screenshot stay "off" here. And whoever
      // adds an authenticated project to CI owns keeping its output
      // out of that upload, because these two settings do not cover
      // it and the command line flag that covers it today is an
      // argument in a workflow file, not a guarantee. The harness's
      // own page.screenshot() calls write to a gitignored dir for
      // human review and are unaffected.
      name: "authenticated",
      testMatch: /authenticated-routes\.spec\.ts/,
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
