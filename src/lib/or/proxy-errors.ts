/**
 * Error types for the ow-or-proxy edge function, plus the predicates callers
 * branch on. Kept out of the component that raises them so the branching rules
 * can be tested without mounting the Connections page and its whole context
 * tree.
 */

/**
 * The only keys kept on `CallProxyError.body`.
 *
 * This is an ALLOWLIST on purpose. A denylist of field names that look
 * sensitive does not cover the next field the upstream service adds under a
 * name nobody listed, and the redaction lists in this codebase have already
 * drifted apart from one another once. An allowlist fails closed: a new
 * upstream field is dropped until somebody decides it belongs here.
 *
 * `error` is the key callers actually branch on today: registerOpk's 409
 * rotation-guard retry reads `body.error`, and callProxy reads it to build the
 * message. The three code-shaped siblings are the conventional
 * machine-readable partners of `error`, and under the scalar rule below they
 * can only ever be a short string, number or boolean.
 */
export const PROXY_ERROR_BODY_KEYS = ["error", "error_code", "code", "reason"] as const;

/**
 * Cap on any retained string. An upstream error string is a sentence. Anything
 * longer is a payload wearing an error's name.
 */
const MAX_RETAINED_STRING = 200;

/**
 * Only short scalars survive. An object or an array under an allowed key is
 * dropped whole, so nothing can be smuggled through a key that is on the list.
 */
function retainScalar(value: unknown): string | number | boolean | null {
  if (typeof value === "string") return value.slice(0, MAX_RETAINED_STRING);
  if (typeof value === "number" || typeof value === "boolean") return value;
  return null;
}

/**
 * Reduce a proxy response body to the error-shaped fields callers branch on.
 *
 * A proxy response body is not always error text: on the sync endpoints it can
 * be a list of application rows. Attaching one whole to a thrown Error carries
 * that content into everything that later handles the error, which is a wider
 * surface than the branching ever needed.
 *
 * Shapes handled, in order: null and undefined become null; a string is kept
 * but truncated (a non-JSON error page is text, not rows); a number or boolean
 * is kept as is; an array becomes null, because a top-level list is rows and
 * never an error object; an object keeps only the allowlisted keys, and only
 * when their values are short scalars. An object with nothing left becomes
 * null rather than an empty object, so callers see one "no body" value.
 */
export function narrowProxyErrorBody(body: unknown): unknown {
  if (body === null || body === undefined) return null;
  if (typeof body === "string") return body.slice(0, MAX_RETAINED_STRING);
  if (typeof body !== "object") return body;
  if (Array.isArray(body)) return null;

  const source = body as Record<string, unknown>;
  const kept: Record<string, string | number | boolean> = {};
  for (const key of PROXY_ERROR_BODY_KEYS) {
    if (!(key in source)) continue;
    const value = retainScalar(source[key]);
    if (value === null) continue;
    kept[key] = value;
  }
  return Object.keys(kept).length > 0 ? kept : null;
}

/**
 * Failure from the ow-or-proxy edge function. Carries the upstream HTTP status
 * and (when available) the error-shaped part of the JSON body, so callers can
 * branch on specific status codes -- registerOpk's 409 rotation-guard retry,
 * for example. Vanilla `Error` would drop both.
 *
 * `body` is narrowed by `narrowProxyErrorBody` in the constructor rather than
 * at the throw sites. A throw site can be added without remembering to narrow;
 * a constructor cannot be bypassed.
 */
export class CallProxyError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "CallProxyError";
    this.status = status;
    this.body = narrowProxyErrorBody(body);
  }
}

/**
 * True when OR is telling us the subaccount_id we sent is one it never issued.
 *
 * This happens because the browser caches the subaccount id under a key
 * namespaced by user id alone, which does not record which Orange Rails issued
 * it. Point a build at a different OR gateway and the cache keeps handing over
 * an id from the old one, which the new gateway has never heard of.
 *
 * The state cannot clear itself: provisioning is skipped whenever an id is
 * already cached, so the unusable id both breaks every call and blocks the
 * re-provision that would replace it.
 *
 * Match on status AND message. Status alone would swallow unrelated 404s (a
 * missing connection, a retired endpoint) into a re-provision that cannot fix
 * them and would hide the real error; message alone would trust a substring
 * appearing in some other payload.
 */
export function isSubaccountNotFound(err: unknown): boolean {
  return (
    err instanceof CallProxyError && err.status === 404 && /subaccount not found/i.test(err.message)
  );
}
