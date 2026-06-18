/**
 * household-osk.ts — Higher-level wrappers around the OW Household
 * Signing Key (HSK / OSK equivalent) primitives.
 *
 * Orchestrates the Supabase edge-function calls that:
 *   1. Discover which household members are writers (eligible recipients
 *      for an HSK wrap).
 *   2. Mint a fresh HSK, wrap it to those writers, and POST it to the
 *      `mint-household-signing-key` edge function.
 *   3. Audit an Owner's view of who has an active HSK wrap.
 *
 * The signing-key bytes never leave the browser; the server only ever
 * sees the public half + per-writer hybrid-KEM wraps.
 */

import { supabase } from "@/integrations/supabase/client";
import {
  generateAndWrapHouseholdSigningKey,
  type GeneratedHouseholdSigningKeyBundle,
} from "@/lib/osk";

// Writer-eligible roles. Auditors are deliberately excluded — that is
// the cryptographic read-only enforcement. Pending members have no
// usable public key yet; the next-unlock invite flow handles them.
const WRITER_ROLES = new Set(["owner", "partner"]);

interface MemberRow {
  user_id: string | null;
  role: string;
  status: string;
}

interface PublicKeyRow {
  user_id: string;
  public_key_b64: string;
}

export interface MintHouseholdSigningKeyResult {
  /** Fresh public key + private key bytes. Private key lives only in caller memory. */
  bundle: GeneratedHouseholdSigningKeyBundle;
  /** What the edge function returned. */
  serverResponse: {
    ok: boolean;
    household_id: string;
    key_version: number;
    wrap_count: number;
  };
}

/**
 * Discover writer-eligible members for a household and return one
 * recipient entry per writer, ready to feed
 * generateAndWrapHouseholdSigningKey.
 */
export async function listHouseholdWriters(
  householdId: string,
): Promise<Array<{ userId: string; publicKeyB64: string }>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // 1) Active members with a writer role.
  const memberQuery = await db
    .from("household_members")
    .select("user_id, role, status")
    .eq("household_id", householdId)
    .eq("status", "active");

  if (memberQuery.error) {
    throw new Error(`Could not list household members: ${memberQuery.error.message}`);
  }
  const memberRows = (memberQuery.data ?? []) as MemberRow[];
  const writerUserIds = memberRows
    .filter((m) => m.user_id && WRITER_ROLES.has(m.role))
    .map((m) => m.user_id as string);

  if (writerUserIds.length === 0) {
    return [];
  }

  // 2) Their published hybrid public keys.
  const pkQuery = await db
    .from("user_public_keys")
    .select("user_id, public_key_b64")
    .in("user_id", writerUserIds);

  if (pkQuery.error) {
    throw new Error(`Could not look up writer public keys: ${pkQuery.error.message}`);
  }
  const pkRows = (pkQuery.data ?? []) as PublicKeyRow[];
  const byUser = new Map(pkRows.map((r) => [r.user_id, r.public_key_b64]));

  const recipients: Array<{ userId: string; publicKeyB64: string }> = [];
  for (const uid of writerUserIds) {
    const pk = byUser.get(uid);
    if (!pk) {
      // The writer has not finished setting up their account yet. Skip
      // them — they will get a wrap on the next mint (i.e. once an
      // Owner regenerates the signing key after they unlock).
      continue;
    }
    recipients.push({ userId: uid, publicKeyB64: pk });
  }
  return recipients;
}

/**
 * Mint a fresh household signing key:
 *   1. List writer recipients.
 *   2. Generate + wrap the keypair locally.
 *   3. POST the public half + per-recipient wraps to the edge function.
 *
 * The caller is the household Owner. The edge function rejects calls
 * from anyone else.
 *
 * Returns the bundle (so the caller can stash the private bytes in the
 * VaultContext cache for the rest of the session) plus the server
 * response.
 */
export async function mintSigningKeyForHousehold(
  householdId: string,
): Promise<MintHouseholdSigningKeyResult> {
  if (!householdId) throw new Error("householdId is required");

  const writers = await listHouseholdWriters(householdId);
  if (writers.length === 0) {
    throw new Error(
      "Could not sign your account: no active writer members found. " +
        "Make sure you have unlocked your vault at least once.",
    );
  }

  // Determine the next key_version. For a first mint this is 1; for
  // subsequent rotations the edge function will reject duplicates so
  // we read the current max first.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const existing = await db
    .from("household_signing_keys")
    .select("key_version")
    .eq("household_id", householdId)
    .order("key_version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextVersion =
    existing.data?.key_version != null ? Number(existing.data.key_version) + 1 : 1;

  const bundle = await generateAndWrapHouseholdSigningKey(householdId, writers, nextVersion);

  const { data, error } = await supabase.functions.invoke("mint-household-signing-key", {
    body: {
      household_id: householdId,
      public_key_b64: bundle.publicKeyB64,
      key_version: bundle.keyVersion,
      algorithm: bundle.algorithm,
      wraps: bundle.wraps,
    },
  });
  if (error) {
    const msg = (error as { message?: string }).message ?? "Failed to sign your account";
    throw new Error(msg);
  }

  return {
    bundle,
    serverResponse: data as MintHouseholdSigningKeyResult["serverResponse"],
  };
}

/**
 * Probe whether the active household already has a signing key (HSK)
 * minted. Used by VaultContext's first-time-setup gate.
 */
export async function householdHasSigningKey(householdId: string): Promise<boolean> {
  if (!householdId) return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data, error } = await db
    .from("household_signing_keys")
    .select("household_id")
    .eq("household_id", householdId)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn("[household-osk] householdHasSigningKey lookup failed", error);
    return false;
  }
  return Boolean(data);
}

/**
 * Verify that a given household member currently has an HSK wrap. Used
 * by the Owner Settings UI to show which members are signing-ready.
 */
export async function verifyHouseholdMemberOskWrap(
  memberUserId: string,
  householdId: string,
): Promise<boolean> {
  if (!memberUserId || !householdId) return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data, error } = await db
    .from("household_member_osk_wraps")
    .select("user_id, key_version")
    .eq("household_id", householdId)
    .eq("user_id", memberUserId)
    .order("key_version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn("[household-osk] verifyHouseholdMemberOskWrap lookup failed", error);
    return false;
  }
  return Boolean(data);
}
