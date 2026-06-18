/**
 * Scope-aware encryption routing — Phase 4.2.
 *
 * Routes encrypt/decrypt calls to the correct key based on each row's
 * `scope` column:
 *
 *   'personal'    → user's personal MEK (existing solo behavior).
 *   'household'   → household DEK if the user has one; else fall back to
 *                   personal MEK and warn.
 *   'author_only' → personal MEK (per roadmap, the author-only re-wrap
 *                   primitive is a v1.5 feature — for now we simply route
 *                   to the personal MEK so the data shape is stable; see
 *                   HOUSEHOLD-SHARING-DESIGN.md §2 "Transactions" row).
 *
 * Design references:
 *   docs/HOUSEHOLD-SHARING-DESIGN.md §2 (sharing boundary), §3 (schema)
 *
 * This module is deliberately UI-free and state-free — callers pass the
 * keys they already hold (typically inside VaultContext). That keeps
 * the routing functions unit-testable in isolation without standing up
 * a React tree.
 *
 * Helper `unwrapHouseholdDek` is a small wrapper around the Phase 4.0
 * `KEY_WRAP_STRATEGIES['hybrid-x25519-mlkem768']` strategy: the
 * producer side (household Owner wraps the DEK for each member) lands
 * in Phase 4.3's invite flow; we only ship the consumer here so
 * existing wraps can be opened at unlock time once 4.3 arrives.
 */

import { decryptText as cryptoDecryptText, encryptText as cryptoEncryptText } from "./vault";
import { KEY_WRAP_STRATEGIES, DEFAULT_WRAP_ALGORITHM, base64ToBytes } from "./key-wrapping";

// ---------------------------------------------------------------------------
// Scope vocabulary. Matches the CHECK constraint on shared tables.
// ---------------------------------------------------------------------------

/**
 * Row-level scope column values. Extend deliberately — adding a new
 * scope requires a migration (CHECK update) AND an explicit routing
 * decision in encryptForScope/decryptForScope.
 */
export type Scope = "personal" | "household" | "author_only";

// ---------------------------------------------------------------------------
// Key bag passed to the routing functions.
// ---------------------------------------------------------------------------

/**
 * The set of keys a caller holds when performing a scoped
 * encrypt/decrypt. The personal MEK is always required (there is no
 * code path in v1 where we can operate without it). The household DEK
 * is optional — solo users do not have one, and routing must fall back
 * gracefully.
 */
export interface ScopeKeyBag {
  /** Personal MEK — the AES-GCM CryptoKey already used by encryptText / decryptText. */
  personalMek: CryptoKey;
  /** Household DEK if the user has an active membership with a successfully unwrapped wrap; else null. */
  householdDek: CryptoKey | null;
}

// ---------------------------------------------------------------------------
// Internal — pick the right AES key for a given scope.
// ---------------------------------------------------------------------------

/**
 * Resolve which AES key to use for a given scope.
 *
 * Returns the personal MEK with a `fellBack: true` flag when the caller
 * asked for the household DEK but none is available — callers can use
 * this to emit a console warning without duplicating the routing
 * decision.
 */
function resolveKey(scope: Scope, keys: ScopeKeyBag): { key: CryptoKey; fellBack: boolean } {
  switch (scope) {
    case "personal":
      return { key: keys.personalMek, fellBack: false };
    case "household":
      if (keys.householdDek) {
        return { key: keys.householdDek, fellBack: false };
      }
      // Solo user (no household membership yet) or wrap-unwrap failure.
      // Fall back to the personal MEK so the write still lands somewhere
      // the user can decrypt later. The caller logs the fallback.
      return { key: keys.personalMek, fellBack: true };
    case "author_only":
      // TODO(v1.5): author-only re-wrap. Use a per-row author key
      // derived from the author's personal MEK (or a fresh subkey)
      // instead of the MEK itself, and exclude the household DEK from
      // the wrap set. For 4.2 we route to the personal MEK so the
      // ciphertext is private to the author's vault. See
      // HOUSEHOLD-SHARING-DESIGN.md §3 "scope = 'author_only'".
      return { key: keys.personalMek, fellBack: false };
    default: {
      // Exhaustiveness — if a new scope is added to the type without
      // updating this switch, TypeScript will flag the assignment.
      const unreachable: never = scope;
      throw new Error(`unknown scope: ${String(unreachable)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Public API — scope-aware encrypt / decrypt.
// ---------------------------------------------------------------------------

/**
 * Encrypt plaintext under the key implied by `scope`.
 *
 * Fallback behavior: if `scope === 'household'` but no household DEK is
 * present in the key bag, the ciphertext is produced with the user's
 * personal MEK and a `console.warn` fires. The row remains readable by
 * the user (solo round-trip) but is NOT sharable. Callers that need
 * to block this path should gate the write behind
 * `hasActiveHousehold()` in VaultContext.
 */
export async function encryptForScope(
  plaintext: string,
  scope: Scope,
  keys: ScopeKeyBag,
): Promise<string> {
  const { key, fellBack } = resolveKey(scope, keys);
  if (fellBack) {
    console.warn(
      "[scope-encryption] encrypting household-scoped data with personal MEK " +
        "(no household DEK available). Row will not be shareable until the user " +
        "joins / creates a household.",
    );
  }
  return cryptoEncryptText(plaintext, key);
}

/**
 * Decrypt ciphertext that was written under the key implied by `scope`.
 *
 * Same fallback as `encryptForScope`: if the scope is 'household' but
 * no DEK is available, we attempt decryption with the personal MEK.
 * That will succeed iff the ciphertext was produced during the same
 * fallback path (solo user) and fail otherwise — which is the correct
 * outcome: a real household-scoped row cannot be decrypted without the
 * DEK, so throwing out of cryptoDecryptText is the expected signal.
 */
export async function decryptForScope(
  ciphertext: string,
  scope: Scope,
  keys: ScopeKeyBag,
): Promise<string> {
  const { key, fellBack } = resolveKey(scope, keys);
  if (fellBack) {
    console.warn(
      "[scope-encryption] decrypting household-scoped row with personal MEK " +
        "(no household DEK available). Expect failure if this row was written " +
        "by another household member.",
    );
  }
  return cryptoDecryptText(ciphertext, key);
}

// ---------------------------------------------------------------------------
// Household DEK unwrap — consumer side.
// ---------------------------------------------------------------------------

/**
 * Unwrap the household DEK using the user's hybrid KEM private key.
 *
 * Format of `wrappedDekB64` matches the output of
 * `wrapForRecipient` in `key-wrapping.ts`:
 *
 *   base64( kem_ct[1120] || iv[12] || aes_gcm_ct[48] )
 *
 * Returns a non-extractable AES-GCM CryptoKey ready to hand to
 * `encryptForScope` / `decryptForScope`.
 *
 * Throws if the wrap is malformed, the user's secret key is the wrong
 * length, or AEAD verification fails. Callers MUST catch — a bad wrap
 * at unlock time must not block the user from accessing personal data.
 */
export async function unwrapHouseholdDek(
  privateKeyBytes: Uint8Array,
  wrappedDekB64: string,
): Promise<CryptoKey> {
  const strategy = KEY_WRAP_STRATEGIES[DEFAULT_WRAP_ALGORITHM];
  const wrapped = base64ToBytes(wrappedDekB64);
  const rawDek = await strategy.unwrapForSelf(wrapped, privateKeyBytes);
  return globalThis.crypto.subtle.importKey(
    "raw",
    rawDek as BufferSource,
    { name: "AES-GCM" },
    /* extractable */ false,
    ["encrypt", "decrypt"],
  );
}
