/**
 * Household invite-wrap pipeline (Phase 4.3).
 *
 * Orchestrates the client-side crypto for a real, per-recipient hybrid
 * KEM wrap of the household DEK when an Owner invites a new member.
 * Sits on top of the Phase 4.0 primitives in `key-wrapping.ts` and the
 * Phase 4.1 `user_public_keys` + `household_keys` tables.
 *
 * Flow:
 *
 *   1. Owner UI collects email + role. Before calling
 *      invite-household-member:
 *        a. lookupRecipientPublicKey queries user_public_keys by user
 *           id (or via the recipient lookup the edge function does
 *           on its end). If the recipient has a published key we wrap
 *           the household DEK for them client-side.
 *        b. If no public key, the edge function records a pending
 *           household_invites row (status='awaiting_recipient'). When
 *           the recipient eventually publishes a keypair, a DB trigger
 *           flips the row to ready_to_wrap; the Owner's client
 *           (subscribed via realtime) loops through completePendingHouseholdWraps.
 *
 *   2. The household DEK is opaque to this module. Today (Phase 4.3)
 *      callers supply a 32-byte placeholder slot — Phase 4.5 first-time
 *      setup migrates the placeholder to a real shared DEK.
 *
 * Schema choices:
 *   - user_public_keys carries each member's hybrid KEM public key.
 *   - household_keys carries the per-member wrapped DEK.
 *   - Algorithm string on the wire is hybrid_x25519_mlkem768
 *     (underscores). The KEY_WRAP_STRATEGIES registry uses
 *     hyphens internally; we normalise at the boundary.
 */

import { supabase } from "@/integrations/supabase/client";
import { KEY_WRAP_STRATEGIES, DEFAULT_WRAP_ALGORITHM, base64ToBytes } from "@/lib/key-wrapping";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface HouseholdDekWrapPayload {
  /** Base64 of the opaque wrapped blob (KEM ciphertext || IV || AES-GCM ct). */
  enc_household_dek: string;
  /** Strategy identifier as recorded on household_keys.wrap_algo. */
  wrap_algo: string;
}

export interface RecipientKeyLookupResult {
  publicKeyB64: string | null;
}

// Wire-format identifier persisted on household_keys.wrap_algo. Matches
// the migration default. Underscored form is the customer-facing wire
// shape; the hyphenated form is the in-memory strategy key.
export const HOUSEHOLD_WRAP_ALGO = "hybrid_x25519_mlkem768";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/**
 * Random 32-byte placeholder household DEK. Used today so every invite
 * wrap exercises real hybrid-KEM crypto against real recipient public
 * keys. Phase 4.5 first-time setup replaces the placeholder with a
 * shared DEK that decrypts business data.
 */
export function generatePlaceholderHouseholdDek(): Uint8Array {
  const dek = new Uint8Array(32);
  crypto.getRandomValues(dek);
  return dek;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch a recipient's hybrid public key from user_public_keys. Returns
 * null when the recipient has not yet published a keypair.
 */
export async function lookupRecipientPublicKey(
  recipientUserId: string,
): Promise<RecipientKeyLookupResult> {
  const { data, error } = await supabase
    .from("user_public_keys" as never)
    .select("public_key_b64")
    .eq("user_id" as never, recipientUserId)
    .maybeSingle();

  if (error) {
    throw new Error(`lookupRecipientPublicKey failed: ${error.message}`);
  }

  const publicKeyB64 = (data as { public_key_b64?: string } | null)?.public_key_b64 ?? null;
  return { publicKeyB64 };
}

/**
 * Wrap a household DEK for a single recipient using the hybrid KEM
 * strategy. Returns a payload ready to persist to `household_keys`.
 */
export async function wrapHouseholdDekForRecipient(
  householdDek: Uint8Array,
  recipientPublicKeyB64: string,
  algorithm: string = DEFAULT_WRAP_ALGORITHM,
): Promise<HouseholdDekWrapPayload> {
  if (householdDek.length !== 32) {
    throw new Error(`householdDek must be 32 bytes, got ${householdDek.length}`);
  }

  const strategy = KEY_WRAP_STRATEGIES[algorithm];
  if (!strategy) {
    throw new Error(`unknown wrap strategy: ${algorithm}`);
  }

  let recipientPublicKey: Uint8Array;
  try {
    recipientPublicKey = base64ToBytes(recipientPublicKeyB64);
  } catch (err) {
    throw new Error(
      `recipient public key is not valid base64: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }

  const wrapped = await strategy.wrapForRecipient(householdDek, recipientPublicKey);

  return {
    enc_household_dek: bytesToBase64(wrapped),
    wrap_algo: HOUSEHOLD_WRAP_ALGO,
  };
}

/**
 * Convenience: look up the recipient's public key by user id and wrap
 * the household DEK for them. Returns null if the recipient has no
 * published keypair yet — the caller should route to the pending
 * household_invites path.
 */
export async function wrapHouseholdDekByUserId(
  householdDek: Uint8Array,
  recipientUserId: string,
): Promise<HouseholdDekWrapPayload | null> {
  const { publicKeyB64 } = await lookupRecipientPublicKey(recipientUserId);
  if (!publicKeyB64) return null;
  return wrapHouseholdDekForRecipient(householdDek, publicKeyB64);
}

/**
 * Unwrap a household DEK encrypted to ourselves. Used by Owner unlock
 * paths and by the V3-style placeholder-to-real-DEK migration in Phase
 * 4.5 first-time setup.
 */
export async function unwrapHouseholdDekForSelf(
  wrappedB64: string,
  ownSecretKey: Uint8Array,
  algorithm: string = DEFAULT_WRAP_ALGORITHM,
): Promise<Uint8Array> {
  const strategy = KEY_WRAP_STRATEGIES[algorithm];
  if (!strategy) {
    throw new Error(`unknown wrap strategy: ${algorithm}`);
  }
  const wrapped = base64ToBytes(wrappedB64);
  return strategy.unwrapForSelf(wrapped, ownSecretKey);
}

/**
 * Drain ready_to_wrap household_invites rows for a household. For each:
 *   - look up the recipient's public key
 *   - generate a placeholder household DEK
 *   - wrap it
 *   - call complete-household-invite-wrap to persist + activate the
 *     member
 *
 * Returns counts so the UI can toast a summary. Errors per row are
 * caught + logged; the caller decides whether to retry.
 *
 * Used both by an explicit "Complete pending invites" button and by the
 * realtime subscription that fires on household_invites status flips.
 */
export async function completePendingHouseholdWraps(
  householdId: string,
): Promise<{ ok: number; failed: number }> {
  const { data: ready, error } = await supabase
    .from("household_invites" as never)
    .select("id, recipient_user_id")
    .eq("household_id" as never, householdId)
    .eq("status" as never, "ready_to_wrap");
  if (error) {
    console.warn("[household-invite] ready_to_wrap fetch failed:", error.message);
    return { ok: 0, failed: 0 };
  }
  const rows = (ready ?? []) as unknown as Array<{
    id: string;
    recipient_user_id: string | null;
  }>;

  let ok = 0;
  let failed = 0;
  for (const row of rows) {
    if (!row.recipient_user_id) {
      failed += 1;
      continue;
    }
    try {
      const { publicKeyB64 } = await lookupRecipientPublicKey(row.recipient_user_id);
      if (!publicKeyB64) {
        failed += 1;
        continue;
      }
      const householdDek = generatePlaceholderHouseholdDek();
      const payload = await wrapHouseholdDekForRecipient(householdDek, publicKeyB64);
      const { error: completeErr } = await supabase.functions.invoke(
        "complete-household-invite-wrap",
        {
          body: {
            invite_id: row.id,
            wrapped_dek: payload,
          },
        },
      );
      if (completeErr) throw completeErr;
      ok += 1;
    } catch (err) {
      console.warn("[household-invite] complete-household-invite-wrap failed for", row.id, err);
      failed += 1;
    }
  }

  return { ok, failed };
}
