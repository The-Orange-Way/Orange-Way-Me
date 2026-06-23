/**
 * Authenticated-route screenshot harness.
 *
 * Walks every authenticated top-level route at both desktop and
 * mobile viewports, captures a full-page PNG, and asserts that the
 * page actually rendered (no console errors, body visible). Acts as
 * the visual-regression backbone for the app's authenticated
 * surfaces.
 *
 * Why this exists:
 *   - 2026-05-31 incident: the vault lock screen rendered at the
 *     same URL as authenticated content. A passing Playwright run
 *     was reporting "green" while every screenshot was actually the
 *     lock screen. Pure URL/status checks do not catch that class.
 *   - Roadmap item #6 (authenticated /PW screenshot pass).
 *   - Foundation for PR C (vault crypto path) and PR D (Quiltt
 *     sandbox bank-link flow) which both reuse the auth state.
 *
 * What this DOESN'T do:
 *   - Snapshot-diff. Screenshots are written to a timestamped
 *     directory for human review (or future upload to the wiki).
 *     Pixel-diff baselines would be brittle on a SPA with real
 *     data; we revisit when we have a stable fixture dataset.
 *   - Dynamic-ID routes (accounts/$id, goals/$id). They need a
 *     real ID resolution step; tracked as a follow-up.
 *
 * Auth state: the Supabase session cookie is loaded automatically
 * via playwright.config.ts (the `authenticated` project sets
 * `use.storageState` to the path produced by auth.setup.ts). The
 * vault unlock state lives in React memory (VaultContext) and is
 * deliberately NOT persisted to localStorage, so storage state alone
 * leaves the vault locked. The `test.beforeEach` below re-unlocks
 * the vault on every fresh page using E2E_VAULT_PASSWORD; without
 * that step every authenticated route would render the vault gate
 * and the harness would fail with `#v-pw visible`.
 */

import { test, expect, type ConsoleMessage, type Page } from "@playwright/test";
import { mkdirSync, existsSync } from "node:fs";
import path from "node:path";

const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "-");
const SHOT_DIR = path.join("tests/e2e/screenshots/authenticated", TIMESTAMP);
if (!existsSync(SHOT_DIR)) mkdirSync(SHOT_DIR, { recursive: true });

const KNOWN_SPLASH_SELECTORS = ["#ow-splash", "[data-loading-splash]"];

async function waitForSplashGone(page: Page) {
  for (const selector of KNOWN_SPLASH_SELECTORS) {
    if ((await page.locator(selector).count()) > 0) {
      await page
        .locator(selector)
        .waitFor({ state: "detached", timeout: 15000 })
        .catch(() => null);
    }
  }
}

interface RouteCheck {
  path: string;
  label: string;
  // Optional text that MUST appear once the route has finished
  // rendering. Used to discriminate the actual route from the vault
  // lock screen (which has the same URL as the authenticated content
  // when the session is locked).
  expectText?: RegExp;
}

// `expectText` is asserted INSIDE the `<main>` element (see the
// page.locator("main").getByText below). The app shell renders the
// route labels in its sidebar / bottom nav too, so an unscoped
// matcher would happily report green on a blank main area as long
// as the nav button was visible. Scoping to `main` forces the
// assertion to find content the route actually rendered.
//
// /households was excluded on purpose: it's a public marketing
// page (uses MarketingShell, has no AppGate). The authenticated
// household surface lives at /settings/household.
const AUTHENTICATED_ROUTES: RouteCheck[] = [
  { path: "/dashboard", label: "dashboard", expectText: /net worth|overview|this month|balance/i },
  { path: "/accounts", label: "accounts", expectText: /add account|no accounts|connect/i },
  {
    path: "/transactions",
    label: "transactions",
    expectText: /no transactions|category|date/i,
  },
  { path: "/budgets", label: "budgets", expectText: /no budgets|create budget|category/i },
  { path: "/cash-flow", label: "cash-flow", expectText: /income|expense|net/i },
  { path: "/connections", label: "connections", expectText: /add bank|link bank|connection/i },
  { path: "/goals", label: "goals", expectText: /goal|target|create/i },
  {
    path: "/settings/household",
    label: "settings-household",
    expectText: /member|invite|household/i,
  },
  { path: "/settings", label: "settings", expectText: /profile|preference|security|categor/i },
];

const VIEWPORTS = [
  { label: "desktop-1440x900", width: 1440, height: 900 },
  { label: "mobile-390x844", width: 390, height: 844 },
];

/**
 * Re-unlock the vault on a fresh page. The Supabase session
 * restores from storageState, but VaultContext's `isUnlocked` is
 * pure React state (see src/context/VaultContext.tsx line ~340)
 * and resets to false on every new browser context. /auth detects
 * the locked vault and renders VaultGate; we fill #v-pw and wait
 * for the post-unlock /dashboard navigation. Skips the test if the
 * vault password env var is missing.
 */
async function unlockVault(page: Page) {
  const vaultPassword = process.env.E2E_VAULT_PASSWORD;
  test.skip(!vaultPassword, "E2E_VAULT_PASSWORD not set; authenticated suite skipped.");
  await page.goto("/auth");
  const vaultField = page.locator("#v-pw");
  await vaultField.waitFor({ state: "visible", timeout: 30000 });
  await vaultField.fill(vaultPassword!);
  await page.getByRole("button", { name: /^unlock/i }).click();
  await page.waitForURL((url) => url.pathname === "/dashboard", { timeout: 30000 });
}

for (const viewport of VIEWPORTS) {
  test.describe(`authenticated surface: ${viewport.label}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test.beforeEach(async ({ page }) => {
      await unlockVault(page);
    });

    for (const route of AUTHENTICATED_ROUTES) {
      test(`${route.label} renders and screenshots`, async ({ page }) => {
        const consoleErrors: string[] = [];
        page.on("console", (msg: ConsoleMessage) => {
          if (msg.type() === "error") consoleErrors.push(msg.text());
        });
        page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

        const response = await page.goto(route.path, { waitUntil: "domcontentloaded" });
        expect(response?.status(), `${route.label} HTTP status`).toBeLessThan(400);
        await waitForSplashGone(page);

        // Discriminate from the vault gate. VaultGate.tsx renders
        // either "Unlock your vault" (existing vault, locked) or
        // "Set up your vault" (no vault yet); both flows show a
        // password input at `#v-pw`. Asserting that input is NOT
        // visible covers both states: if the auth state expired
        // mid-run, this fails loudly instead of producing a green
        // "screenshot of the lock screen", the exact 2026-05-31
        // failure mode. (An earlier draft asserted the "Unlock your
        // vault" text and missed the "Set up your vault" branch.)
        await expect(
          page.locator("#v-pw"),
          `${route.label} unexpectedly shows the vault gate (#v-pw visible): auth state may have expired mid-run`,
        ).not.toBeVisible({ timeout: 1000 });

        if (route.expectText) {
          // Scope to the page's <main> so the assertion can't be
          // satisfied by the persistent sidebar / bottom nav (which
          // renders the same route labels everywhere). A blank or
          // stale main area now fails the test instead of reporting
          // green from a nav button.
          await expect(page.locator("main").getByText(route.expectText).first()).toBeVisible({
            timeout: 10000,
          });
        }

        await page.screenshot({
          path: path.join(SHOT_DIR, `${viewport.label}_${route.label}.png`),
          fullPage: true,
        });

        const significant = consoleErrors.filter(
          (e) =>
            !e.includes("Download the React DevTools") &&
            !e.includes("chrome-extension://") &&
            !e.includes("Loading chunk") &&
            !e.includes("net::ERR_") && // network blips on lazy chunks
            !e.match(/refresh.*token/i), // Supabase refresh noise
        );
        expect(significant, `${route.label} console errors`).toEqual([]);
      });
    }
  });
}
