import type { Page, Route } from "@playwright/test";

/**
 * Answer the rate proxy (orbi-rate) call locally with "no rate".
 *
 * orbi-rate is a Supabase edge function that only exists on a deployed
 * project. The E2E job serves the PR build on loopback and points it at the
 * dev project, so a spec that loads a page must not depend on that function
 * being deployed, configured or rate limited. Without this, the browser's call
 * fails its CORS preflight and every "no console errors" assertion goes red.
 *
 * The page sends an Authorization header, so the browser preflights the call.
 * Answer the preflight and the call itself with permissive CORS headers.
 * These specs check pages, not the proxy.
 */
const ORBI_RATE_URL = /\/functions\/v1\/orbi-rate(?:\?|$)/;

export async function stubOrbiRate(page: Page): Promise<void> {
  await page.route(ORBI_RATE_URL, (route: Route) => {
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
}
