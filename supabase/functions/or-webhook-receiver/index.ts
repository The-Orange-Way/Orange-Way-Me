/**
 * or-webhook-receiver — receives sync.completed events from OrangeRails.
 *
 * Wire format (OR's v2 signature scheme, dispatched by
 * `or-webhook-dispatch`):
 *   POST  application/json
 *   Headers:
 *     X-OR-Signature      : v1 legacy — hex(HMAC-SHA-256(secret, body))
 *     X-OR-Signature-V2   : v2 — `t=<unix>,v1=<hex>` where the HMAC
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
 * cannot mint user JWTs. Authentication is the HMAC signature alone —
 * the shared secret `OR_WEBHOOK_SECRET` is set on both sides at
 * registration time and verified constant-time by the SDK on every
 * request.
 *
 * On verified events we:
 *   1. Resolve user_id from subaccount_id (one subaccount per Orange Way
 *      user, mapped by ow-or-proxy/or-provision when the user first
 *      connected). Note: Orange Way is per-user, not per-org — compare
 *      V3 which resolves to org_id.
 *   2. Insert a row into public.sync_events. The Connections page
 *      subscribes via Supabase realtime so the UI refreshes without
 *      polling.
 *
 * What we do NOT do:
 *   - Mirror OR's connections list locally. OR remains source of truth.
 *   - Trigger any client-visible side effect beyond the row insert.
 *   - Dedupe on event.id yet. The header is captured for forward-compat;
 *     a unique constraint on sync_events keyed by or_event_id is now
 *     in place (migration 20260524000000), and the receiver upserts
 *     for the UI (realtime resubscribes coalesce duplicates client-side).
 *
 * Registration runbook (one-time, per environment):
 *   1. Generate a fresh shared secret:
 *        SECRET=$(openssl rand -hex 32)
 *   2. Set as Supabase edge function secret on Orange Way:
 *        supabase secrets set OR_WEBHOOK_SECRET=$SECRET \
 *          --project-ref mggalsdproqwmtwwtinm
 *   3. Register receiver URL + secret on OR PROD's `platforms` row:
 *        UPDATE platforms
 *           SET webhook_url    = 'https://mggalsdproqwmtwwtinm.supabase.co/functions/v1/or-webhook-receiver',
 *               webhook_secret = '<SECRET>'
 *         WHERE slug = 'orangeway';
 *   4. Smoke: trigger any or-sync from Orange Way → check sync_events
 *      table receives a row within ~30s (or-webhook-dispatch backoff).
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
 * Outcome of a subaccount to user lookup.
 *
 * The two failure shapes are deliberately kept apart, because they must
 * produce opposite responses to OR's dispatcher:
 *   - ok: false          the lookup itself failed. We do not know whether
 *                        a mapping exists. Caller answers 5xx so OR retries.
 *   - ok: true, userId: null
 *                        the lookup succeeded and there is no mapping.
 *                        Caller answers 202 so OR stops retrying.
 * Collapsing both into a bare null is what previously caused a transient
 * database error to be reported to OR as a successful delivery, which
 * discarded the event permanently.
 */
type UserLookup = { ok: false } | { ok: true; userId: string | null };

/**
 * Resolve user_id from OR's subaccount_id. The mapping is owned by
 * ow-or-proxy: when a user first calls or-provision, the returned
 * subaccount_id is cached on user_profiles.or_subaccount_id (and in the
 * browser's localStorage). We read the server-side row here.
 */
async function resolveUserId(subaccountId: string): Promise<UserLookup> {
  const { data, error } = await service
    .from("user_profiles")
    .select("user_id")
    .eq("or_subaccount_id", subaccountId)
    .maybeSingle();
  if (error) {
    console.error("[or-webhook-receiver] user lookup error:", error.message);
    return { ok: false };
  }
  return { ok: true, userId: (data?.user_id as string | undefined) ?? null };
}

Deno.serve(async (req: Request) => {
  // No CORS: this endpoint is called server-to-server, never from a
  // browser. Reject anything that isn't POST.
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  if (!OR_WEBHOOK_SECRET) {
    // Misconfigured environment — 500 so OR retries until we notice.
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
  // (forward-compat — see file header).
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
    // an unexpected runtime failure — surface as 500 so OR retries.
    console.error("[or-webhook-receiver] unexpected SDK error:", err);
    return jsonResponse({ error: "Verification error" }, 500);
  }

  // Discriminated union on event.type — adding sync.failed etc. later
  // will surface as a TS error here, forcing a deliberate handler.
  switch (event.type) {
    case "sync.completed": {
      const lookup = await resolveUserId(event.data.subaccount_id);

      if (!lookup.ok) {
        // The lookup failed, so we cannot tell a missing mapping from a
        // database that is briefly unavailable. 500 hands the event back
        // to OR's dispatcher, which retries with backoff. Answering 202
        // here would tell OR the delivery succeeded and drop the event
        // for good. The upsert below is idempotent on or_event_id, so a
        // retry after a partial failure cannot double-apply.
        return jsonResponse({ error: "User lookup failed" }, 500);
      }

      if (!lookup.userId) {
        // We received a valid signed event for an unknown subaccount.
        // 202 = accepted but no action; tells OR's dispatcher to consider
        // the delivery successful and stop retrying (vs 5xx which would
        // burn retry budget for a permanent mapping gap).
        console.warn(
          `[or-webhook-receiver] unknown subaccount_id ${event.data.subaccount_id} — no user match`,
        );
        return jsonResponse({ status: "accepted_no_user" }, 202);
      }

      // Idempotent insert: or_event_id is stable across OR retries
      // (event.id from the @orangerails/webhooks SDK). The unique index
      // ux_sync_events_or_event_id collapses duplicate deliveries into
      // a single row. We use upsert with ignoreDuplicates=true so the
      // second delivery returns 200 without an error path.
      const { error: insertErr } = await service.from("sync_events").upsert(
        {
          user_id: lookup.userId,
          or_connection_id: event.data.connection_id,
          synced_count: event.data.synced_count,
          or_ts: event.data.ts,
          or_event_id: event.id,
        },
        { onConflict: "or_event_id", ignoreDuplicates: true },
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
