/**
 * Authenticated-suite storage state setup.
 *
 * Playwright's "project dependencies" feature lets one project run
 * before another and pass its result (in this case, an authenticated
 * browser context's storageState) to the dependents. This spec is
 * the producer: it logs the test user in, unlocks the vault, and
 * writes the cookies plus localStorage to AUTH_STATE_PATH. Specs in
 * the `authenticated` project then load that state and skip the
 * login / unlock dance on every test.
 *
 * Why a separate spec rather than a beforeAll:
 *   - Re-runs once, not per worker.
 *   - Subsequent test files don't see the auth-screen DOM at all,
 *     so console-error baselines stay clean.
 *   - Saved state is reusable for ad-hoc debugging (`bunx playwright
 *     codegen --load-storage=tests/e2e/.auth/user.json`).
 *
 * Inputs (env vars, all required):
 *   E2E_USER_EMAIL      Supabase auth email for the fixture test user
 *   E2E_USER_PASSWORD   Supabase auth password for the fixture test user
 *   E2E_VAULT_PASSWORD  Vault password (the user-controlled secret the
 *                       client uses to derive the OPK key material;
 *                       see /security for the full scheme)
 *   PLAYWRIGHT_BASE_URL target URL. The harness REFUSES to run against
 *                       a production origin: see the preflight check
 *                       below for the deny list.
 *
 * Behaviour when any input is missing:
 *   The setup test fails fast with a clear instruction message. The
 *   authenticated routes project depends on this, so the dependent
 *   suite is skipped automatically by Playwright's project graph;
 *   contributors without creds get a clean "skipped" line instead
 *   of a misleading auth-screen screenshot.
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
  const email = process.env.E2E_USER_EMAIL;
  const password = process.env.E2E_USER_PASSWORD;
  const vaultPassword = process.env.E2E_VAULT_PASSWORD;

  if (!email || !password || !vaultPassword) {
    throw new Error(
      "auth.setup.ts: missing E2E_USER_EMAIL / E2E_USER_PASSWORD / " +
        "E2E_VAULT_PASSWORD. Set them in the shell or skip the " +
        "authenticated project with `--project=chromium` etc.",
    );
  }

  const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? "";
  try {
    const host = new URL(baseUrl).host;
    if (FORBIDDEN_BASE_URL_HOSTS.includes(host)) {
      throw new Error(
        `auth.setup.ts: PLAYWRIGHT_BASE_URL points at a production ` +
          `host (${host}). Refusing to run the authenticated harness ` +
          `against prod. Point at dev.orangeway.app or a local preview.`,
      );
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("production host")) throw err;
    // Non-URL baseUrl (e.g. "localhost:4173" without scheme): let
    // Playwright's own resolver handle it.
  }

  const authDir = path.dirname(AUTH_STATE_PATH);
  if (!existsSync(authDir)) mkdirSync(authDir, { recursive: true });

  // Step 1: Supabase auth.
  await page.goto("/auth");
  const emailField = page.locator("#si-email");
  await emailField.waitFor({ state: "visible", timeout: 15000 });
  await emailField.fill(email);
  await page.locator("#si-pw").fill(password);
  await page.getByRole("button", { name: /^sign in/i }).click();

  // Step 2: vault unlock. After successful auth, AuthScreen swaps to
  // VaultGate, which asks for the vault password unless the device
  // has a vault-cached marker (we're starting fresh so it always
  // prompts).
  const vaultField = page.locator("#v-pw");
  await vaultField.waitFor({ state: "visible", timeout: 30000 });
  await vaultField.fill(vaultPassword);
  await page.getByRole("button", { name: /^unlock/i }).click();

  // Step 3: confirm we landed on the post-unlock destination.
  // The /auth route navigates to /dashboard once both gates pass.
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
