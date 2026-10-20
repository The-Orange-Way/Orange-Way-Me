import { test, expect, type ConsoleMessage } from "@playwright/test";
import { isFilteredConsoleMessage } from "./console-filter";

/**
 * Smoke tests — catches CF Pages deployment regressions.
 *
 * Tests are intentionally shallow:
 *   1. Page loads with 2xx HTTP status
 *   2. Loading splash (if any) is removed within 15s
 *   3. No JavaScript console errors after splash removal
 *   4. Key DOM landmarks (body, headings) are present
 */

const KNOWN_SPLASH_SELECTORS = [
  "#ow-splash", // Orange Way
  "#or-splash", // Orange Rails (future)
  "[data-loading-splash]", // generic opt-in
];

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

test.describe("landing page", () => {
  let consoleErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors = [];
    // The rate proxy (orbi-rate) is a Supabase edge function that only exists on a
    // deployed project. This job serves the PR build on loopback, so the smoke must
    // not depend on that function being deployed or configured. Answer the call
    // locally with "no rate"; the proxy has its own tests.
    await page.route("**/functions/v1/orbi-rate*", (route) => {
      const request = route.request();
      const requested = request.headers()["access-control-request-headers"];
      const cors = {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, OPTIONS",
        "access-control-allow-headers": requested ?? "authorization, apikey",
      };
      if (request.method() === "OPTIONS") {
        return route.fulfill({ status: 204, headers: cors });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: cors,
        body: "null",
      });
    });
    page.on("console", (msg: ConsoleMessage) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });
    page.on("pageerror", (err) => {
      consoleErrors.push(`pageerror: ${err.message}`);
    });
  });

  test("home page loads with no console errors", async ({ page }) => {
    // `domcontentloaded` not `networkidle` — this SPA has PostHog +
    // realtime + font-loading hints that keep the network busy past
    // the 30s test ceiling, so networkidle never fires. The splash-
    // detach + console-filter checks below already prove the page
    // has settled.
    const response = await page.goto("/", { waitUntil: "domcontentloaded" });
    expect(response?.status(), "home page HTTP status").toBeLessThan(400);
    await waitForSplashGone(page);

    const significantErrors = consoleErrors.filter((e) => !isFilteredConsoleMessage(e));
    expect(significantErrors, "no console errors on home page").toEqual([]);
  });

  test("home page has visible landmarks", async ({ page }) => {
    await page.goto("/");
    await waitForSplashGone(page);
    await expect(page.locator("body")).toBeVisible();
    const headings = page.locator("h1, h2");
    await expect(headings.first()).toBeVisible();
  });
});
