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
 *
 * Exported so the MESSAGE path is bounded by the same number as the BODY path.
 * A second literal 200 in the component that throws is how two rules about the
 * same response drift apart, which is a mistake this file's own comment above
 * records having been made once already.
 */
export const MAX_RETAINED_STRING = 200;

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
 * Bound a message built from an upstream response.
 *
 * WHY A MESSAGE NEEDS THIS WHEN THE BODY IS ALREADY NARROWED. `body` and
 * `message` are two properties of the same thrown Error, built from the same
 * untrusted response, and they reach the same places: console.error, and from
 * there the observability layer's global handler. Narrowing one and leaving
 * the other unbounded closes one door out of two.
 *
 * It is specifically not covered elsewhere. The observability layer scrubs
 * exception messages with token patterns that match URL fragments, query
 * strings and known token prefixes. Its other list is a KEY denylist, and a
 * message is a bare string with no key, so that list can never apply to one.
 *
 * The cut is VISIBLE rather than silent: a truncated message ends in an
 * ellipsis so a reader can tell a short upstream sentence from the first 200
 * characters of something much longer. The total length still respects the
 * cap.
 */
export function capProxyErrorMessage(message: string): string {
  if (message.length <= MAX_RETAINED_STRING) return message;
  return `${message.slice(0, MAX_RETAINED_STRING - 3)}...`;
}

/**
 * The message to raise for a proxy response, given the caller's fallback.
 *
 * WHY THE THROW SITE NO LONGER DOES THIS ITSELF. The call site used to write
 * String(body.error), which is defined for every input and wrong for two of
 * them. An array of strings becomes "one,two", joining the whole list into the
 * message verbatim; an object becomes the useless "[object Object]". The first
 * is a real leak of upstream content into a property nothing bounds, and
 * `narrowProxyErrorBody` already refuses both shapes under the very same key,
 * so accepting them here would let the body's rule be bypassed by the property
 * sitting next to it.
 *
 * STRINGS ONLY, therefore. A number or a boolean under `error` is a scalar the
 * body does retain, but it makes no sentence, so the caller's fallback is
 * better copy for a human and nothing is lost for branching: the scalar is
 * still on `body`.
 *
 * The result is capped, and so is the fallback, because a fallback can itself
 * be an upstream string (supabase-js puts the edge function's own message
 * there).
 */
export function buildProxyErrorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const value = (body as Record<string, unknown>).error;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length > 0) return capProxyErrorMessage(trimmed);
    }
  }
  return capProxyErrorMessage(fallback);
}

/**
 * Failure from the ow-or-proxy edge function. Carries the upstream HTTP status
 * and (when available) the error-shaped part of the JSON body, so callers can
 * branch on specific status codes -- registerOpk's 409 rotation-guard retry,
 * for example. Vanilla `Error` would drop both.
 *
 * `body` is narrowed by `narrowProxyErrorBody` in the constructor rather than
 * at the throw sites. A throw site can be added without remembering to narrow;
 * a constructor cannot be bypassed. The message is capped here for the same
 * reason: `buildProxyErrorMessage` is the right way to construct one, and this
 * is what bounds the messages built some other way.
 */
export class CallProxyError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(capProxyErrorMessage(message));
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
 *
 * THE MESSAGE CAP DOES NOT BREAK THIS, and the suite asserts it rather than
 * assuming it. The wording OR sends leads the sentence, so it survives a cut
 * made at 200 characters. Anything that moves the match later in the string,
 * or that rewrites rather than truncates the message, has to keep this
 * predicate working or the re-provision path silently stops firing.
 */
export function isSubaccountNotFound(err: unknown): boolean {
  return (
    err instanceof CallProxyError && err.status === 404 && /subaccount not found/i.test(err.message)
  );
}
