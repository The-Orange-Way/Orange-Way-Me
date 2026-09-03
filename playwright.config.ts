import { defineConfig, devices } from "@playwright/test";
import { AUTH_STATE_PATH } from "./tests/e2e/auth-state-path";

/**
 * Which specs need a logged-in, vault-unlocked browser, and which specs the
 * unauthenticated projects must therefore refuse to run.
 *
 * These two live together because they are one rule seen from two sides, and
 * they used to be six separate copies of it: the same regex was pasted into
 * the testIgnore of all five unauthenticated projects and again, in a narrower
 * form, into the authenticated project's testMatch. Adding a spec to the
 * authenticated suite meant remembering to edit six places, and forgetting one
 * of the five does not fail loudly. It hands an authenticated spec to a browser
 * with no session, which surfaces as an unexplained redirect to /auth rather
 * than as the configuration mistake it is.
 *
 * Naming convention: a spec that needs a session is either the original
 * authenticated-routes.spec.ts or is named <something>.authenticated.spec.ts.
 * The suffix is what makes membership visible in a directory listing, so a
 * reviewer can see which specs carry a session without opening the config.
 */
const AUTHENTICATED_SPECS = /authenticated-routes\.spec\.ts|\.authenticated\.spec\.ts/;

/**
 * The authenticated specs plus the setup spec that produces their storage
 * state. auth.setup.ts is excluded from the unauthenticated projects for a
 * different reason than the specs are: it is not a test, it is a producer, and
 * running it under chromium would type the fixture credentials for no reason
 * and race the real setup project's write to AUTH_STATE_PATH.
 */
const UNAUTHENTICATED_IGNORE =
  /authenticated-routes\.spec\.ts|\.authenticated\.spec\.ts|auth\.setup\.ts/;

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
      testIgnore: UNAUTHENTICATED_IGNORE,
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
      testIgnore: UNAUTHENTICATED_IGNORE,
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
      testIgnore: UNAUTHENTICATED_IGNORE,
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"] },
      testIgnore: UNAUTHENTICATED_IGNORE,
    },
    {
      name: "mobile-safari",
      use: { ...devices["iPhone 14"] },
      testIgnore: UNAUTHENTICATED_IGNORE,
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
      // Trace + on-failure screenshot are disabled here on purpose,
      // and this is the control that matters most in this file.
      // The default config sets trace: "on-first-retry"; an
      // authenticated retry would otherwise embed the Supabase JWT,
      // the refresh token, and full DOM snapshots of the unlocked
      // vault into the trace.zip.
      //
      // The HTML report IS uploaded as a workflow artifact. See
      // .github/workflows/deploy.yml, "Upload Playwright HTML report
      // on failure": it uploads playwright-report/ with 7 day
      // retention. This comment used to say the opposite, that the
      // report was "currently not" uploaded. That was wrong, and it
      // was harmless only because the one project CI ran never
      // authenticated, so the report never held a session to leak.
      // Now that the authenticated project runs in CI too, treat
      // these two lines as the thing standing between an unlocked
      // vault and a downloadable artifact. Do not turn them on to
      // debug a failure; reproduce locally instead, where the report
      // is not published.
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
