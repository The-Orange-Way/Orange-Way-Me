/**
 * VaultContext — owns the vault's lifecycle (set up, unlock, lock, recover,
 * change vault password, regenerate recovery code) and exposes encrypt/decrypt
 * primitives bound to the in-memory MEK.
 *
 * Zero-knowledge invariants:
 *   - The vault password NEVER leaves the browser.
 *   - The MEK is held as a non-extractable CryptoKey (mekRef) AND as raw bytes
 *     (mekBytesRef) for the duration the vault is unlocked. Raw bytes are
 *     needed for re-wrapping (changeVaultPassword, regenerateRecoveryCode).
 *   - Locking the vault or closing the tab discards both.
 *
 * Architecture (vault_metadata columns):
 *   kdf_salt            — PBKDF2 salt for password-derived KEK
 *   kdf_iterations      — PBKDF2 iteration count
 *   enc_mek_ciphertext  — MEK wrapped with password-derived KEK (new)
 *   verifier_ciphertext — VAULT_VERIFIER_PLAINTEXT encrypted with MEK
 *   recovery_ciphertext — MEK wrapped with recovery-code-derived KEK
 *   enc_hmac_key        — HMAC key encrypted with MEK (new)
 *   hmac_salt           — kept for legacy HMAC derivation (old vaults)
 *
 * Old vaults (no enc_mek_ciphertext): fall back to deriveMek(password, salt)
 *   as the MEK itself. This path loses the "change password without re-encrypt"
 *   property but remains fully functional.
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { logSecurityEvent } from "@/lib/audit";
import {
  CURRENT_VAULT_KEY_VERSION,
  KEY_DERIVATION_STRATEGIES,
  VAULT_VERIFIER_PLAINTEXT,
  type VaultKeyVersion,
  createEncryptedHmacKey,
  decryptBlob as cryptoDecryptBlob,
  decryptHmacKey,
  decryptText as cryptoDecryptText,
  deriveHmacKey,
  deriveMek,
  deriveOrCredsKeyFromMek,
  deriveOrMekBytes,
  deriveOrOpkSeedFromMek,
  deriveOrTxnsKeyFromMek,
  deriveOrStealthWidgetKeyBytesFromMek,
  encryptBlob as cryptoEncryptBlob,
  encryptText as cryptoEncryptText,
  generateRecoveryCode,
  importMekFromRaw,
  randomBytesB64,
  unwrapMekWithRecovery,
  unwrapOrMekWithVaultMek,
  wrapMekWithRecovery,
  wrapOrMekWithVaultMek,
} from "@/lib/vault";
import {
  CURRENT_OR_KEY_EPOCH,
  OrNamespaceDisabledError,
  planOrKeyMaterial,
  type OrKeyMaterialRow,
} from "@/lib/or/or-key-material";
import {
  ensureUserKeypair,
  rewrapUserKeypair,
  importMekForHkdf,
  type SupabaseKeypairClient,
} from "@/lib/vault-keypair";
import {
  decryptForScope,
  encryptForScope,
  unwrapHouseholdDek,
  type Scope,
} from "@/lib/scope-encryption";
import { derivePqcSecretWrapKey } from "@/lib/key-derivation";
import { opkKeypairFromSeed, type OpkKeypair } from "@/lib/or/opk";
import { base64ToBytes } from "@/lib/key-wrapping";
import {
  unwrapHouseholdSigningKey,
  signMutation as oskSignMutation,
  type OskHandle,
} from "@/lib/osk";
import { householdHasSigningKey, mintSigningKeyForHousehold } from "@/lib/household-osk";
import { buildHouseholdSignatureFields as buildSigFields } from "@/lib/row-signing";
import { featureFlags } from "@/lib/feature-flags";

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * One-way fingerprint of raw key bytes for diagnostic logging. SHA-256 of
 * the key, first 4 bytes (8 hex chars). Two identical keys hash identically;
 * a single different bit produces an entirely different fingerprint. The
 * hash is non-invertible, so logging it cannot leak key material.
 */
async function keyFingerprint(raw: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", raw);
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < 4; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Phase 4.5: silent first-time household security setup.
 *
 * Fires once per household on the Owner's first unlock after invites
 * exist. Replaces the Phase 4.3 placeholder wrap (random per-member
 * DEK) with a real shared household DEK, re-wraps it for every
 * current member, and bumps dek_key_version on every row.
 *
 * Non-fatal on any error — we log and move on. The Owner can always
 * run a manual refresh from Settings → Household security.
 */
async function maybeKickOffFirstTimeHouseholdSetup(userId: string): Promise<void> {
  // Imports happen inline to avoid pulling rekey/Supabase into every
  // initial mount cost path. VaultContext already depends on supabase
  // so the extra module cost is negligible.
  const { default: _ } = { default: null };
  void _;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Is this user a household Owner?
  const { data: hh } = await db
    .from("households")
    .select("id")
    .eq("owner_id", userId)
    .maybeSingle();
  const household = (hh as { id: string } | null) ?? null;
  if (!household) return;

  // Active DEK version currently 1?
  const { data: active } = await db
    .from("household_active_key_versions")
    .select("active_dek_key_version")
    .eq("household_id", household.id)
    .maybeSingle();
  const activeKv =
    (active as { active_dek_key_version?: number } | null)?.active_dek_key_version ?? 1;
  if (activeKv > 1) return; // already refreshed at least once

  // Owner's own wrap is a placeholder?
  const { data: wrap } = await db
    .from("household_keys")
    .select("is_placeholder")
    .eq("household_id", household.id)
    .eq("user_id", userId)
    .eq("key_version", activeKv)
    .maybeSingle();
  const isPlaceholder = (wrap as { is_placeholder?: boolean } | null)?.is_placeholder;
  if (!isPlaceholder) return;

  // Is a refresh job already running? Bail if so — don't pile on.
  const { data: activeJob } = await db
    .from("household_key_rotation_jobs")
    .select("id")
    .eq("household_id", household.id)
    .not("status", "in", "(complete,aborted,rolled_back)")
    .maybeSingle();
  if (activeJob) return;

  // Lazy import — keeps first paint fast if the user never unlocks as
  // a household Owner.
  const { startHouseholdRekeyJob, runHouseholdRekeyJob } = await import("@/lib/household-rekey");

  try {
    const start = await startHouseholdRekeyJob(household.id, "first_time_setup", "quick");
    await runHouseholdRekeyJob(start.jobId, {
      onComplete: () => {
        // Queue the welcome email + show a soft toast. Non-blocking.
        void queueHouseholdReadyEmail(userId, household.id);
        // Lazy import sonner so this helper doesn't add to the
        // app-shell bundle cost when no refresh happens.
        void import("sonner").then(({ toast }) =>
          toast.success("Household security setup completed."),
        );
      },
    });
  } catch (err) {
    console.warn("[vault] first-time household setup kickoff failed", err);
  }
}

async function queueHouseholdReadyEmail(userId: string, householdId: string): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    await db.from("pending_admin_emails").insert({
      user_id: userId,
      household_id: householdId,
      kind: "household_ready",
      subject: "Your household is ready",
      body:
        "Hi,\n\n" +
        "Your Orange Way household is set up and secured with its own " +
        "keys — just for you and the people you invite.\n\n" +
        "What's next:\n" +
        "  • Invite anyone you want to share finances with from " +
        "Settings → Household.\n" +
        "  • You can refresh your household's security any time from " +
        "Settings → Household security.\n\n" +
        "If you ever need help, open the help center from the app menu.\n\n" +
        "— Orange Way",
    });
  } catch (err) {
    console.warn("[vault] queue household_ready email failed", err);
  }
}

const vaultTable = () => supabase.from("vault_metadata");

/** The refs the Orange Rails namespace lives in, bundled so the install and
 *  teardown paths cannot fall out of step with each other. */
interface OrKeyRefs {
  creds: { current: CryptoKey | null };
  txns: { current: CryptoKey | null };
  opk: { current: Uint8Array | null };
  stealth: { current: Uint8Array | null };
  disabledReason: { current: string | null };
}

/**
 * Install the four Orange Rails subkeys for this session, or disable the
 * namespace and leave the rest of the vault working.
 *
 * Shared by unlock and recovery so the two cannot drift apart. The failure is
 * deliberately loud in the console and deliberately quiet about the vault: an
 * unlock that succeeded is not reported as an unlock that failed.
 *
 * Module level, taking its refs and setter as arguments, so the callers stay
 * dependency-free stable callbacks.
 */
async function applyOrKeyMaterial(
  material: OrKeyMaterial,
  refs: OrKeyRefs,
  setReason: (reason: string | null) => void,
): Promise<void> {
  if (!material.ok) {
    refs.creds.current = null;
    refs.txns.current = null;
    refs.opk.current = null;
    refs.stealth.current = null;
    refs.disabledReason.current = material.reason;
    setReason(material.reason);
    console.error("[vault] Orange Rails namespace disabled:", material.reason);
    return;
  }
  const { orMekBytes, saltContext } = material;
  refs.creds.current = await deriveOrCredsKeyFromMek(orMekBytes, saltContext);
  refs.txns.current = await deriveOrTxnsKeyFromMek(orMekBytes, saltContext);
  refs.opk.current = await deriveOrOpkSeedFromMek(orMekBytes, saltContext);
  refs.stealth.current = await deriveOrStealthWidgetKeyBytesFromMek(orMekBytes, saltContext);
  refs.disabledReason.current = null;
  setReason(null);
}

/**
 * Throw the precise DL-1506 signal when the vault is unlocked but the Orange
 * Rails namespace is not usable.
 *
 * This exists so callers never have to distinguish the two failures by reading
 * a message string. Without it every Orange Rails accessor would report "Vault
 * is locked" for a vault that is demonstrably unlocked, which sends the
 * customer to re-enter a password that cannot help.
 *
 * Module level, and takes the ref rather than closing over it, so the
 * accessors that call it stay dependency-free stable callbacks.
 */
function assertOrAvailable(reasonRef: { current: string | null }): void {
  if (reasonRef.current) throw new OrNamespaceDisabledError(reasonRef.current);
}

type OrKeyMaterial =
  | { ok: true; orMekBytes: Uint8Array; saltContext: string }
  | { ok: false; reason: string };

/**
 * Where the Orange Rails key material comes from (DL-1506).
 *
 * Every caller below used to do the same thing: derive it from the password
 * and whatever kdf_salt happened to be current. That is the bug. kdf_salt is
 * regenerated on a password change and on a recovery, so all four Orange Rails
 * subkeys changed with it and every row already sealed under the old ones
 * became unopenable by anyone, us included.
 *
 * Now the material is pinned once and reused. The pinning moment is any moment
 * the legacy derivation is still correct: vault creation, or an unlock, where
 * the password is in hand and the salt has not yet rotated.
 *
 * There is NO exclusion for the pre-wrapped-MEK vault shape. Pinning under a
 * password derived vault MEK decouples less than pinning under a random one,
 * but it is not worse than deriving directly, and no row in the system has
 * that shape, so a second code path would be a branch no test could reach.
 *
 * A refusal disables the Orange Rails namespace for the session and must never
 * be turned into a fall back to derivation. After a rotation, deriving yields
 * a well formed key that opens nothing and reports success, which is precisely
 * the failure being removed.
 */
async function resolveOrKeyMaterial(params: {
  userId: string;
  password: string;
  mek: CryptoKey;
  row: OrKeyMaterialRow;
  kdfSalt: string;
}): Promise<OrKeyMaterial> {
  const { userId, password, mek, row, kdfSalt } = params;

  const plan = planOrKeyMaterial(row, kdfSalt);

  // A refusal disables the Orange Rails namespace and does NOT fail the
  // unlock. Two reasons, and the second is the important one. First, the
  // customer's vault is not in question here; locking them out of their own
  // finances because one namespace cannot be reproduced is a worse outcome
  // than the bug being fixed. Second, the tempting alternative, falling back
  // to deriving, is the original defect: after a rotation it produces a key
  // that opens nothing while looking exactly like success.
  if (plan.mode === "refuse") {
    return { ok: false, reason: plan.reason };
  }

  if (plan.mode === "unwrap") {
    try {
      return {
        ok: true,
        orMekBytes: await unwrapOrMekWithVaultMek(plan.ciphertext, mek),
        saltContext: plan.saltContext,
      };
    } catch (e) {
      // The stored blob exists and did not open. Deriving instead would give a
      // key that seals new rows nothing can later read, so this stays a
      // refusal.
      return {
        ok: false,
        reason: `Orange Rails key material is stored but could not be opened: ${
          e instanceof Error ? e.message : String(e)
        }`,
      };
    }
  }

  const orMekBytes = await deriveOrMekBytes(password, userId, plan.saltContext);

  // Persisting the pin must never break an unlock. The value just derived is
  // correct for this session either way, and the next unlock retries the pin.
  // What must not happen is the reverse: treating a failed WRITE as a reason to
  // stop using the correct value we already hold.
  try {
    const ciphertext = await wrapOrMekWithVaultMek(orMekBytes, mek);
    const { error } = await vaultTable()
      .update({
        enc_or_mek_ciphertext: ciphertext,
        or_subkey_salt: plan.saltContext,
        or_key_epoch: plan.epoch,
      })
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
  } catch (e) {
    console.warn("[vault] could not pin Orange Rails key material; will retry next unlock", e);
  }

  return { ok: true, orMekBytes, saltContext: plan.saltContext };
}

interface VaultMetadataRow {
  user_id: string;
  kdf_salt: string;
  kdf_iterations: number;
  verifier_ciphertext: string;
  recovery_ciphertext: string | null;
  hmac_salt: string;
  enc_mek_ciphertext: string | null;
  enc_hmac_key: string | null;
  /**
   * Which generation of the vault key architecture this row was written under.
   * Every row that exists is generation 1: the MEK is random and wrapped, and
   * the earlier password-derived shape was renumbered out of existence rather
   * than left in the registry (see the CURRENT_VAULT_KEY_VERSION comment).
   * Nullable only because the column predates that renumbering.
   */
  vault_key_version: number | null;
  /** DL-1506. Orange Rails MEK sealed under the vault MEK. Null until pinned. */
  enc_or_mek_ciphertext: string | null;
  /** DL-1506. The kdf_salt in force when the above was pinned. */
  or_subkey_salt: string | null;
  /** DL-1506. Generation of the pinned pair above. Null until pinned. */
  or_key_epoch: number | null;
}

interface CreateVaultResult {
  recoveryCode: string;
}

interface VaultContextType {
  isUnlocked: boolean;
  loading: boolean;
  hasVault: boolean;
  /**
   * True when the vault-existence check failed (RLS denial, dropped
   * connection, offline). Distinct from hasVault=false ("checked, no row").
   * Consumers must not offer the create-vault path while this is true.
   */
  vaultCheckError: boolean;
  /**
   * Which generation of the vault key architecture protects the MEK wrapper.
   * Null before the row is fetched. Every vault that exists reads 1; the
   * Security page keys its upgrade prompt off this.
   */
  vaultKeyVersion: number | null;
  /**
   * Non-null when the vault is unlocked but the Orange Rails namespace is NOT
   * available, because its pinned key material could not be reproduced
   * (DL-1506). The rest of the vault works normally. Consumers must hide or
   * disable Orange Rails surfaces and show this reason rather than letting a
   * call fail later with something that reads like a lock.
   */
  orNamespaceDisabledReason: string | null;
  unlock: (password: string) => Promise<void>;
  createVault: (password: string) => Promise<CreateVaultResult>;
  finalizeVaultSetup: () => void;
  lock: () => void;
  recoverWithCode: (recoveryCode: string, newPassword: string) => Promise<void>;
  /** Change vault password without re-encrypting data (new arch only). */
  changeVaultPassword: (currentPassword: string, newPassword: string) => Promise<void>;
  /** Regenerate the recovery code (vault must be unlocked). Returns new code. */
  regenerateRecoveryCode: () => Promise<string>;
  encryptText: (plaintext: string) => Promise<string>;
  decryptText: (ciphertext: string) => Promise<string>;
  /**
   * Phase 4.2: scope-aware write. For `scope === 'personal'` this is
   * identical to `encryptText`. For `'household'` it routes to the
   * household DEK if one is available, otherwise falls back to the
   * personal MEK and emits a console.warn. For `'author_only'` it
   * routes to the personal MEK (the v1.5 per-row re-wrap primitive is
   * not implemented yet — see `scope-encryption.ts`).
   */
  encryptTextForScope: (plaintext: string, scope: Scope) => Promise<string>;
  /** Phase 4.2: scope-aware read. Mirrors `encryptTextForScope`. */
  decryptTextForScope: (ciphertext: string, scope: Scope) => Promise<string>;
  /**
   * Phase 4.2: `true` iff the user has an active household membership
   * AND the household DEK was successfully unwrapped on unlock. The UI
   * uses this to decide whether to offer sharing toggles.
   */
  hasActiveHousehold: () => boolean;
  encryptBlob: (plaintext: ArrayBuffer | Uint8Array) => Promise<Blob>;
  decryptBlob: (ciphertext: Blob | ArrayBuffer) => Promise<ArrayBuffer>;
  getHmacKey: () => CryptoKey;
  // OrangeRails subkey helpers — used by the Connections page to encrypt
  // provider credentials, decrypt connection metadata, and hand keys
  // in-transit to OR's or-sync edge function via ow-or-proxy.
  encryptOrCipher: (plaintext: string) => Promise<string>;
  decryptOrCipher: (ciphertext: string) => Promise<string>;
  decryptOrTxnCipher: (ciphertext: string) => Promise<string>;
  exportOrCredsKey: () => Promise<string>;
  exportOrTxnsKey: () => Promise<string>;
  exportOrStealthKeyB64: () => Promise<string>;
  /** Derive the OPK X25519 sealed-box keypair for the current unlock.
   *  Public half registers on OR; private half unseals synced bank txns. */
  getOpkKeypair: () => Promise<OpkKeypair>;

  /**
   * Phase 4.4: true when the current household has an HSK minted AND
   * this user has a wrap they could unwrap. Used to gate UI like the
   * "sign your account" first-run button.
   */
  householdSigningKeyAvailable: boolean;
  /**
   * Phase 4.4: lazily load + unwrap the caller's Household Signing Key
   * for the given household. Idempotent; cached for the unlocked
   * session. Returns null when the caller has no wrap (Auditor / pending
   * member) — that is a legitimate read-only state and NOT an error.
   */
  loadHouseholdSigningKey: (householdId: string) => Promise<OskHandle | null>;
  /**
   * Phase 4.4: sign an encrypted row payload with the cached HSK for
   * the given household. Returns null when no wrap is cached — the
   * call site should skip the signature column (server-side trigger
   * accepts NULL until the household has minted an HSK).
   */
  signRow: (
    payloadBytes: Uint8Array,
    householdId: string,
  ) => { signature_b64: string; key_version: number } | null;
  /**
   * Phase 4.4: the id of the household whose DEK was successfully
   * unwrapped on unlock — i.e. the household that household-scoped
   * writes should bind to. Null for solo users (no membership), for
   * locked vaults, and for users whose wrap could not be opened this
   * session.
   */
  currentHouseholdId: () => string | null;
  /**
   * Phase 4.4: build the trio of household-scope + signature columns
   * for an INSERT or UPDATE on one of the six signed encrypted tables
   * (transactions / accounts / categories / budgets / goals / rules).
   *
   *   - When a household is active AND a usable HSK is cached, returns
   *     `{ household_id, signature_b64, signature_key_version }`.
   *   - When no household is active (solo user), returns
   *     `{ household_id: null, signature_b64: null, signature_key_version: null }`.
   *   - When a household is active but the HSK is not yet cached
   *     (transition state — first run before the silent mint completes,
   *     or read-only role with no wrap), returns the household id but
   *     null signature columns. The server trigger accepts NULL
   *     signatures while the household has no HSK minted; once an HSK
   *     exists the trigger rejects unsigned writes, so this path is
   *     only safe pre-mint.
   *
   * The signed payload is the household_id as UTF-8 bytes — same as
   * the server trigger's `convert_to(v_household_id::TEXT, 'UTF8')`.
   */
  buildHouseholdSignatureFields: () => {
    household_id: string | null;
    signature_b64: string | null;
    signature_key_version: number | null;
  };
}

const VaultCtx = createContext<VaultContextType | null>(null);

export function VaultProvider({ children }: { children: React.ReactNode }) {
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [hasVault, setHasVault] = useState(false);
  // True when the vault-existence check itself failed (RLS denial, dropped
  // connection, offline). Distinct from hasVault=false, which means "checked,
  // no row". VaultGate uses this to block the create path so a returning user
  // cannot insert a duplicate vault_metadata row on a transient error.
  const [vaultCheckError, setVaultCheckError] = useState(false);
  const [vaultKeyVersion, setVaultKeyVersion] = useState<number | null>(null);
  // DL-1506. Set when the vault unlocks but the Orange Rails namespace cannot
  // be reproduced. Held as BOTH state and a ref: the state drives the UI, the
  // ref is what the subkey accessors read, because they are stable callbacks
  // that must not go stale between renders.
  const [orNamespaceDisabledReason, setOrNamespaceDisabledReason] = useState<string | null>(null);
  const mekRef = useRef<CryptoKey | null>(null);
  const mekBytesRef = useRef<Uint8Array | null>(null);
  const hmacRef = useRef<CryptoKey | null>(null);
  // OrangeRails subkeys, derived alongside the MEK at unlock.
  const orCredsKeyRef = useRef<CryptoKey | null>(null);
  const orTxnsKeyRef = useRef<CryptoKey | null>(null);
  // Raw 32-byte OPK seed (one per unlock). The X25519 keypair OR seals
  // background-synced bank transactions to is derived from this lazily via
  // opkKeypairFromSeed. Kept as the seed (not the keypair) so we don't have
  // to await libsodium at every unlock site; cleared on lock.
  const orOpkSeedRef = useRef<Uint8Array | null>(null);
  // Raw 32 bytes of the OR stealth widget subkey (one per unlock). The connect
  // widget's opening message takes this key as base64, which is the only shape
  // its contract accepts today, so the platform has to hold the bytes. Same
  // lifetime rules as the OPK seed: zeroed and nulled on lock, on sign-out and
  // on no-user, and never written to storage or sent to any server.
  const orStealthKeyBytesRef = useRef<Uint8Array | null>(null);

  const orDisabledReasonRef = useRef<string | null>(null); // Phase 4.2: active household + unwrapped DEK. Populated on unlock
  // when the user has a membership row + a wrap we can open with their
  // private key. Stays null for solo users — all scope='household'
  // writes then fall back to the personal MEK (see scope-encryption.ts).
  const currentHouseholdRef = useRef<{ id: string; dek: CryptoKey } | null>(null);
  // Phase 4.4: kdf_salt retained for HSK unwrap (HKDF derivation reuses
  // the same per-user salt the rest of the vault uses). Cleared on lock.
  const kdfSaltRef = useRef<string | null>(null);
  // Phase 4.4: per-household OSK cache. Cleared on lock. Populated lazily
  // by loadHouseholdSigningKey().
  const signingKeysRef = useRef<Map<string, OskHandle>>(new Map());
  const [householdSigningKeyAvailable, setHouseholdSigningKeyAvailable] = useState(false);
  useEffect(() => {
    let cancelled = false;
    // Tracks which user.id the current vault state corresponds to. Used to
    // distinguish a real user change (fresh sign-in, account swap) from a
    // token refresh that happens to fire SIGNED_IN with the same user.
    let lastUserId: string | null = null;

    // Re-run on auth changes too, not just initial mount. The previous
    // version ran once in a useEffect and ignored SIGNED_IN entirely; if
    // the page mounted before supabase had hydrated the session,
    // hasVault stayed `false` forever and returning users were shown
    // the create-vault flow → duplicate vault_metadata_pkey on submit.
    const checkVault = async (showLoading: boolean) => {
      if (showLoading) setLoading(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled) return;

      // No-op if the user hasn't actually changed. Skips needless work
      // on TOKEN_REFRESHED (which can also surface as SIGNED_IN in some
      // supabase-js versions) and avoids any flicker.
      if (user?.id === lastUserId && lastUserId !== null) {
        if (showLoading) setLoading(false);
        return;
      }
      lastUserId = user?.id ?? null;

      if (!user) {
        setHasVault(false);
        setIsUnlocked(false);
        setVaultKeyVersion(null);
        // Zero raw key bytes before nulling refs — see lock() for rationale.
        mekBytesRef.current?.fill(0);
        orOpkSeedRef.current?.fill(0);
        orStealthKeyBytesRef.current?.fill(0);
        mekRef.current = null;
        mekBytesRef.current = null;
        hmacRef.current = null;
        orCredsKeyRef.current = null;
        orTxnsKeyRef.current = null;
        orOpkSeedRef.current = null;
        orStealthKeyBytesRef.current = null;
        orDisabledReasonRef.current = null;
        setOrNamespaceDisabledReason(null);
        currentHouseholdRef.current = null;
        kdfSaltRef.current = null;
        for (const handle of signingKeysRef.current.values()) {
          handle.privateKeyBytes.fill(0);
        }
        signingKeysRef.current.clear();
        setHouseholdSigningKeyAvailable(false);
        if (showLoading) setLoading(false);
        return;
      }
      const { data, error } = await vaultTable()
        .select("user_id,vault_key_version")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        // "I could not check" is NOT "there is no vault". A failed select
        // (RLS denial, dropped connection, offline tab) previously fell
        // through to setHasVault(false), which renders CreateVaultFlow and
        // lets a returning user insert a duplicate vault_metadata row. Surface
        // a distinct error and leave hasVault untouched so the gate can block
        // the create path.
        console.error("vault existence check failed", error);
        setVaultCheckError(true);
        if (showLoading) setLoading(false);
        return;
      }
      setVaultCheckError(false);
      setHasVault(Boolean(data));
      if (data) {
        const row = data as { vault_key_version: number | null };
        setVaultKeyVersion(row.vault_key_version ?? 1);
      } else {
        setVaultKeyVersion(null);
      }
      if (showLoading) setLoading(false);
    };

    // Initial mount — show the loading screen so we don't render
    // CreateVaultFlow before we know whether the row exists.
    void checkVault(true);

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        lastUserId = null;
        setHasVault(false);
        setIsUnlocked(false);
        setVaultKeyVersion(null);
        // Zero raw key bytes before nulling refs — see lock() for rationale.
        mekBytesRef.current?.fill(0);
        orOpkSeedRef.current?.fill(0);
        orStealthKeyBytesRef.current?.fill(0);
        mekRef.current = null;
        mekBytesRef.current = null;
        hmacRef.current = null;
        orCredsKeyRef.current = null;
        orTxnsKeyRef.current = null;
        orOpkSeedRef.current = null;
        orStealthKeyBytesRef.current = null;
        orDisabledReasonRef.current = null;
        setOrNamespaceDisabledReason(null);
        currentHouseholdRef.current = null;
        kdfSaltRef.current = null;
        for (const handle of signingKeysRef.current.values()) {
          handle.privateKeyBytes.fill(0);
        }
        signingKeysRef.current.clear();
        setHouseholdSigningKeyAvailable(false);
        return;
      }
      if (event === "SIGNED_IN" || event === "INITIAL_SESSION") {
        // Only re-check when the user actually changed. The outer guard
        // here is what prevents needless work on token refreshes that
        // happen to surface as SIGNED_IN — when it passes, this is a
        // genuine sign-in (or account swap) and we MUST show the loader
        // so AppGate doesn't render VaultGate with the stale
        // hasVault=false from the pre-auth init pass (visible as a brief
        // "Set up your vault" flash before settling on "Unlock").
        const newUserId = session?.user?.id ?? null;
        if (newUserId !== lastUserId) {
          void checkVault(true);
        }
      }
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const createVault = useCallback(async (password: string): Promise<CreateVaultResult> => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");

    const kdfSalt = randomBytesB64(32);
    const hmacSalt = randomBytesB64(32);
    // kdf_iterations is not read by the Argon2id wrapper every vault now
    // uses. The column is kept populated because it is still displayed and
    // still written by the legacy paths below.
    const iterations = 600_000;

    // Generate a random MEK (independent of password).
    const mekRawArr = crypto.getRandomValues(new Uint8Array(32));
    const mek = await importMekFromRaw(mekRawArr);

    const verifier = await cryptoEncryptText(VAULT_VERIFIER_PLAINTEXT, mek);
    // New vaults ship on the current version, which is the only version.
    const strategy = KEY_DERIVATION_STRATEGIES[CURRENT_VAULT_KEY_VERSION];
    const encMekCiphertext = await strategy.wrapMekWithPassword(
      mekRawArr.buffer as ArrayBuffer,
      password,
      kdfSalt,
    );
    const recoveryCode = await generateRecoveryCode();
    const recoveryWrapped = await wrapMekWithRecovery(
      mekRawArr.buffer as ArrayBuffer,
      recoveryCode,
    );

    const { raw: hmacRaw, ciphertext: encHmacKey } = await createEncryptedHmacKey(mek);
    const hmacKey = await crypto.subtle.importKey(
      "raw",
      hmacRaw as BufferSource,
      { name: "HMAC", hash: "SHA-256", length: 256 },
      false,
      ["sign"],
    );

    // OrangeRails subkeys, derived here so they are available immediately
    // after finalizeVaultSetup() flips isUnlocked to true.
    //
    // Pinned in the SAME insert as everything else (DL-1506). A vault created
    // today is the one case with no legacy value to preserve, so there is no
    // reason to make it wait for its first unlock to be protected, and doing it
    // here means a brand new vault can never enter the half pinned state that
    // planOrKeyMaterial has to refuse.
    const orMekBytes = await deriveOrMekBytes(password, user.id, kdfSalt);
    const orCredsKey = await deriveOrCredsKeyFromMek(orMekBytes, kdfSalt);
    const orTxnsKey = await deriveOrTxnsKeyFromMek(orMekBytes, kdfSalt);
    const orOpkSeed = await deriveOrOpkSeedFromMek(orMekBytes, kdfSalt);
    const orStealthKeyBytes = await deriveOrStealthWidgetKeyBytesFromMek(orMekBytes, kdfSalt);
    const encOrMek = await wrapOrMekWithVaultMek(orMekBytes, mek);

    const { error } = await vaultTable().insert({
      user_id: user.id,
      kdf_salt: kdfSalt,
      kdf_iterations: iterations,
      verifier_ciphertext: verifier,
      recovery_ciphertext: recoveryWrapped,
      hmac_salt: hmacSalt,
      enc_mek_ciphertext: encMekCiphertext,
      enc_hmac_key: encHmacKey,
      vault_key_version: CURRENT_VAULT_KEY_VERSION,
      enc_or_mek_ciphertext: encOrMek,
      or_subkey_salt: kdfSalt,
      or_key_epoch: CURRENT_OR_KEY_EPOCH,
    });
    if (error) throw new Error(error.message);

    mekRef.current = mek;
    mekBytesRef.current = mekRawArr;
    hmacRef.current = hmacKey;
    orCredsKeyRef.current = orCredsKey;
    orTxnsKeyRef.current = orTxnsKey;
    orOpkSeedRef.current = orOpkSeed;
    orStealthKeyBytesRef.current = orStealthKeyBytes;
    orDisabledReasonRef.current = null;
    setOrNamespaceDisabledReason(null);
    kdfSaltRef.current = kdfSalt;
    setVaultKeyVersion(CURRENT_VAULT_KEY_VERSION);

    void logSecurityEvent(user.id, "vault_setup", { key_version: CURRENT_VAULT_KEY_VERSION });

    return { recoveryCode };
  }, []);

  const finalizeVaultSetup = useCallback(() => {
    setHasVault(true);
    setIsUnlocked(true);
  }, []);

  /**
   * Phase 4.2 — best-effort household DEK unwrap.
   *
   * Reads the user's `household_members` rows, picks the first active
   * membership, pulls the matching (non-revoked) `household_keys` row,
   * decrypts the user's enc_private_key with the HKDF-derived subkey,
   * and hands both to `unwrapHouseholdDek`. On success, the resulting
   * AES-GCM CryptoKey is cached in `currentHouseholdRef` for the rest
   * of the session.
   *
   * Any failure (no household, no wrap, unwrap error) leaves the ref
   * null and is logged at `console.warn` — the user can still use the
   * app for personal-scoped data. Phase 4.3's invite flow is
   * responsible for producing the wrap in the first place.
   */
  const loadActiveHousehold = useCallback(
    async (userId: string, mekBytes: Uint8Array, saltB64: string): Promise<void> => {
      // Narrow cast — the generated Database types may or may not include
      // the Phase 4.1 tables yet depending on when this compiles. The
      // columns below are fully specified by the migration.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = supabase as any;

      // 1) Membership lookup. The user may belong to zero or more
      // households; in v1 the product only ships one, but the schema
      // supports more (v2 roadmap). Pick the most recent membership.
      const memberQuery = await db
        .from("household_members")
        .select("household_id")
        .eq("user_id", userId)
        .order("invited_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (memberQuery.error) {
        // Supabase returned an error — could be RLS, network, or a
        // missing table. Treat as "no household" and bail quietly.
        console.warn("[vault] household_members lookup failed", memberQuery.error);
        currentHouseholdRef.current = null;
        return;
      }
      const member = memberQuery.data as { household_id: string } | null;
      if (!member) {
        // Solo user — this is the expected state before 4.3 ships.
        currentHouseholdRef.current = null;
        return;
      }

      // 2) Wrap lookup. Pull the latest non-revoked wrap for this
      // member. `household_keys` has a UNIQUE(household_id, user_id,
      // key_version) so there is at most one active row per tuple; we
      // still take .order to be resilient to a future hard re-key
      // bumping key_version.
      const wrapQuery = await db
        .from("household_keys")
        .select("enc_household_dek,key_version")
        .eq("household_id", member.household_id)
        .eq("user_id", userId)
        .is("revoked_at", null)
        .order("key_version", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (wrapQuery.error) {
        console.warn("[vault] household_keys lookup failed", wrapQuery.error);
        currentHouseholdRef.current = null;
        return;
      }
      const wrap = wrapQuery.data as { enc_household_dek: string } | null;
      if (!wrap) {
        // Membership exists but no wrap yet — pending-wrap state that
        // 4.3's invite flow will finish on the Owner's next unlock.
        console.warn(
          "[vault] household membership present but no wrapped DEK; " +
            "pending Owner wrap. Household rows unreadable this session.",
        );
        currentHouseholdRef.current = null;
        return;
      }

      // 3) Load + decrypt the user's PQC private key.
      const pkQuery = await db
        .from("vault_metadata")
        .select("enc_private_key")
        .eq("user_id", userId)
        .maybeSingle();

      if (pkQuery.error) {
        console.warn("[vault] vault_metadata lookup failed (private key)", pkQuery.error);
        currentHouseholdRef.current = null;
        return;
      }
      const pkRow = pkQuery.data as { enc_private_key: string | null } | null;
      if (!pkRow?.enc_private_key) {
        // ensureUserKeypair hasn't persisted the private key yet. Try
        // again on the next unlock.
        console.warn(
          "[vault] enc_private_key missing — keypair not yet provisioned. " + "Retry next unlock.",
        );
        currentHouseholdRef.current = null;
        return;
      }

      const mekForHkdf = await importMekForHkdf(mekBytes);
      const wrapKey = await derivePqcSecretWrapKey(mekForHkdf, saltB64);
      const secretKeyB64 = await cryptoDecryptText(pkRow.enc_private_key, wrapKey);
      const secretKeyBytes = base64ToBytes(secretKeyB64);

      // 4) Finally, unwrap the household DEK.
      const dek = await unwrapHouseholdDek(secretKeyBytes, wrap.enc_household_dek);
      currentHouseholdRef.current = { id: member.household_id, dek };
    },
    [],
  );

  const unlock = useCallback(async (password: string) => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");

    const { data, error } = await vaultTable()
      .select(
        "kdf_salt,kdf_iterations,verifier_ciphertext,hmac_salt,enc_mek_ciphertext,enc_hmac_key,vault_key_version,enc_or_mek_ciphertext,or_subkey_salt,or_key_epoch",
      )
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Vault not set up");

    const row = data as Pick<
      VaultMetadataRow,
      | "kdf_salt"
      | "kdf_iterations"
      | "verifier_ciphertext"
      | "hmac_salt"
      | "enc_mek_ciphertext"
      | "enc_hmac_key"
      | "vault_key_version"
      | "enc_or_mek_ciphertext"
      | "or_subkey_salt"
      | "or_key_epoch"
    >;

    let mek: CryptoKey;
    let mekBytes: Uint8Array;
    // Null/missing = should not occur post-wipe; defensive fallback to v1.
    const version = (row.vault_key_version ?? 1) as VaultKeyVersion;
    const strategy = KEY_DERIVATION_STRATEGIES[version] ?? KEY_DERIVATION_STRATEGIES[1];

    if (row.enc_mek_ciphertext) {
      // Current architecture: unwrap MEK using the version-appropriate KDF.
      try {
        mekBytes = await strategy.unwrapMekWithPassword(
          row.enc_mek_ciphertext,
          password,
          row.kdf_salt,
        );
      } catch {
        void logSecurityEvent(user.id, "vault_unlock_failed");
        throw new Error("Wrong vault password");
      }
      mek = await importMekFromRaw(mekBytes);
      // Verify MEK is correct.
      try {
        const probe = await cryptoDecryptText(row.verifier_ciphertext, mek);
        if (probe !== VAULT_VERIFIER_PLAINTEXT) throw new Error("verifier mismatch");
      } catch {
        void logSecurityEvent(user.id, "vault_unlock_failed");
        throw new Error("Wrong vault password");
      }
    } else {
      // Legacy shape (pre-enc_mek_ciphertext): the MEK IS the password
      // derived key rather than a random key wrapped by one. This predates
      // the strategy map, so no version in the registry describes it.
      mek = await deriveMek(password, row.kdf_salt, row.kdf_iterations);
      try {
        const probe = await cryptoDecryptText(row.verifier_ciphertext, mek);
        if (probe !== VAULT_VERIFIER_PLAINTEXT) throw new Error("verifier mismatch");
      } catch {
        void logSecurityEvent(user.id, "vault_unlock_failed");
        throw new Error("Wrong vault password");
      }
      // Legacy vaults: we can't recover raw MEK bytes. Set to empty placeholder.
      mekBytes = new Uint8Array(0);
    }

    let hmacKey: CryptoKey;
    if (row.enc_hmac_key) {
      hmacKey = await decryptHmacKey(row.enc_hmac_key, mek);
    } else {
      // Legacy HMAC derivation, only reachable for pre-enc_hmac_key vaults.
      // Those predate the strategy map, so the stored iteration count is the
      // real parameter here rather than a display-only column.
      hmacKey = await deriveHmacKey(password, row.kdf_salt, row.hmac_salt, row.kdf_iterations);
    }

    // OrangeRails subkeys. Pinned rather than re-derived (DL-1506): this used
    // to take row.kdf_salt, which is regenerated on every password change, so
    // the four subkeys moved and every row sealed under the previous ones was
    // orphaned. saltContext is the salt these keys were FIRST established
    // against and does not move again.
    //
    // The pre-enc_mek_ciphertext shape handled above is NOT excluded here. It
    // would pin the Orange Rails material under a MEK that is itself password
    // derived, which is weaker than pinning under a random wrapped MEK, but it
    // is not worse than the status quo, where that material is password
    // derived directly. Writing a second code path for a shape no row in the
    // system has would mean shipping a branch no test can reach.
    const orMaterial = await resolveOrKeyMaterial({
      userId: user.id,
      password,
      mek,
      row,
      kdfSalt: row.kdf_salt,
    });

    mekRef.current = mek;
    mekBytesRef.current = mekBytes;
    hmacRef.current = hmacKey;
    // The bundle is built here rather than at component scope so that these
    // callbacks keep an empty dependency array: a fresh object literal at
    // render time would make them, and every consumer memoised on them,
    // rebuild on every render.
    await applyOrKeyMaterial(
      orMaterial,
      {
        creds: orCredsKeyRef,
        txns: orTxnsKeyRef,
        opk: orOpkSeedRef,
        stealth: orStealthKeyBytesRef,
        disabledReason: orDisabledReasonRef,
      },
      setOrNamespaceDisabledReason,
    );
    kdfSaltRef.current = row.kdf_salt;
    setVaultKeyVersion(version);
    setIsUnlocked(true);

    void logSecurityEvent(user.id, "vault_unlock", { key_version: version });

    // Phase 4.1: make sure the user has a hybrid keypair published.
    // Idempotent — the row is written exactly once, on the unlock
    // where it's still missing. Failure MUST NOT block unlock; we
    // swallow the rejection and retry next time. Phase 4.3 picks the
    // missing-keypair case up in the invite pending-wrap flow.
    //
    // Skipped for legacy vaults where mekBytes is empty (pre-enc_mek
    // architecture) — those users cannot participate in household
    // sharing until they recreate their vault, which is the existing
    // upgrade path.
    if (mekBytes.length > 0) {
      try {
        const mekForHkdf = await importMekForHkdf(mekBytes);
        await ensureUserKeypair({
          userId: user.id,
          mek: mekForHkdf,
          saltB64: row.kdf_salt,
          supabase: supabase as unknown as SupabaseKeypairClient,
        });
      } catch (e) {
        console.warn("[vault] ensureUserKeypair failed; retry next unlock", e);
      }

      // Phase 4.2: try to unwrap the household DEK so scope='household'
      // writes route through it. Best-effort: a missing household (the
      // normal state before 4.3 ships the creation UI), a missing
      // wrap, or an unwrap failure must NOT block unlock. On any
      // failure we leave currentHouseholdRef null and scope-routed
      // writes fall back to the personal MEK.
      try {
        await loadActiveHousehold(user.id, mekBytes, row.kdf_salt);
      } catch (e) {
        console.warn(
          "[vault] loadActiveHousehold failed; household-scoped rows " +
            "will fall back to personal MEK this session",
          e,
        );
        currentHouseholdRef.current = null;
      }

      // Phase 4.5: silent first-time household security setup.
      // If the current user owns a household AND
      // household_active_key_versions.active_dek_key_version === 1
      // AND their household_keys wrap is is_placeholder=TRUE, we kick
      // off a Quick refresh in the background to replace the
      // placeholder with a real shared DEK. Non-fatal on any error.
      try {
        await maybeKickOffFirstTimeHouseholdSetup(user.id);
      } catch (e) {
        console.warn("[vault] first-time household setup check failed", e);
      }
    }
    // loadActiveHousehold is a stable useCallback defined in this component; referencing
    // it here does not create a stale-closure hazard. Same empty-deps pattern as every
    // other useCallback in this file.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeVaultPassword = useCallback(async (currentPassword: string, newPassword: string) => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");
    if (!mekBytesRef.current || mekBytesRef.current.length === 0)
      throw new Error("Cannot change password for a legacy vault. Please recreate your vault.");

    // Fetch the current wrapper so the old password is verified against the
    // KDF version this row actually stores, rather than the current default.
    const { data, error } = await vaultTable()
      .select("kdf_salt,kdf_iterations,enc_mek_ciphertext,vault_key_version")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error || !data) throw new Error("Vault metadata not found");
    const row = data as Pick<
      VaultMetadataRow,
      "kdf_salt" | "kdf_iterations" | "enc_mek_ciphertext" | "vault_key_version"
    >;
    if (!row.enc_mek_ciphertext)
      throw new Error("Legacy vault — recreate to enable password change.");

    // Verify old password using whichever KDF currently protects the MEK.
    const currentVersion = (row.vault_key_version ?? 1) as VaultKeyVersion;
    const currentStrategy =
      KEY_DERIVATION_STRATEGIES[currentVersion] ?? KEY_DERIVATION_STRATEGIES[1];
    try {
      await currentStrategy.unwrapMekWithPassword(
        row.enc_mek_ciphertext,
        currentPassword,
        row.kdf_salt,
      );
    } catch {
      throw new Error("Current vault password is incorrect");
    }

    // Opportunistic upgrade: every password change lands the vault on the
    // current best KDF. Fresh salt, current wrapper. kdf_iterations is not
    // read by Argon2id but the column stays populated for back-compat.
    const newSalt = randomBytesB64(16);
    const iterations = 600_000;
    const mekBytes = mekBytesRef.current;
    const newStrategy = KEY_DERIVATION_STRATEGIES[CURRENT_VAULT_KEY_VERSION];
    const newEncMek = await newStrategy.wrapMekWithPassword(
      mekBytes.buffer as ArrayBuffer,
      newPassword,
      newSalt,
    );

    // Recovery ciphertext is unaffected — MEK bytes don't change on password change.

    const { error: upErr } = await vaultTable()
      .update({
        kdf_salt: newSalt,
        kdf_iterations: iterations,
        enc_mek_ciphertext: newEncMek,
        vault_key_version: CURRENT_VAULT_KEY_VERSION,
      })
      .eq("user_id", user.id);
    if (upErr) throw new Error(upErr.message);
    setVaultKeyVersion(CURRENT_VAULT_KEY_VERSION);

    void logSecurityEvent(user.id, "vault_password_changed", {
      key_version: CURRENT_VAULT_KEY_VERSION,
    });

    // Phase 4.1: re-wrap the hybrid private key under the rotated salt.
    // The MEK bytes themselves are unchanged (password change does NOT
    // rotate the MEK — see HOUSEHOLD-SHARING-DESIGN.md §10), so this is
    // effectively a salt-rotation re-wrap. The HKDF subkey
    // derived from (mek, oldSalt) differs from (mek, newSalt), which
    // is why we still have to touch the column.
    //
    // Never let a keypair-row failure block the password change UX;
    // the user's data encryption still works, and we retry on the
    // next unlock via ensureUserKeypair.
    try {
      const oldMekForHkdf = await importMekForHkdf(mekBytes);
      const newMekForHkdf = await importMekForHkdf(mekBytes);
      await rewrapUserKeypair({
        userId: user.id,
        oldMek: oldMekForHkdf,
        newMek: newMekForHkdf,
        oldSaltB64: row.kdf_salt,
        newSaltB64: newSalt,
        supabase: supabase as unknown as SupabaseKeypairClient,
      });
    } catch (e) {
      console.warn("[vault] rewrapUserKeypair failed; will retry next unlock", e);
    }
  }, []);

  const regenerateRecoveryCode = useCallback(async (): Promise<string> => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");
    if (!mekBytesRef.current || mekBytesRef.current.length === 0)
      throw new Error("Vault must be unlocked (new architecture) to regenerate recovery code.");

    const newCode = await generateRecoveryCode();
    const wrapped = await wrapMekWithRecovery(mekBytesRef.current.buffer as ArrayBuffer, newCode);

    const { error } = await vaultTable()
      .update({ recovery_ciphertext: wrapped })
      .eq("user_id", user.id);
    if (error) throw new Error(error.message);

    void logSecurityEvent(user.id, "recovery_code_regenerated");

    return newCode;
  }, []);

  const recoverWithCode = useCallback(async (recoveryCode: string, newPassword: string) => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");

    // Also pull kdf_salt (old salt, needed to unwrap the existing
    // Phase 4.1 enc_private_key under HKDF(mek, oldSalt)) and
    // enc_private_key itself so we can re-wrap it under the post-recover
    // salt as part of the SAME atomic UPDATE below. Without this, the
    // salt rotation at the bottom of this function would invalidate the
    // Phase 4.1 keypair wrap and the user would lose household access
    // permanently on next unlock.
    const { data, error } = await vaultTable()
      .select(
        "kdf_salt,recovery_ciphertext,hmac_salt,enc_hmac_key,enc_private_key,enc_or_mek_ciphertext,or_subkey_salt,or_key_epoch",
      )
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data?.recovery_ciphertext) throw new Error("No recovery code on file");

    let mekBytes: Uint8Array;
    try {
      mekBytes = await unwrapMekWithRecovery(data.recovery_ciphertext, recoveryCode);
    } catch {
      throw new Error("Invalid recovery code");
    }

    const newSalt = randomBytesB64(16);
    const newHmacSalt = randomBytesB64(16);
    const iterations = 600_000;

    const mek = await importMekFromRaw(mekBytes);
    const freshVerifier = await cryptoEncryptText(VAULT_VERIFIER_PLAINTEXT, mek);
    // Recovery always promotes the vault to the current best KDF.
    const newStrategy = KEY_DERIVATION_STRATEGIES[CURRENT_VAULT_KEY_VERSION];
    const newEncMek = await newStrategy.wrapMekWithPassword(
      mekBytes.buffer as ArrayBuffer,
      newPassword,
      newSalt,
    );
    const freshRecovery = await wrapMekWithRecovery(mekBytes.buffer as ArrayBuffer, recoveryCode);

    let encHmacKey: string | undefined;
    let hmacKey: CryptoKey;
    if (data.enc_hmac_key) {
      // Keep existing HMAC key — MEK hasn't changed, so blind indexes stay valid.
      encHmacKey = data.enc_hmac_key;
      hmacKey = await decryptHmacKey(data.enc_hmac_key, mek);
    } else {
      // Legacy: create a new HMAC key.
      const { raw: hmacRaw, ciphertext } = await createEncryptedHmacKey(mek);
      encHmacKey = ciphertext;
      hmacKey = await crypto.subtle.importKey(
        "raw",
        hmacRaw as BufferSource,
        { name: "HMAC", hash: "SHA-256", length: 256 },
        false,
        ["sign"],
      );
    }

    // Re-wrap the Phase 4.1 hybrid private key under the rotated
    // salt. The MEK raw bytes are unchanged across recovery (recovery
    // only rotates the KEK that wraps the MEK, not the MEK itself) so
    // this is a pure salt-rotation re-wrap: HKDF(mek, oldSalt) →
    // HKDF(mek, newSalt). If unwrap under the old salt fails, we throw
    // BEFORE touching any persisted field — no half-state.
    //
    // Skipped when enc_private_key is null: a user may recover before
    // their first unlock ever generated a keypair. The next unlock's
    // ensureUserKeypair will generate one under the new salt.
    //
    // We deliberately inline the re-wrap (rather than calling
    // `rewrapUserKeypair`, which issues its own UPDATE) so the new
    // ciphertext ships in the SAME atomic UPDATE as kdf_salt and
    // verifier_ciphertext. Any separate-statement ordering leaves a
    // window where salt and enc_private_key disagree — exactly the bug
    // this fix is addressing.
    let newEncPrivateKey: string | undefined;
    if (data.enc_private_key) {
      const mekForHkdf = await importMekForHkdf(mekBytes);
      const oldWrapKey = await derivePqcSecretWrapKey(mekForHkdf, data.kdf_salt);
      const newWrapKey = await derivePqcSecretWrapKey(mekForHkdf, newSalt);
      const secretKeyB64 = await cryptoDecryptText(data.enc_private_key, oldWrapKey);
      newEncPrivateKey = await cryptoEncryptText(secretKeyB64, newWrapKey);
    }

    const updatePayload: Record<string, unknown> = {
      kdf_salt: newSalt,
      kdf_iterations: iterations,
      hmac_salt: newHmacSalt,
      verifier_ciphertext: freshVerifier,
      enc_mek_ciphertext: newEncMek,
      recovery_ciphertext: freshRecovery,
      enc_hmac_key: encHmacKey,
      vault_key_version: CURRENT_VAULT_KEY_VERSION,
    };
    // Only include enc_private_key in the payload when we had one to
    // re-wrap. Leaving the key out of the UPDATE preserves the existing
    // (null) column value for pre-first-unlock users.
    if (newEncPrivateKey !== undefined) {
      updatePayload.enc_private_key = newEncPrivateKey;
    }

    const { error: upErr } = await vaultTable()
      .update(updatePayload as Database["public"]["Tables"]["vault_metadata"]["Update"])
      .eq("user_id", user.id);
    if (upErr) throw new Error(upErr.message);

    // OrangeRails subkeys. THIS IS THE LINE THAT DESTROYED DATA (DL-1506): it
    // used newSalt, so recovery produced four different subkeys and every row
    // the customer had already synced stopped opening, silently, forever.
    // Recovery reaches the vault MEK through the recovery code, so anything
    // sealed under that MEK is reachable too, and the pinned material opens
    // exactly what it opened before. If nothing was pinned before the recovery
    // there is nothing to restore, and that is the honest outcome rather than
    // a fresh key pretending otherwise.
    const orMaterial = await resolveOrKeyMaterial({
      userId: user.id,
      password: newPassword,
      mek,
      row: {
        enc_or_mek_ciphertext: data.enc_or_mek_ciphertext ?? null,
        or_subkey_salt: data.or_subkey_salt ?? null,
        or_key_epoch: data.or_key_epoch ?? null,
      },
      kdfSalt: newSalt,
    });

    mekRef.current = mek;
    mekBytesRef.current = mekBytes;
    hmacRef.current = hmacKey;
    // The bundle is built here rather than at component scope so that these
    // callbacks keep an empty dependency array: a fresh object literal at
    // render time would make them, and every consumer memoised on them,
    // rebuild on every render.
    await applyOrKeyMaterial(
      orMaterial,
      {
        creds: orCredsKeyRef,
        txns: orTxnsKeyRef,
        opk: orOpkSeedRef,
        stealth: orStealthKeyBytesRef,
        disabledReason: orDisabledReasonRef,
      },
      setOrNamespaceDisabledReason,
    );
    kdfSaltRef.current = newSalt;
    setVaultKeyVersion(CURRENT_VAULT_KEY_VERSION);
    setIsUnlocked(true);

    void logSecurityEvent(user.id, "vault_recover", { key_version: CURRENT_VAULT_KEY_VERSION });
  }, []);

  const lock = useCallback(() => {
    // Zero raw key bytes BEFORE nulling the ref, so the underlying
    // Uint8Array memory is wiped instead of just GC-pending. Without this
    // a forensic memory snapshot taken after auto-lock can still recover
    // the MEK from the JS heap. Same treatment that signingKeysRef
    // already gets below.
    mekBytesRef.current?.fill(0);
    orOpkSeedRef.current?.fill(0);
    orStealthKeyBytesRef.current?.fill(0);
    mekRef.current = null;
    mekBytesRef.current = null;
    hmacRef.current = null;
    orCredsKeyRef.current = null;
    orTxnsKeyRef.current = null;
    orOpkSeedRef.current = null;
    orStealthKeyBytesRef.current = null;
    orDisabledReasonRef.current = null;
    setOrNamespaceDisabledReason(null);
    currentHouseholdRef.current = null;
    // Phase 4.4: clear HSK cache + retained salt on lock.
    kdfSaltRef.current = null;
    for (const handle of signingKeysRef.current.values()) {
      handle.privateKeyBytes.fill(0);
    }
    signingKeysRef.current.clear();
    setHouseholdSigningKeyAvailable(false);
    setIsUnlocked(false);
    // Intentionally keep vaultKeyVersion — it reflects on-disk state and
    // should remain visible in the locked settings screen.
  }, []);

  const encryptText = useCallback(async (plaintext: string) => {
    if (!mekRef.current) throw new Error("Vault is locked");
    return cryptoEncryptText(plaintext, mekRef.current);
  }, []);

  const decryptText = useCallback(async (ciphertext: string) => {
    if (!mekRef.current) throw new Error("Vault is locked");
    return cryptoDecryptText(ciphertext, mekRef.current);
  }, []);

  // ─── Phase 4.2: scope-aware encrypt / decrypt ─────────────────────────
  // Thin wrappers over scope-encryption.ts that inject the current MEK
  // and (optionally) household DEK. Existing `encryptText` / `decryptText`
  // call sites are untouched — migrating specific write paths to the
  // scoped API is per-feature work that belongs to Phase 4.3+.

  const encryptTextForScope = useCallback(
    async (plaintext: string, scope: Scope): Promise<string> => {
      if (!mekRef.current) throw new Error("Vault is locked");
      return encryptForScope(plaintext, scope, {
        personalMek: mekRef.current,
        householdDek: currentHouseholdRef.current?.dek ?? null,
      });
    },
    [],
  );

  const decryptTextForScope = useCallback(
    async (ciphertext: string, scope: Scope): Promise<string> => {
      if (!mekRef.current) throw new Error("Vault is locked");
      return decryptForScope(ciphertext, scope, {
        personalMek: mekRef.current,
        householdDek: currentHouseholdRef.current?.dek ?? null,
      });
    },
    [],
  );

  const hasActiveHousehold = useCallback((): boolean => {
    return currentHouseholdRef.current !== null;
  }, []);

  const encryptBlob = useCallback(async (plaintext: ArrayBuffer | Uint8Array) => {
    if (!mekRef.current) throw new Error("Vault is locked");
    return cryptoEncryptBlob(plaintext, mekRef.current);
  }, []);

  const decryptBlob = useCallback(async (ciphertext: Blob | ArrayBuffer) => {
    if (!mekRef.current) throw new Error("Vault is locked");
    return cryptoDecryptBlob(ciphertext, mekRef.current);
  }, []);

  const getHmacKey = useCallback(() => {
    if (!hmacRef.current) throw new Error("Vault is locked");
    return hmacRef.current;
  }, []);

  // ─── OrangeRails subkey helpers ───────────────────────────────────────
  // Encrypt/decrypt with ORK or ORT in the same AES-256-GCM format
  // as cryptoEncryptText/cryptoDecryptText (IV[12] + ciphertext, base64).

  const encryptOrCipher = useCallback(async (plaintext: string): Promise<string> => {
    assertOrAvailable(orDisabledReasonRef);
    if (!orCredsKeyRef.current) throw new Error("Vault is locked");
    return cryptoEncryptText(plaintext, orCredsKeyRef.current);
  }, []);

  const decryptOrCipher = useCallback(async (ciphertext: string): Promise<string> => {
    assertOrAvailable(orDisabledReasonRef);
    if (!orCredsKeyRef.current) throw new Error("Vault is locked");
    return cryptoDecryptText(ciphertext, orCredsKeyRef.current);
  }, []);

  const decryptOrTxnCipher = useCallback(async (ciphertext: string): Promise<string> => {
    assertOrAvailable(orDisabledReasonRef);
    if (!orTxnsKeyRef.current) throw new Error("Vault is locked");
    return cryptoDecryptText(ciphertext, orTxnsKeyRef.current);
  }, []);

  // Export raw key bytes as base64 for in-transit handoff to or-sync.
  // Both keys are extractable=true (set in deriveOr*KeyFromMek).
  //
  // Diagnostic fingerprint logging: log the first 8 hex chars of the
  // SHA-256 of the key. One-way hash — never reveals key bytes. Same key
  // produces the same fingerprint, so a setup-time vs sync-time mismatch
  // shows up immediately in the browser console. Different fingerprint
  // between connect and sync means the OR ciphertext stored under the
  // connect key cannot be decrypted with the sync key — most often
  // caused by a vault key-version upgrade between calls, a salt rotation,
  // or the wrong vault being unlocked.
  //
  // Prior implementation logged 16 base64 chars of the raw key directly —
  // about a third of the 32-byte key material was visible to any console
  // reader / browser extension / PostHog session recording.
  const exportOrCredsKey = useCallback(async (): Promise<string> => {
    assertOrAvailable(orDisabledReasonRef);
    if (!orCredsKeyRef.current) throw new Error("Vault is locked");
    const raw = await crypto.subtle.exportKey("raw", orCredsKeyRef.current);
    // DEV-only diagnostic. Fingerprint is one-way (8 hex of SHA-256) but
    // fires on every bank-connect; in prod it lands in session-replay /
    // analytics surfaces by accident. Gate behind import.meta.env.DEV so
    // the call literally doesn't execute in built bundles.
    if (import.meta.env.DEV) {
      console.log("[orangeway or-sync] credentialsKey fingerprint", await keyFingerprint(raw));
    }
    return arrayBufferToBase64(raw);
  }, []);

  const exportOrTxnsKey = useCallback(async (): Promise<string> => {
    assertOrAvailable(orDisabledReasonRef);
    if (!orTxnsKeyRef.current) throw new Error("Vault is locked");
    const raw = await crypto.subtle.exportKey("raw", orTxnsKeyRef.current);
    if (import.meta.env.DEV) {
      console.log("[orangeway or-sync] transactionsKey fingerprint", await keyFingerprint(raw));
    }
    return arrayBufferToBase64(raw);
  }, []);

  /**
   * The OR stealth widget subkey as base64, for the connect widget's opening
   * message.
   *
   * This is raw key material leaving this module, which is why it is a named
   * accessor rather than exposing the ref: the widget's contract accepts the
   * wrapping key only as base64, and the value is handed to the widget's own
   * origin over postMessage, never to a server and never over the network.
   * It is derived from the vault MEK under its own HKDF label, so it unlocks
   * nothing else we hold, and it exists only while the vault is unlocked.
   *
   * No fingerprint logging here, not even behind the DEV flag. The sibling
   * accessors log an 8 hex character one way fingerprint to debug key
   * mismatches; this key has no equivalent mismatch failure to chase, so the
   * value never reaches a console surface at all.
   */
  const exportOrStealthKeyB64 = useCallback(async (): Promise<string> => {
    assertOrAvailable(orDisabledReasonRef);
    const bytes = orStealthKeyBytesRef.current;
    if (!bytes) throw new Error("Vault is locked");
    return arrayBufferToBase64(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    );
  }, []);

  // OPK accessor — derives the X25519 sealed-box keypair from the current
  // unlock's seed. Public half registers on OR (subaccounts.opk_public);
  // OR seals background-synced bank transactions to it. Private half stays
  // here and unseals via crypto_box_seal_open. Lazily imports libsodium.
  const getOpkKeypair = useCallback(async (): Promise<OpkKeypair> => {
    assertOrAvailable(orDisabledReasonRef);
    if (!orOpkSeedRef.current) throw new Error("Vault is locked");
    return opkKeypairFromSeed(orOpkSeedRef.current);
  }, []);

  // ─── Phase 4.4: Household Signing Key (HSK / OSK) lifecycle ──────────
  //
  // Lazily unwraps the caller's HSK private half for a given household.
  // Cached for the unlocked session. Returns null when the caller has
  // no wrap (read-only role like Auditor) — that is a legitimate state
  // and is NOT an error.

  const loadHouseholdSigningKey = useCallback(
    async (householdId: string): Promise<OskHandle | null> => {
      if (!householdId) return null;
      const cached = signingKeysRef.current.get(householdId);
      if (cached) return cached;
      if (!mekBytesRef.current || mekBytesRef.current.length === 0) return null;
      if (!kdfSaltRef.current) return null;

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return null;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = supabase as any;

      // 1) Latest HSK wrap for this user in this household.
      const { data: wrapRow, error: wrapErr } = await db
        .from("household_member_osk_wraps")
        .select("wrapped_private_key, key_version, wrap_algo")
        .eq("user_id", user.id)
        .eq("household_id", householdId)
        .order("key_version", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (wrapErr) {
        console.warn("[vault] loadHouseholdSigningKey: wraps read failed", wrapErr);
        return null;
      }
      if (!wrapRow) {
        // Read-only role — no wrap. Not an error.
        return null;
      }

      // 2) User's hybrid keypair private bytes (encrypted in vault_metadata).
      const { data: pkRow, error: pkErr } = await db
        .from("vault_metadata")
        .select("enc_private_key")
        .eq("user_id", user.id)
        .maybeSingle();
      if (pkErr || !pkRow?.enc_private_key) {
        console.warn(
          "[vault] loadHouseholdSigningKey: vault_metadata.enc_private_key missing",
          pkErr,
        );
        return null;
      }

      try {
        const mekForHkdf = await importMekForHkdf(mekBytesRef.current);
        const wrapKey = await derivePqcSecretWrapKey(mekForHkdf, kdfSaltRef.current);
        const hybridPrivKeyB64 = await cryptoDecryptText(pkRow.enc_private_key, wrapKey);
        const hybridPrivKey = base64ToBytes(hybridPrivKeyB64);

        const privateKeyBytes = await unwrapHouseholdSigningKey(
          wrapRow.wrapped_private_key,
          hybridPrivKey,
        );
        const handle: OskHandle = {
          privateKeyBytes,
          keyVersion: wrapRow.key_version ?? 1,
        };
        signingKeysRef.current.set(householdId, handle);
        setHouseholdSigningKeyAvailable(true);
        return handle;
      } catch (err) {
        console.warn("[vault] loadHouseholdSigningKey: unwrap failed", err);
        return null;
      }
    },
    [],
  );

  const signRow = useCallback(
    (
      payloadBytes: Uint8Array,
      householdId: string,
    ): { signature_b64: string; key_version: number } | null => {
      const handle = signingKeysRef.current.get(householdId);
      if (!handle) return null;
      return oskSignMutation(payloadBytes, handle);
    },
    [],
  );

  const currentHouseholdId = useCallback((): string | null => {
    return currentHouseholdRef.current?.id ?? null;
  }, []);

  const buildHouseholdSignatureFields = useCallback((): {
    household_id: string | null;
    signature_b64: string | null;
    signature_key_version: number | null;
  } => {
    const householdId = currentHouseholdRef.current?.id ?? null;
    const handle = householdId ? (signingKeysRef.current.get(householdId) ?? null) : null;
    return buildSigFields(householdId, handle);
  }, []);

  // ─── Phase 4.4 first-time setup ──────────────────────────────────────
  //
  // After unlock, if the current user owns a household that doesn't yet
  // have a Household Signing Key minted, kick off the mint in the
  // background. Same "silent first-time setup" pattern as Phase 4.5
  // maybeKickOffFirstTimeHouseholdSetup.
  //
  // Non-fatal on any error — the Owner sees a manual "Sign your
  // account" button in Settings if this fails.
  useEffect(() => {
    if (!isUnlocked) return;
    // When the Phase 4.4 UI is gated off, also skip the silent
    // first-time HSK mint. Customers should not trigger any Phase 4.4
    // flow from the client until the real ML-DSA verifier ships server
    // side. signRow continues to return null in this state (legitimate
    // "no HSK yet" path that the verify trigger already tolerates).
    if (!featureFlags.phase44Public) return;
    let cancelled = false;
    void (async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user || cancelled) return;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = supabase as any;
        const { data: hh } = await db
          .from("households")
          .select("id")
          .eq("owner_id", user.id)
          .maybeSingle();
        const owned = (hh as { id: string } | null) ?? null;
        if (!owned || cancelled) return;

        const already = await householdHasSigningKey(owned.id);
        if (cancelled) return;
        if (already) {
          // Just try to load the existing wrap into cache so signRow works.
          await loadHouseholdSigningKey(owned.id);
          return;
        }

        // No HSK yet — mint one silently. Surface failures as console
        // warnings only; the Settings page renders a manual button as
        // the fallback.
        try {
          const result = await mintSigningKeyForHousehold(owned.id);
          if (cancelled) return;
          // Cache the freshly-minted private key for this session.
          signingKeysRef.current.set(owned.id, {
            privateKeyBytes: result.bundle.privateKeyBytes,
            keyVersion: result.bundle.keyVersion,
          });
          setHouseholdSigningKeyAvailable(true);
        } catch (e) {
          console.warn("[vault] first-time HSK mint failed; manual button in Settings", e);
        }
      } catch (e) {
        console.warn("[vault] first-time HSK setup probe failed", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isUnlocked, loadHouseholdSigningKey]);

  return (
    <VaultCtx.Provider
      value={{
        isUnlocked,
        loading,
        hasVault,
        vaultCheckError,
        vaultKeyVersion,
        orNamespaceDisabledReason,
        unlock,
        createVault,
        finalizeVaultSetup,
        lock,
        recoverWithCode,
        changeVaultPassword,
        regenerateRecoveryCode,
        encryptText,
        decryptText,
        encryptTextForScope,
        decryptTextForScope,
        hasActiveHousehold,
        encryptBlob,
        decryptBlob,
        getHmacKey,
        encryptOrCipher,
        decryptOrCipher,
        decryptOrTxnCipher,
        exportOrCredsKey,
        exportOrTxnsKey,
        exportOrStealthKeyB64,
        getOpkKeypair,
        householdSigningKeyAvailable,
        loadHouseholdSigningKey,
        signRow,
        currentHouseholdId,
        buildHouseholdSignatureFields,
      }}
    >
      {children}
    </VaultCtx.Provider>
  );
}

export function useVault() {
  const ctx = useContext(VaultCtx);
  if (!ctx) throw new Error("useVault must be used within VaultProvider");
  return ctx;
}
