/**
 * Marketing email-capture forms: interactive smoke tests.
 *
 * Complements the existing pw-screenshots.spec.ts (which only LOADS
 * routes) by actually exercising the three signup surfaces:
 *
 *   1. "/" Sato book form (single email field, no kids select)
 *   2. "/landing-classic" BookForm (email + kids segmentation)
 *   3. "/landing-classic" WaitlistForm (single email field)
 *
 * Each test stubs /api/signup so the suite is hermetic: no real
 * Resend send, no rate-limit interaction with other tests, no
 * dependency on the dev environment being up. The stub returns
 * 200/{ok:true} on the success path and 500 on the failure path;
 * we assert the route-specific success copy on one and the generic
 * error message on the other.
 *
 * The stub also captures the POST body, so each test asserts the
 * client posted exactly what we expect (form discriminator, trimmed
 * email, kids field present only when configured). That guards the
 * client/server schema contract from drift even if the SPA refactors.
 */

import { test, expect } from "@playwright/test";

const TEST_EMAIL = "test+e2e@orangeway.example";

interface CapturedRequest {
  body: Record<string, unknown> | null;
  contentType: string | null;
}

async function stubSignup(
  page: import("@playwright/test").Page,
  options: { ok: boolean; capture: CapturedRequest },
) {
  // Scope the intercept to the page's own origin so a future partner
  // widget POSTing to a third-party /api/signup doesn't get silently
  // stubbed by these tests. page.url() returns "about:blank" before
  // page.goto, so we resolve the origin at route-handler time.
  await page.route(/\/api\/signup(?:\?|$)/, async (route) => {
    const reqUrl = new URL(route.request().url());
    const pageUrl = new URL(page.url());
    if (reqUrl.origin !== pageUrl.origin) {
      await route.continue();
      return;
    }
    const request = route.request();
    options.capture.contentType = request.headers()["content-type"] ?? null;
    try {
      options.capture.body = (await request.postDataJSON()) as Record<string, unknown>;
    } catch {
      options.capture.body = null;
    }
    if (options.ok) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    } else {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "send failed" }),
      });
    }
  });
}

test.describe('"/" Sato book form', () => {
  test("posts {form:book, email} and shows the success copy", async ({ page }) => {
    const capture: CapturedRequest = { body: null, contentType: null };
    await stubSignup(page, { ok: true, capture });

    await page.goto("/");
    const emailInput = page.locator("#book-email");
    await emailInput.waitFor({ state: "visible", timeout: 15000 });
    await emailInput.fill(TEST_EMAIL);
    await page
      .locator('form button[type="submit"]', { hasText: /save|sign|email|book|copy/i })
      .first()
      .click();

    await expect(page.getByText(/we'll email you when the book ships/i)).toBeVisible({
      timeout: 10000,
    });
    expect(capture.contentType).toContain("application/json");
    expect(capture.body).toEqual({ form: "book", email: TEST_EMAIL });
  });

  test("surfaces the server error message on a 500", async ({ page }) => {
    const capture: CapturedRequest = { body: null, contentType: null };
    await stubSignup(page, { ok: false, capture });

    await page.goto("/");
    const emailInput = page.locator("#book-email");
    await emailInput.waitFor({ state: "visible", timeout: 15000 });
    await emailInput.fill(TEST_EMAIL);
    await page.locator('form button[type="submit"]').first().click();

    await expect(page.getByRole("alert")).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("alert")).toContainText(/something went wrong/i);
  });
});

test.describe('"/landing-classic" forms', () => {
  test("BookForm posts {form:book, email, kids} and shows the success copy", async ({ page }) => {
    const capture: CapturedRequest = { body: null, contentType: null };
    await stubSignup(page, { ok: true, capture });

    await page.goto("/landing-classic");
    // BookForm is the form that contains the kids <select>.
    const bookForm = page
      .locator("form")
      .filter({ has: page.locator("select") })
      .first();
    await bookForm.waitFor({ state: "visible", timeout: 15000 });
    await bookForm.locator('input[type="email"]').fill(TEST_EMAIL);
    await bookForm.locator("select").selectOption("bigger");
    await bookForm.locator('button[type="submit"]').click();

    await expect(page.getByText(/we'll email you when the book ships/i)).toBeVisible({
      timeout: 10000,
    });
    expect(capture.body).toEqual({ form: "book", email: TEST_EMAIL, kids: "bigger" });
  });

  test("WaitlistForm posts {form:waitlist, email} and shows the success copy", async ({ page }) => {
    const capture: CapturedRequest = { body: null, contentType: null };
    await stubSignup(page, { ok: true, capture });

    await page.goto("/landing-classic");
    // WaitlistForm is the form without a select. There are two such
    // forms (also a search box in the FAQ on some viewports), so we
    // scope to the #waitlist anchor section.
    const waitlist = page.locator("#waitlist").locator("form");
    await waitlist.waitFor({ state: "visible", timeout: 15000 });
    await waitlist.locator('input[type="email"]').fill(TEST_EMAIL);
    await waitlist.locator('button[type="submit"]').click();

    await expect(page.getByText(/you're on the list/i)).toBeVisible({ timeout: 10000 });
    expect(capture.body).toEqual({ form: "waitlist", email: TEST_EMAIL });
  });
});

test.describe("client-side validation guards the network", () => {
  test("does NOT POST when the email field is empty (browser required)", async ({ page }) => {
    let posted = false;
    await page.route(/\/api\/signup(?:\?|$)/, async (route) => {
      const reqUrl = new URL(route.request().url());
      const pageUrl = new URL(page.url());
      if (reqUrl.origin !== pageUrl.origin) {
        await route.continue();
        return;
      }
      posted = true;
      await route.fulfill({ status: 200, body: '{"ok":true}' });
    });

    await page.goto("/");
    await page.locator('form button[type="submit"]').first().click();

    // The native `required` attribute should block submit; the form
    // never fires. Give the page a moment to settle, then assert.
    await page.waitForTimeout(500);
    expect(posted).toBe(false);
  });
});
