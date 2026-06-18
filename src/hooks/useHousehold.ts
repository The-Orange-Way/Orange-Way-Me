/**
 * useHousehold — CRUD for the household the current user owns (or belongs to).
 *
 * Each user can own at most one household. Members join via email invite
 * (Phase 4.3) or legacy invite code. The Phase 4.3 flow wraps the
 * household DEK to each member's hybrid public key on accept; the
 * legacy code path remains for invite codes already in flight.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useVault } from "@/context/VaultContext";
import { useAuth } from "@/context/AuthContext";
import {
  generatePlaceholderHouseholdDek,
  wrapHouseholdDekForRecipient,
  HOUSEHOLD_WRAP_ALGO,
} from "@/lib/household-invite-wrap";

// (supabase as any) preserves loose typing for legacy callsites where local
// interfaces (Household, HouseholdInvite, HouseholdMember) intentionally
// differ in shape from the generated DB Row types. Tightening these is a
// separate cleanup item — see follow-up tasks.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => supabase as any;

// Phase 4.1 vocabulary. v1 ships owner + partner only in the invite UI;
// advisor/dependent render but stay marked "Coming soon".
// Phase 4.4 adds 'auditor' (time-boxed read-only — surfaces in the UI as
// "Tax accountant view") and 'support' (customer support, granted only
// server-side via the support-session edge function — never invited
// directly from this hook).
export type HouseholdRole = "owner" | "partner" | "advisor" | "dependent" | "auditor" | "support";

export interface HouseholdMember {
  id: string;
  household_id: string;
  user_id: string | null;
  enc_email: string | null;
  role: HouseholdRole;
  status: "pending" | "active" | "removed";
  invited_at: string;
  joined_at: string | null;
  // Phase 4.4 — time-boxed grants.
  expires_at?: string | null;
  source?: "direct" | "auditor_invite" | "support_grant";
  // Decrypted:
  email?: string;
}

export interface HouseholdInvite {
  id: string;
  household_id: string;
  role: HouseholdRole;
  code: string;
  email: string | null;
  status: "code_only" | "awaiting_recipient" | "ready_to_wrap" | "wrapped" | "expired" | "revoked";
  expires_at: string;
  used_by: string | null;
  created_at: string;
}

/** Currency codes accepted by household.primary_currency / reporting_currency. */
export type HouseholdCurrency = "USD" | "CAD" | "EUR" | "GBP" | "BTC" | "sats";

/** Bitcoin display modes mirrored from useDashboardPrefs. Stored on the
 *  household so co-admins share a default; per-user prefs can still override. */
export type HouseholdBtcDisplayMode = "btc" | "btc_easy" | "sats" | "primary";

export interface Household {
  id: string;
  owner_id: string;
  enc_name: string;
  created_at: string;
  /** Default currency the dashboard renders in for every member. */
  primary_currency: HouseholdCurrency;
  /** Currency used for exports / year-end statements. Often equals primary. */
  reporting_currency: HouseholdCurrency;
  /** How Bitcoin amounts render across the app for the household. */
  btc_display_mode: HouseholdBtcDisplayMode;
  // Decrypted:
  name: string;
}

export interface HouseholdCurrencyPatch {
  primary_currency?: HouseholdCurrency;
  reporting_currency?: HouseholdCurrency;
  btc_display_mode?: HouseholdBtcDisplayMode;
}

export function useHousehold() {
  const { user } = useAuth();
  const { encryptText, decryptText, isUnlocked } = useVault();
  const [household, setHousehold] = useState<Household | null>(null);
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [invites, setInvites] = useState<HouseholdInvite[]>([]);
  const [loading, setLoading] = useState(true);

  const loadHousehold = useCallback(async () => {
    if (!user || !isUnlocked) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data: hh } = await db()
        .from("households")
        .select("*")
        .eq("owner_id", user.id)
        .maybeSingle();

      if (!hh) {
        setHousehold(null);
        setMembers([]);
        setInvites([]);
        return;
      }

      const name = await decryptText(hh.enc_name).catch(() => "(encrypted)");
      setHousehold({ ...hh, name });

      const { data: mems } = await db()
        .from("household_members")
        .select("*")
        .eq("household_id", hh.id)
        .neq("status", "removed");

      const decryptedMembers: HouseholdMember[] = await Promise.all(
        (mems ?? []).map(async (m: HouseholdMember) => ({
          ...m,
          email: m.enc_email
            ? await decryptText(m.enc_email).catch(() => "(encrypted)")
            : undefined,
        })),
      );
      setMembers(decryptedMembers);

      // Pending invites = anything still awaiting wrap or wrap-ready
      // OR a legacy code-only invite that hasn't been used. Wrapped
      // and revoked rows are hidden from the UI.
      const { data: inv } = await db()
        .from("household_invites")
        .select("*")
        .eq("household_id", hh.id)
        .in("status", ["code_only", "awaiting_recipient", "ready_to_wrap"])
        .gt("expires_at", new Date().toISOString());
      setInvites(inv ?? []);
    } finally {
      setLoading(false);
    }
  }, [user, isUnlocked, decryptText]);

  useEffect(() => {
    loadHousehold();
  }, [loadHousehold]);

  const createHousehold = useCallback(
    async (name: string) => {
      if (!user) throw new Error("Not authenticated");
      const encName = await encryptText(name);
      const { data, error } = await db()
        .from("households")
        .insert({ owner_id: user.id, enc_name: encName })
        .select()
        .single();
      if (error) throw new Error(error.message);

      // Phase 4.3 unblocker: createHousehold now also seeds the owner's
      // household_members row + a placeholder household_keys wrap so the
      // Phase 4.5 first-time-setup gate has something to flip on next
      // unlock. Without this, the gate sees no wrap row and silently
      // skips setup — leaving the household DEK at the placeholder
      // forever.
      try {
        // 1) Owner household_members row.
        const ownerEmail = user.email ?? "";
        const encOwnerEmail = ownerEmail ? await encryptText(ownerEmail) : null;
        await db()
          .from("household_members")
          .insert({
            household_id: data.id,
            user_id: user.id,
            role: "owner" as HouseholdRole,
            status: "active",
            joined_at: new Date().toISOString(),
            enc_email: encOwnerEmail,
          });

        // 2) Look up our own public key so we can wrap-to-self. The
        // VaultContext unlock path generates the keypair on first
        // unlock (ensureUserKeypair); by the time createHousehold runs
        // the row exists. If for any reason it doesn't yet, skip the
        // wrap — first-time setup will create it later.
        const { data: pkRow } = await db()
          .from("user_public_keys")
          .select("public_key_b64")
          .eq("user_id", user.id)
          .maybeSingle();
        const publicKeyB64 = (pkRow as { public_key_b64?: string } | null)?.public_key_b64;
        if (publicKeyB64) {
          const placeholderDek = generatePlaceholderHouseholdDek();
          const wrap = await wrapHouseholdDekForRecipient(placeholderDek, publicKeyB64);
          await db()
            .from("household_keys")
            .insert({
              household_id: data.id,
              user_id: user.id,
              enc_household_dek: wrap.enc_household_dek,
              wrap_algo: wrap.wrap_algo ?? HOUSEHOLD_WRAP_ALGO,
              key_version: 1,
              is_placeholder: true,
              wrapped_by: user.id,
            });
        } else {
          console.warn(
            "[household] createHousehold: owner has no public key yet; " +
              "Phase 4.5 first-time setup will seed the wrap on next unlock.",
          );
        }
      } catch (seedErr) {
        // Non-fatal: the household exists; first-time setup can still
        // recover. Surface the failure as a warning so we notice it in
        // logs but do not roll back the household creation.
        console.warn("[household] createHousehold owner self-wrap failed:", seedErr);
      }

      const decName = await decryptText(data.enc_name);
      setHousehold({ ...data, name: decName });
      // Reload to surface the freshly-inserted owner member row.
      await loadHousehold();
    },
    [user, encryptText, decryptText, loadHousehold],
  );

  const updateName = useCallback(
    async (name: string) => {
      if (!household) throw new Error("No household");
      const encName = await encryptText(name);
      const { error } = await db()
        .from("households")
        .update({ enc_name: encName })
        .eq("id", household.id);
      if (error) throw new Error(error.message);
      setHousehold((h) => (h ? { ...h, enc_name: encName, name } : h));
    },
    [household, encryptText],
  );

  /**
   * Update household-level currency preferences. Plaintext columns — no
   * encryption needed. RLS allows only owner + partner roles to write.
   * Owner save also updates the saving user's per-device prefs upstream
   * (handled in HouseholdCurrenciesCard) so the dashboard refreshes
   * immediately for the admin.
   */
  const updateCurrencyPrefs = useCallback(
    async (patch: HouseholdCurrencyPatch) => {
      if (!household) throw new Error("No household");
      if (Object.keys(patch).length === 0) return;
      const { error } = await db().from("households").update(patch).eq("id", household.id);
      if (error) throw new Error(error.message);
      setHousehold((h) => (h ? { ...h, ...patch } : h));
    },
    [household],
  );

  /**
   * Phase 4.3: email-based invite via the invite-household-member edge
   * function. The function decides wrap-now vs pending based on whether
   * the recipient already has a published keypair. If they do, this
   * returns wrap_status='wrapped' and we reload immediately; otherwise
   * the invite stays in awaiting_recipient until the recipient
   * publishes a keypair.
   */
  const inviteByEmail = useCallback(
    async (email: string, role: HouseholdRole, opts: { expiresAt?: string } = {}) => {
      if (!household) throw new Error("No household");
      const encEmail = await encryptText(email);
      const body: Record<string, unknown> = {
        household_id: household.id,
        email,
        role,
        enc_email: encEmail,
      };
      // Phase 4.4: time-boxed grant. Required for auditor invites.
      if (opts.expiresAt) {
        body.expires_at = opts.expiresAt;
        if (role === "auditor") body.source = "auditor_invite";
      }
      const { data, error } = await supabase.functions.invoke("invite-household-member", { body });
      if (error) {
        const msg = (error as { message?: string }).message ?? "Failed to send invite";
        throw new Error(msg);
      }
      await loadHousehold();
      return data as {
        ok: boolean;
        wrap_status: "wrapped" | "pending";
        message: string;
      };
    },
    [household, encryptText, loadHousehold],
  );

  /**
   * Phase 4.4: extend a time-boxed member's expires_at. Server caps
   * the new value at 1 year for auditor and 24h for support sessions.
   */
  const extendRoleExpiry = useCallback(
    async (memberId: string, newExpiresAtIso: string) => {
      if (!household) throw new Error("No household");
      const { error } = await supabase.functions.invoke("admin-update-household-member", {
        body: {
          household_id: household.id,
          action: "extend_role_expiry",
          payload: {
            member_id: memberId,
            new_expires_at: newExpiresAtIso,
          },
        },
      });
      if (error) {
        const msg = (error as { message?: string }).message ?? "Could not extend";
        throw new Error(msg);
      }
      await loadHousehold();
    },
    [household, loadHousehold],
  );

  /**
   * Legacy code-based invite. Kept around for in-flight invite codes
   * shared before Phase 4.3 shipped.
   */
  const createInvite = useCallback(
    async (role: HouseholdRole): Promise<HouseholdInvite> => {
      if (!household) throw new Error("No household");
      const { data, error } = await db()
        .from("household_invites")
        .insert({ household_id: household.id, role, status: "code_only" })
        .select()
        .single();
      if (error) throw new Error(error.message);
      setInvites((prev) => [...prev, data]);
      return data;
    },
    [household],
  );

  const revokeInvite = useCallback(async (inviteId: string) => {
    const { error } = await db()
      .from("household_invites")
      .update({ status: "revoked", revoked_at: new Date().toISOString() })
      .eq("id", inviteId);
    if (error) throw new Error(error.message);
    setInvites((prev) => prev.filter((i) => i.id !== inviteId));
  }, []);

  /**
   * Phase 4.3: row-level remove via the admin-update-household-member
   * edge function. Soft-revokes the household_members row, deletes
   * their household_keys wrap, and writes an audit event. The Owner is
   * then prompted to refresh household security.
   */
  const removeMember = useCallback(
    async (memberId: string) => {
      const member = members.find((m) => m.id === memberId);
      if (!household) throw new Error("No household");
      if (!member?.user_id) {
        // Pre-Phase 4.3 row without a user_id: fall back to local
        // status flip so the legacy UI still works.
        const { error } = await db()
          .from("household_members")
          .update({ status: "removed" })
          .eq("id", memberId);
        if (error) throw new Error(error.message);
        setMembers((prev) => prev.filter((m) => m.id !== memberId));
        return;
      }
      const { error } = await supabase.functions.invoke("admin-update-household-member", {
        body: {
          household_id: household.id,
          target_user_id: member.user_id,
          action: "soft_revoke",
        },
      });
      if (error) {
        const msg = (error as { message?: string }).message ?? "Failed to remove member";
        throw new Error(msg);
      }
      setMembers((prev) => prev.filter((m) => m.id !== memberId));
    },
    [household, members],
  );

  const changeRole = useCallback(async (memberId: string, role: HouseholdRole) => {
    const { error } = await db().from("household_members").update({ role }).eq("id", memberId);
    if (error) throw new Error(error.message);
    setMembers((prev) => prev.map((m) => (m.id === memberId ? { ...m, role } : m)));
  }, []);

  return {
    household,
    members,
    invites,
    loading,
    createHousehold,
    updateName,
    updateCurrencyPrefs,
    inviteByEmail,
    createInvite,
    revokeInvite,
    removeMember,
    changeRole,
    extendRoleExpiry,
    reload: loadHousehold,
  };
}
