/**
 * or-webhook-receiver -- receives sync.completed events from OrangeRails.
 *
 * Wire format (OR's v2 signature scheme, dispatched by
 * `or-webhook-dispatch`):
 *   POST  application/json
 *   Headers:
 *     X-OR-Signature      : v1 legacy -- hex(HMAC-SHA-256(secret, body))
 *     X-OR-Signature-V2   : v2 -- `t=<unix>,v1=<hex>` where the HMAC
 *                           signs `<ts>.<body>` (Stripe-style; prevents
 *                           replay)
 *     X-OR-Event-Id       : UUID stable across retries (dedupe key)
 *   Body:   { type: "sync.completed", data: { subaccount_id,
 *             connection_id, synced_count, ts } }
 *
 * Verification is delegated to the vendored `@orangerails/webhooks` SDK
 * at `../_shared/or-webhooks/`. The SDK prefers v2, falls back to v1
 * during OR's transition window, and throws typed errors on any
 * verification failure. We never hand-roll HMAC here.
 *
 * Auth model: this endpoint is PUBLIC (no Supabase JWT) because OR
 * cannot mint user JWTs. Authentication is the HMAC signature alone --
 * the shared secret `OR_WEBHOOK_SECRET` is set on both sides at
 * registration time and verified constant-time by the SDK on every
 * request.
 *
 * On verified events we:
 *   1. Resolve user_id from subaccount_id (one subaccount per Orange Way
 *      user, mapped by ow-or-proxy/or-provision when the user first
 *      connected). Note: Orange Way is per-user, not per-org -- compare
 *      V3 which resolves to org_id.
 *   2. Upsert a row into public.connections to ensure the FK parent exists.
 *      OR's hosted widget creates connections on OR's side; we mirror
 *      (id, user_id) here so the FK on sync_events is satisfied before the
 *      child insert. Idempotent: a no-op when the row already exists.
 *   3. Insert a row into public.sync_events. The Connections page
 *      subscribes via Supabase realtime so the UI refreshes without
 *      polling.
 *
 * What we do NOT do:
 *   - Mirror OR's connections list locally. OR remains source of truth;
 *     the connections row here is the minimal FK anchor only.
 *   - Trigger any client-visible side effect beyond the row insert.
 *   - Dedupe globally across connections. The scoped unique constraint
 *     (or_connection_id, or_event_id) on sync_events collapses duplicate
 *     deliveries per-connection into a single row. Event IDs are
 *     connection-scoped by OR so global dedup would block legitimate
 *     retries on a different connection.
 *
 * Registration (one-time, per environment): generating the shared secret,
 * setting OR_WEBHOOK_SECRET on this project, and registering this
 * receiver's URL with OrangeRails is a maintainer-only procedure kept
 * outside this repo. It is deliberately not reproduced here: it names
 * per-environment identifiers and handles a secret, neither of which
 * belongs in a public tree.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jsonResponse, readBoundedText } from "../_shared/http.ts";
import { constructEvent, SignatureVerificationError } from "../_shared/or-webhooks/index.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OR_WEBHOOK_SECRET = Deno.env.get("OR_WEBHOOK_SECRET");

const service = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/**
 * Resolve user_id from OR's subaccount_id. The mapping is owned by
 * ow-or-proxy: when a user first calls or-provision, the returned
 * subaccount_id is cached on user_profiles.or_subaccount_id (and in the
 * browser's localStorage). We read the server-side row here.
 *
 * If we can't resolve, the receiver returns 202 (accepted but skipped)
 * so OR's dispatcher considers the delivery successful and won't retry
 * forever on a permanent mapping gap.
 */
async function resolveUserId(subaccountId: string): Promise<string | null> {
  const { data, error } = await service
    .from("user_profiles")
    .select("user_id")
    .eq("or_subaccount_id", subaccountId)
    .maybeSingle();
  if (error) {
    console.error("[or-webhook-receiver] user lookup error:", error.message);
    return null;
  }
  return (data?.user_id as string | undefined) ?? null;
}

Deno.serve(async (req: Request) => {
  // No CORS: this endpoint is called server-to-server, never from a
  // browser. Reject anything that isn't POST.
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  if (!OR_WEBHOOK_SECRET) {
    // Misconfigured environment -- 500 so OR retries until we notice.
    return jsonResponse({ error: "OR_WEBHOOK_SECRET not configured" }, 500);
  }

  const body = await readBoundedText(req);
  if (body === null) {
    return jsonResponse({ error: "Request body too large" }, 413);
  }

  // Single verification + parse step via the SDK. The SDK prefers v2
  // (`X-OR-Signature-V2`), falls back to v1 (`X-OR-Signature`) during
  // OR's transition window, requires `X-OR-Event-Id`, JSON-parses the
  // body with the verified bytes, and throws a typed error on any
  // failure. We don't catch finer-grained subclasses here because every
  // verification failure mode (missing sig, bad sig, replay, malformed
  // body, unsupported event type) maps to the same client response:
  // 401. The SDK's `event.id` comes from `X-OR-Event-Id` for dedupe
  // (forward-compat -- see file header).
  let event;
  try {
    event = await constructEvent({
      rawBody: body,
      headers: {
        "x-or-signature": req.headers.get("x-or-signature"),
        "x-or-signature-v2": req.headers.get("x-or-signature-v2"),
        "x-or-event-id": req.headers.get("x-or-event-id"),
      },
      secret: OR_WEBHOOK_SECRET,
      tolerance: 300,
    });
  } catch (err) {
    if (err instanceof SignatureVerificationError) {
      console.warn(`[or-webhook-receiver] verification failed (${err.code}): ${err.message}`);
      return jsonResponse({ error: "Invalid signature" }, 401);
    }
    // Anything non-SignatureVerificationError is a bug in the SDK or
    // an unexpected runtime failure -- surface as 500 so OR retries.
    console.error("[or-webhook-receiver] unexpected SDK error:", err);
    return jsonResponse({ error: "Verification error" }, 500);
  }

  // Discriminated union on event.type -- adding sync.failed etc. later
  // will surface as a TS error here, forcing a deliberate handler.
  switch (event.type) {
    case "sync.completed": {
      const userId = await resolveUserId(event.data.subaccount_id);
      if (!userId) {
        // We received a valid signed event for an unknown subaccount.
        // 202 = accepted but no action; tells OR's dispatcher to consider
        // the delivery successful and stop retrying (vs 5xx which would
        // burn retry budget for a permanent mapping gap).
        console.warn(
          `[or-webhook-receiver] unknown subaccount_id ${event.data.subaccount_id} -- no user match`,
        );
        return jsonResponse({ status: "accepted_no_user" }, 202);
      }

      // Ensure the FK parent row exists in connections before inserting
      // the child sync_events row. OR's hosted widget creates connections
      // on OR's side only; we mirror (id, user_id) here so the FK is
      // satisfied. Idempotent: ignoreDuplicates makes subsequent
      // deliveries for the same connection a no-op. This also means there
      // is no ordering hazard: the parent is guaranteed to exist in the
      // same request before the child insert below.
      const { error: connErr } = await service.from("connections").upsert(
        { id: event.data.connection_id, user_id: userId },
        { onConflict: "id", ignoreDuplicates: true },
      );
      if (connErr) {
        console.error("[or-webhook-receiver] connections upsert failed:", connErr.message);
        // 500 so OR retries with backoff.
        return jsonResponse({ error: "Persist failed" }, 500);
      }

      // Idempotent insert: or_event_id is stable across OR retries
      // (event.id from the @orangerails/webhooks SDK). The unique
      // constraint (or_connection_id, or_event_id) collapses duplicate
      // deliveries for the same connection into a single row. We use
      // upsert with ignoreDuplicates=true so the second delivery returns
      // 200 without an error path.
      const { error: insertErr } = await service.from("sync_events").upsert(
        {
          user_id: userId,
          or_connection_id: event.data.connection_id,
          synced_count: event.data.synced_count,
          or_ts: event.data.ts,
          or_event_id: event.id,
        },
        { onConflict: "or_connection_id,or_event_id", ignoreDuplicates: true },
      );

      if (insertErr) {
        console.error("[or-webhook-receiver] sync_events upsert failed:", insertErr.message);
        // 500 so OR retries with backoff.
        return jsonResponse({ error: "Persist failed" }, 500);
      }

      return jsonResponse({ status: "ok" }, 200);
    }
  }
});
