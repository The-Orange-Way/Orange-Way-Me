/**
 * Authenticated-suite storage state setup.
 *
 * Playwright's "project dependencies" feature lets one project run
 * before another and pass its result (in this case, an authenticated
 * browser context's storageState) to the dependents. This spec is
 * the producer: it obtains a session for the fixture account, unlocks
 * the vault, and writes the cookies plus localStorage to
 * AUTH_STATE_PATH. Specs in the `authenticated` project then load
 * that state and skip the login / unlock dance on every test.
 *
 * Why a separate spec rather than a beforeAll:
 *   - Re-runs once, not per worker.
 *   - Subsequent test files don't see the auth-screen DOM at all,
 *     so console-error baselines stay clean.
 *   - Saved state is reusable for ad-hoc debugging (`bunx playwright
 *     codegen --load-storage=tests/e2e/.auth/user.json`).
 *
 * Inputs (env vars, all required):
 *   E2E_MINT_TOKEN      Bearer token accepted by the e2e-mint-session
 *                       Edge Function (supabase/functions/e2e-mint-session).
 *                       Single purpose: it can only mint a session for
 *                       one hardcoded throwaway fixture account, never
 *                       any real user, and it is unrelated to and
 *                       independently revocable from the project's
 *                       service-role key.
 *   SUPABASE_URL        The dev Supabase project URL, used to reach the
 *                       Edge Function and to derive the localStorage
 *                       key supabase-js reads on startup.
 *   E2E_VAULT_PASSWORD  Vault password (the user-controlled secret the
 *                       client uses to derive the OPK key material;
 *                       see /security for the full scheme)
 *   PLAYWRIGHT_BASE_URL target URL. The harness REFUSES to run against
 *                       a production origin: see the preflight check
 *                       below for the deny list.
 *
 * Why this spec no longer types a password: the deployed dev sign-in
 * screen is OTP-only (Cloudflare Turnstile plus an emailed code) and
 * has no password field at all, verified against the live origin
 * before this was built (see OWM-T0226). This spec instead mints a
 * session server side and injects it as browser storage state before
 * any app code runs, which is the same authenticated state a real
 * sign-in would leave behind, without ever typing into, or even
 * loading, the sign-in form.
 *
 * Behaviour when any input is missing:
 *   The setup test SKIPS (not throws) so `bunx playwright test`
 *   without `--project` doesn't hard-fail on a clean clone. The
 *   dependent `authenticated` project's beforeEach also checks for
 *   E2E_VAULT_PASSWORD and skips for the same reason, so the whole
 *   authenticated suite resolves to a clean "skipped" line for any
 *   contributor without fixture credentials in scope.
 *
 * Storage-state caveat:
 *   page.context().storageState({path}) only persists cookies and
 *   localStorage. The vault unlock state lives in React memory
 *   (VaultContext's `isUnlocked` useState; src/context/VaultContext
 *   .tsx ~line 340) and is NOT written to localStorage by design
 *   (ZKA: persisting the unlocked state across sessions would
 *   weaken the threat model). The authenticated spec therefore
 *   re-runs the vault-unlock step on every fresh page in its own
 *   beforeEach; this setup spec only saves the Supabase session.
 */

import { test as setup, expect } from "@playwright/test";
import path from "node:path";
import { mkdirSync, existsSync, chmodSync } from "node:fs";
import { AUTH_STATE_PATH } from "./auth-state-path";

// Origins the harness must NEVER authenticate against. The fixture
// user is intentionally a non-production identity; running it against
// prod would either reset the wrong account or, worse, pollute prod
// data with test fixtures and leave real customer data in
// screenshots. Add hostnames as new prod environments come online.
const FORBIDDEN_BASE_URL_HOSTS = ["orangeway.app", "www.orangeway.app"];

setup("authenticate the test user and unlock the vault", async ({ page }) => {
  const mintToken = process.env.E2E_MINT_TOKEN;
  const supabaseUrl = process.env.SUPABASE_URL;
  const vaultPassword = process.env.E2E_VAULT_PASSWORD;

  // Skip-not-throw when credentials are absent. Throwing here would
  // hard-fail any plain `bunx playwright test` invocation (which
  // runs all projects by default), even on a clean clone with no
  // fixture credentials in scope. Skipping lets the authenticated
  // dependent project also skip cleanly and contributors see a
  // "skipped" line instead of a stack trace.
  setup.skip(
    !mintToken || !supabaseUrl || !vaultPassword,
    "auth.setup.ts: skipping (E2E_MINT_TOKEN / SUPABASE_URL / " +
      "E2E_VAULT_PASSWORD not set). The authenticated suite skips with it.",
  );
  // After setup.skip, the test body still executes until the next
  // await; narrow the type so the rest of the spec sees non-empty
  // strings instead of `string | undefined`.
  if (!mintToken || !supabaseUrl || !vaultPassword) return;

  const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? "";
  try {
    const host = new URL(baseUrl).host;
    if (FORBIDDEN_BASE_URL_HOSTS.includes(host)) {
      throw new Error(
        `auth.setup.ts: PLAYWRIGHT_BASE_URL points at a production ` +
          `host (${host}). Refusing to run the authenticated harness ` +
          `against prod. Point at https://orangeway.dev (the dev ` +
          `deployment) or a local preview.`,
      );
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("production host")) throw err;
    // Non-URL baseUrl (e.g. "localhost:4173" without scheme): let
    // Playwright's own resolver handle it.
  }

  const authDir = path.dirname(AUTH_STATE_PATH);
  if (!existsSync(authDir)) mkdirSync(authDir, { recursive: true });

  // Step 1: mint a session for the fixture account server side, via
  // the narrow e2e-mint-session Edge Function. This never types a
  // password into the sign-in UI (dev sign-in is OTP-only and has no
  // password field, see the ticket) and never puts the Supabase
  // service-role key in a CI secret: the function holds that key as
  // its own Supabase secret, and this spec only ever holds a
  // single-purpose bearer token scoped to invoking this one function
  // for this one hardcoded account.
  const mintRes = await fetch(`${supabaseUrl}/functions/v1/e2e-mint-session`, {
    method: "POST",
    headers: { Authorization: `Bearer ${mintToken}` },
  });
  if (!mintRes.ok) {
    throw new Error(
      `auth.setup.ts: e2e-mint-session returned ${mintRes.status}. ` +
        `Cannot authenticate the fixture account.`,
    );
  }
  const { session } = (await mintRes.json()) as { session?: Record<string, unknown> };
  if (!session) {
    throw new Error("auth.setup.ts: e2e-mint-session returned no session.");
  }

  // Step 2: inject the session as the exact key and shape supabase-js
  // reads on startup, before any app code runs (context-level
  // addInitScript, so a popup would be instrumented too). The
  // storage key has no project-specific override in this bundle
  // (verified against the deployed dev artifact), so it is always
  // `sb-<project-ref>-auth-token`, and the session object returned by
  // e2e-mint-session is already the exact shape supabase-js persists
  // there, so no reshaping happens here.
  const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
  const storageKey = `sb-${projectRef}-auth-token`;
  await page.context().addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key, value);
    },
    [storageKey, JSON.stringify(session)] as [string, string],
  );

  // Step 3: navigate straight to the authenticated app. AuthScreen
  // reads the injected session on load and swaps to VaultGate, since
  // this spec never touches the sign-in form at all.
  await page.goto("/dashboard");

  // Step 4: vault unlock. After the session is recognised, AuthScreen
  // swaps to VaultGate, which asks for the vault password unless the
  // device has a vault-cached marker (we're starting fresh so it
  // always prompts). This is the screen this ticket exists to test,
  // so it is unchanged from before.
  const vaultField = page.locator("#v-pw");
  await vaultField.waitFor({ state: "visible", timeout: 30000 });
  await vaultField.fill(vaultPassword);
  await page.getByRole("button", { name: /^unlock/i }).click();

  // Step 5: confirm we landed on the post-unlock destination.
  // The /auth route (and now the injected-session /dashboard load)
  // navigates to /dashboard once both gates pass.
  await page.waitForURL((url) => url.pathname === "/dashboard", { timeout: 30000 });
  await expect(page.locator("body")).toBeVisible();

  // Persist the cookies + localStorage to disk. Files in
  // tests/e2e/.auth/ are gitignored, so this never lands in the repo.
  await page.context().storageState({ path: AUTH_STATE_PATH });
  // Tighten the file mode after the synchronous write. Without this,
  // node's default umask leaves the file world-readable (0644) and
  // the Supabase JWT inside is a local-account-takeover primitive on
  // a shared dev box.
  try {
    chmodSync(AUTH_STATE_PATH, 0o600);
  } catch {
    // Best-effort: chmod can fail on Windows / network mounts. The
    // gitignore + dotfile path are the primary defense.
  }
});
