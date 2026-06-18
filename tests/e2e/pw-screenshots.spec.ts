/**
 * Comprehensive screenshot pass for /PW orangeway.
 *
 * Visits every public marketing route (no auth required) at desktop and
 * mobile viewports, captures full-page PNGs at every checkpoint, asserts
 * 2xx HTTP + visible body, no significant console errors.
 *
 * Screenshots write to tests/e2e/screenshots/<timestamp>/ for upload to
 * Outline by the post-run wiki publisher.
 */
import { test, expect, type ConsoleMessage } from "@playwright/test";
import { mkdirSync, existsSync } from "node:fs";
import path from "node:path";

const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "-");
const SHOT_DIR = path.join("tests/e2e/screenshots", TIMESTAMP);
if (!existsSync(SHOT_DIR)) mkdirSync(SHOT_DIR, { recursive: true });

const KNOWN_SPLASH_SELECTORS = ["#ow-splash", "#or-splash", "#v3-splash", "[data-loading-splash]"];

async function waitForSplashGone(page: import("@playwright/test").Page) {
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
  expectText?: RegExp;
}

const PUBLIC_ROUTES: RouteCheck[] = [
  { path: "/", label: "home", expectText: /Orange Way/i },
  { path: "/features", label: "features" },
  { path: "/security", label: "security", expectText: /ML-KEM-768/i },
  { path: "/about", label: "about" },
  { path: "/ai", label: "ai" },
  { path: "/faq", label: "faq" },
  { path: "/login", label: "login" },
  // Footer-linked legal pages. They render 200 but weren't being
  // screenshotted, so a regression on layout / copy could slip through
  // unnoticed.
  { path: "/privacy", label: "privacy" },
  { path: "/terms", label: "terms" },
  { path: "/pricing", label: "pricing" },
  // Long-tail marketing routes (155-231 LOC each) — all live in
  // src/routes/ and resolve 200 on dev + prod; previous spec just
  // skipped them.
  { path: "/bitcoin", label: "bitcoin" },
  { path: "/beta", label: "beta" },
  { path: "/compare", label: "compare" },
  { path: "/enterprise", label: "enterprise" },
  { path: "/changelog", label: "changelog" },
];

const VIEWPORTS: Array<{ name: string; width: number; height: number }> = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

for (const vp of VIEWPORTS) {
  test.describe(`marketing surface — ${vp.name} ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    let consoleErrors: string[] = [];
    test.beforeEach(async ({ page }) => {
      consoleErrors = [];
      page.on("console", (msg: ConsoleMessage) => {
        if (msg.type() === "error") consoleErrors.push(msg.text());
      });
      page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));
    });

    for (let i = 0; i < PUBLIC_ROUTES.length; i++) {
      const route = PUBLIC_ROUTES[i];
      const stepNum = String(i + 1).padStart(2, "0");

      test(`${route.label} loads + screenshot`, async ({ page }) => {
        const resp = await page.goto(route.path, { waitUntil: "domcontentloaded" });
        expect(resp?.status(), `${route.label} HTTP status`).toBeLessThan(400);
        await waitForSplashGone(page);

        // Wait for first heading or body to be visible (proves render).
        await expect(page.locator("body")).toBeVisible();
        await page
          .locator("h1, h2")
          .first()
          .waitFor({ state: "visible", timeout: 5000 })
          .catch(() => null);

        if (route.expectText) {
          // At least one element should contain the expected text.
          const matchCount = await page
            .locator(`text=${route.expectText.source.replace(/\//g, "")}`)
            .count();
          expect(matchCount, `${route.label} contains expected text`).toBeGreaterThan(0);
        }

        // Capture full-page screenshot.
        const fname = `${stepNum}-${route.label}-${vp.name}.png`;
        await page.screenshot({ path: path.join(SHOT_DIR, fname), fullPage: true });

        // Console error filter — same as smoke spec.
        const significantErrors = consoleErrors.filter(
          (e) =>
            !e.includes("Download the React DevTools") &&
            !e.includes("chrome-extension://") &&
            !e.includes("Loading chunk") &&
            !e.includes("PostHog"),
        );
        expect(significantErrors, `${route.label} no console errors`).toEqual([]);
      });
    }
  });
}
