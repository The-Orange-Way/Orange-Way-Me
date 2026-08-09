/**
 * Shared Orange Rails gateway resolution.
 *
 * OR_SUPABASE_URL decides which host receives X-Platform-API-Key. Every edge
 * function that reads that variable resolves it here, so the set of hosts it
 * may name is decided in code, once, and shared by all of them. If each
 * function keeps its own copy the copies drift, and the one that drifts is
 * the one that forwards the platform key somewhere we did not intend.
 *
 * The readers, all of which must route through this module:
 *
 *   ow-or-proxy
 *   owm-or-quick-connect
 *   owm-or-discover-quiltt
 *
 * Adding a reader means adding it to that list. If you are writing a fourth
 * one, it resolves through getOrGatewayFromEnv before it builds any request
 * carrying the platform key. There is no correct reason to read
 * OR_SUPABASE_URL directly.
 *
 * Keep this file dependency-free (no Supabase SDK imports) so it type-checks
 * under Node-based vitest as well as the Deno edge runtime. Same rule as
 * _shared/http.ts.
 */

// Minimal Deno shim so this file type-checks under Node-based vitest as well
// as the actual Deno edge runtime. At runtime Deno provides the real global;
// under Node the typeof guard below short-circuits before we touch it.
declare const Deno: { env: { get(key: string): string | undefined } } | undefined;

/**
 * The complete set of hosts OR_SUPABASE_URL may take.
 *
 *   api.orangerails.com  -- OR production API gateway
 *   api.orangerails.dev  -- OR development API gateway
 *
 * Note: dev.orangerails.com is OR's dev CDN/frontend origin and returns 405
 * on all function paths; it is NOT an API host and must not appear here.
 * staging.orangerails.com has no DNS.
 *
 * Adding a host is a reviewed code change, never an env-var edit. That is the
 * whole point: an operator who can write the secret store still cannot point
 * any of these functions at a host this list does not name.
 */
export const OR_URL_ALLOWLIST: ReadonlySet<string> = new Set<string>([
  "https://api.orangerails.com",
  "https://api.orangerails.dev",
]);

/** Where every reader points when OR_SUPABASE_URL is unset. */
export const OR_GATEWAY_DEFAULT = "https://api.orangerails.com";

/** Client-facing text when the configured host is not allowed. */
export const OR_GATEWAY_NOT_ALLOWED_ERROR =
  "Orange Rails endpoint is not in the function's allowlist. This is a deploy-side misconfiguration.";

/**
 * Pure helper: is this exact string an allowed gateway?
 *
 * Exact equality on purpose. No wildcards, no suffix matching, no
 * normalization: a value that is not spelled exactly like an entry is not
 * allowed. A near-miss is a misconfiguration and fails closed.
 */
export function isOrGatewayAllowed(candidate: string | null | undefined): boolean {
  if (typeof candidate !== "string") return false;
  return OR_URL_ALLOWLIST.has(candidate);
}

/**
 * Resolve a raw OR_SUPABASE_URL value to an allowed gateway URL, or null.
 *
 * null/undefined means the env var is unset, which resolves to the default
 * production gateway (itself allowlisted). Any other unrecognized value
 * returns null and the caller MUST refuse the request.
 */
export function resolveOrGatewayUrl(raw: string | null | undefined): string | null {
  const candidate = raw ?? OR_GATEWAY_DEFAULT;
  return isOrGatewayAllowed(candidate) ? candidate : null;
}

/**
 * Read OR_SUPABASE_URL from the runtime env (Deno) and resolve it.
 *
 * Logs once per cold-start when the value is outside the allowlist, so a
 * deploy-side misconfiguration is visible in the function logs rather than
 * showing up only as opaque 500s. The value logged is a URL, never a secret.
 *
 * `fnName` is the log prefix of the calling function.
 */
const _loggedRejection = new Set<string>();
export function getOrGatewayFromEnv(fnName: string): string | null {
  const raw =
    (typeof Deno !== "undefined" && Deno ? Deno.env.get("OR_SUPABASE_URL") : undefined) ?? null;
  const resolved = resolveOrGatewayUrl(raw);
  if (!resolved && !_loggedRejection.has(fnName)) {
    _loggedRejection.add(fnName);
    console.error(
      `[${fnName}] OR_SUPABASE_URL=${raw} is not in the allowlist; requests are refused until the env var is corrected or the code allowlist is extended via a reviewed PR.`,
    );
  }
  return resolved;
}
