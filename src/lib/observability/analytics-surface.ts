/**
 * Which routes analytics is allowed to run on.
 *
 * Orange Way ships the marketing site and the authenticated app from one
 * SPA, so "marketing-site analytics" is a claim about routes, not about
 * hostnames. This module is the only place that claim is encoded.
 *
 * Default deny: a path is non-marketing unless it is listed here. Adding a
 * new app screen therefore requires no analytics change, and forgetting to
 * update this file makes the new screen silent rather than tracked.
 */

const MARKETING_PATHS = new Set([
  "/",
  "/about",
  "/beta",
  "/bitcoin",
  "/changelog",
  "/compare",
  "/enterprise",
  "/faq",
  "/features",
  "/landing-classic",
  "/pricing",
  "/privacy",
  "/privacy-changelog",
  "/security",
  "/self-host",
  "/terms",
]);

/** Normalise a pathname so "/features/" and "/features" compare equal. */
function normalise(pathname: string): string {
  if (!pathname) return "/";
  const trimmed = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return trimmed === "" ? "/" : trimmed;
}

/**
 * True only for public marketing pages. Every authenticated app surface,
 * every auth screen, and every unrecognised path returns false.
 */
export function isMarketingPath(pathname: string): boolean {
  return MARKETING_PATHS.has(normalise(pathname));
}

/** Exported for tests only: the exact set the gate reads. */
export const MARKETING_PATHS_FOR_TEST: ReadonlySet<string> = MARKETING_PATHS;
