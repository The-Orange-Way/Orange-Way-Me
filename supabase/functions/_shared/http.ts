/**
 * Shared Edge Function HTTP helpers: CORS, body-size guards, JSON responses.
 *
 * Keep this file dependency-free (no Supabase SDK imports) so every function
 * can import it without pulling an extra chunk.
 *
 * Security notes:
 *   - CORS allowlist must NEVER fall back to "*". Production deploys must
 *     set ALLOWED_ORIGINS. Unmatched origins receive no
 *     Access-Control-Allow-Origin header (browsers will block).
 *   - isOriginAllowed() is reused by invite-household-member to validate
 *     the redirect_to URL on invitation emails.
 */

// Minimal Deno shim so this file type-checks under Node-based vitest as
// well as the actual Deno edge runtime. At runtime Deno provides the real
// global; under Node the typeof guard below short-circuits before we touch it.
declare const Deno: { env: { get(key: string): string | undefined } } | undefined;

/** Max JSON body we accept from clients. 256 KB is plenty for every call
 *  site in this repo (exchange-rate params, invites, GraphQL mutations).
 *  Anything larger is either a mistake or hostile. */
export const MAX_BODY_BYTES = 256 * 1024;

/**
 * Parse the ALLOWED_ORIGINS env value into a normalized Set of origins.
 *
 * Each entry is trimmed and stripped of trailing slashes so the set behaves
 * predictably regardless of how callers spell their browser Origin header
 * (browsers never send a trailing slash, but ops folks sometimes type one).
 *
 * Returns null when the env var is unset or contains no usable entries —
 * callers MUST treat this as a misconfiguration (do not fall back to "*").
 */
export function parseAllowedOrigins(envValue: string | undefined | null): Set<string> | null {
  if (!envValue) return null;
  const list = envValue
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  if (list.length === 0) return null;
  return new Set(list);
}

/**
 * Pure helper: is the given Origin header value present in the allowlist?
 *
 * - Empty / missing origin → false (we never grant access without a verified origin)
 * - Allowlist null (unset env) → false (refuse by default; never "*")
 * - Trailing slashes on origin are stripped before comparison.
 *
 * Exported so other functions (e.g. invite-household-member's redirect_to
 * validator) can reuse the same matching logic without duplicating it.
 */
export function isOriginAllowed(
  origin: string | null | undefined,
  allowlist: Set<string> | null,
): boolean {
  if (!allowlist || allowlist.size === 0) return false;
  if (!origin) return false;
  const normalized = origin.trim().replace(/\/+$/, "");
  if (!normalized) return false;
  return allowlist.has(normalized);
}

/**
 * Read ALLOWED_ORIGINS from the runtime env (Deno) and parse it.
 *
 * Logs an error exactly once per cold-start if the env var is unset/empty,
 * so production misconfiguration is visible in Supabase Edge Function logs.
 */
let _loggedMissingEnv = false;
export function getAllowedOriginsFromEnv(): Set<string> | null {
  const raw =
    (typeof Deno !== "undefined" && Deno ? Deno.env.get("ALLOWED_ORIGINS") : undefined) ?? null;
  const parsed = parseAllowedOrigins(raw);
  if (!parsed && !_loggedMissingEnv) {
    _loggedMissingEnv = true;
    console.error(
      "[_shared/http] ALLOWED_ORIGINS env var is unset or empty — refusing all cross-origin requests. Set it via `supabase secrets set ALLOWED_ORIGINS=...`.",
    );
  }
  return parsed;
}

/**
 * Build the CORS header set for a single request.
 *
 * Strict allowlist semantics:
 *   - If ALLOWED_ORIGINS env var is unset/empty: emit NO
 *     Access-Control-Allow-Origin. Browser will block the response. We
 *     also log the misconfiguration in getAllowedOriginsFromEnv().
 *   - If the request Origin matches the allowlist: reflect it verbatim.
 *   - If the request Origin does NOT match (or is absent): emit NO
 *     Access-Control-Allow-Origin. Browser will block the response.
 *
 * We never emit "*" and never reflect an arbitrary client-supplied Origin.
 */
export function buildCorsHeaders(req: Request): Record<string, string> {
  const allowlist = getAllowedOriginsFromEnv();
  const origin = req.headers.get("Origin");

  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };

  if (isOriginAllowed(origin, allowlist)) {
    // Reflect the verified origin verbatim. Safe — we only reach this
    // branch when the origin is in the operator-controlled allowlist.
    headers["Access-Control-Allow-Origin"] = origin!;
  }
  // Otherwise: deliberately omit Access-Control-Allow-Origin. The browser
  // will fail the CORS check and block the response.

  return headers;
}

export function jsonResponse(
  body: unknown,
  status: number,
  corsHeaders: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Read the request body as text with a hard size cap. Returns null when the
 * body exceeds MAX_BODY_BYTES — the caller should respond with 413.
 *
 * We prefer Content-Length as a fast path but still enforce the cap while
 * streaming in case a client omits the header.
 */
export async function readBoundedText(req: Request): Promise<string | null> {
  const contentLength = Number(req.headers.get("Content-Length") ?? "");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return null;
  }

  if (!req.body) return "";

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        return null;
      }
      chunks.push(value);
    }
  }

  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder().decode(buf);
}
