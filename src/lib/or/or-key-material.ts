/**
 * Deciding where the Orange Rails key material comes from (DL-1506).
 *
 * The defect this exists to close. The four Orange Rails subkeys are derived
 * from the vault password and `vault_metadata.kdf_salt`. Changing a vault
 * password regenerates that salt, so all four subkeys change, and every row
 * sealed under the previous ones can never be opened again by anyone,
 * including us. Recovery does the same for the same reason. The rows survive;
 * the key does not.
 *
 * The fix is not to re-encrypt anything. It is to stop re-deriving a key we
 * already have. The Orange Rails MEK keeps its CURRENT value and gets stored
 * wrapped under the vault MEK, which is a random key that is wrapped rather
 * than derived and therefore already survives a password change and is already
 * recoverable from the recovery code. Because the value does not change, no
 * sealed row anywhere needs touching.
 *
 * This is not a new idea in this codebase. `enc_hmac_key` does exactly this,
 * and says why in its own comment: it decouples the HMAC key from the vault
 * password so blind indexes stay valid after a password change. That
 * decoupling was simply never applied to the Orange Rails namespace.
 *
 * Two things must be pinned, not one. The subkeys take the salt as an HKDF
 * salt-context, so pinning the MEK while letting the salt rotate would still
 * move all four keys. `or_subkey_salt` pins the salt that was in force when
 * the material was established.
 *
 * This module is pure and holds no crypto. It answers only "derive, unwrap, or
 * refuse", so that the rule can be tested without WebCrypto and without a
 * vault. The caller performs whichever of the three it is told.
 */

/**
 * The generation of the pinned Orange Rails key material this build writes and
 * understands.
 *
 * Why a number and not a boolean "is pinned". The pinned pair is a contract
 * between whatever sealed the rows and whatever opens them, and the one
 * failure this whole change exists to remove is a client confidently using key
 * material whose meaning has moved underneath it. A version makes that
 * detectable rather than silent: a client that meets an epoch it does not know
 * refuses, instead of unwrapping bytes that are no longer what it assumes.
 *
 * Bump this ONLY when the meaning of the pinned pair changes, never for an
 * unrelated schema change. Bumping it makes every older client refuse, which
 * is correct on a genuine format change and gratuitous otherwise.
 */
export const CURRENT_OR_KEY_EPOCH = 1;

/** The stored state, as read from `vault_metadata`. */
export interface OrKeyMaterialRow {
  /** Orange Rails MEK sealed under the vault MEK. Null until established. */
  enc_or_mek_ciphertext: string | null;
  /** The kdf_salt in force when the above was established. Null until then. */
  or_subkey_salt: string | null;
  /**
   * Generation of the pinned pair. Null until established.
   *
   * Typed to admit a string as well as a number, which is a statement about
   * the transport rather than about the column. PostgREST returns a Postgres
   * `numeric` as a JSON string and only the integer types as a JSON number.
   * The migration declares this column `integer`, so it arrives as a number
   * today, but a module whose whole job is to refuse rather than guess must
   * not silently read a string as "nothing is pinned": that is the
   * derive-and-pin path, and taking it against a pinned row is the exact
   * silent destruction this file exists to prevent.
   */
  or_key_epoch: number | string | null;
}

export type OrKeyMaterialPlan =
  | {
      /**
       * Nothing is pinned yet. Derive the legacy value exactly as before and
       * pin it. This is correct only at a moment when the password and the
       * current salt still produce the value that existing rows were sealed
       * under, which means an unlock or a vault creation.
       */
      mode: "derive-and-pin";
      saltContext: string;
      epoch: number;
    }
  | {
      /** Pinned. Use it, and never mind what the password or kdf_salt now are. */
      mode: "unwrap";
      ciphertext: string;
      saltContext: string;
    }
  | {
      /**
       * The stored state cannot be used. The caller must NOT fall back to
       * deriving: after a rotation, deriving produces a key that opens nothing
       * while looking exactly like success, which is the original defect.
       *
       * The caller also must not fail the unlock over this. The customer's
       * vault is not in question here, only the Orange Rails namespace, and
       * locking someone out of their own finances is a worse outcome than the
       * bug being fixed. The namespace is disabled and said so, loudly.
       */
      mode: "refuse";
      reason: string;
    };

/**
 * Read the stored generation, returning null for anything that is not one.
 *
 * Two things this does that a bare `typeof x === "number" && isFinite(x)`
 * did not.
 *
 * A fractional value is not a generation. `Number.isFinite(1.5)` is true, so
 * 1.5 used to read as a present generation and was then refused as unknown,
 * which describes a format mismatch when what actually happened is a corrupt
 * value. Treating it as absent routes it to the half-stored refusal instead,
 * which is the honest description of the row.
 *
 * A string is read rather than ignored. See the note on `or_key_epoch` above:
 * treating a transported number as absent would send a pinned row down
 * derive-and-pin, which destroys history silently. This is a cheap contract
 * that does not depend on a column type this module cannot see.
 */
function readEpoch(value: number | string | null | undefined): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    const parsed = Number(trimmed);
    return Number.isInteger(parsed) ? parsed : null;
  }
  return null;
}

export interface PlanOrKeyMaterialOptions {
  /**
   * Whether `kdfSalt` is still the salt that already-sealed rows were sealed
   * under.
   *
   * True on an unlock or a vault creation: the salt in force is the salt the
   * existing rows were written against, so deriving reproduces the same key.
   *
   * False during recovery, which mints a NEW salt before it gets here.
   * Deriving against that salt produces 32 bytes with no relationship to the
   * old ones, and pinning them makes the loss permanent. Recovery also cannot
   * repair the row, because reproducing the old key needs the OLD password and
   * recovery by definition does not have it. So refusing is not a policy
   * preference, it is the only outcome that is not a lie.
   *
   * REQUIRED, with no default. It was optional and defaulted to true, and a
   * caller computing it from a lookup produces exactly `boolean | undefined`,
   * so an undefined slipped through the type system and landed on
   * derive-and-pin. Silence is not a claim that the salt is unchanged, so this
   * is now the caller's statement to make, or the answer is a refusal.
   */
  saltMatchesExistingRows: boolean;
}

/**
 * Decide, from what is stored, how to obtain the Orange Rails key material.
 *
 * The half-established cases are refusals rather than repairs on purpose. One
 * column without the others means something wrote a partial state, and the two
 * possible repairs (derive a fresh key, or reuse the current salt) both
 * silently produce a key that opens nothing if the salt has since rotated.
 * Guessing here is how a data-loss bug hides itself for months; refusing is
 * visible on the first attempt.
 *
 * @param row       what `vault_metadata` holds for this user
 * @param kdfSalt   the salt in force right now, used only when pinning
 * @param options   see `PlanOrKeyMaterialOptions`; required, no default
 */
export function planOrKeyMaterial(
  row: OrKeyMaterialRow,
  kdfSalt: string,
  options: PlanOrKeyMaterialOptions,
): OrKeyMaterialPlan {
  // Read defensively for exactly the reason `options?.` is read defensively
  // further down. The parameter is required in the type, so a nullish row is
  // unreachable from typed code, and the callers this guard exists for are
  // the ones that lost their types at a boundary. A row is nullish when the
  // read that should have produced it did not: a denied row, an aborted
  // request, a lookup that matched nothing. Without this guard every one of
  // those becomes a TypeError on the first property access, which turns a
  // diagnosable answer into a crash.
  //
  // Worded apart from the half-stored refusal below on purpose. That one
  // means the row was READ and found incomplete, and the first move is to
  // look at the columns. This one means the row never arrived, and the first
  // move is to look at access and at the request. Two failures that need
  // different first moves must not share a sentence.
  if ((row as OrKeyMaterialRow | null | undefined) == null) {
    return {
      mode: "refuse",
      reason:
        "Orange Rails key material could not be read for this account, so what is stored is unknown and deriving now could produce a key that opens nothing.",
    };
  }

  const hasCiphertext =
    typeof row.enc_or_mek_ciphertext === "string" && row.enc_or_mek_ciphertext.length > 0;
  const hasSalt = typeof row.or_subkey_salt === "string" && row.or_subkey_salt.length > 0;
  const epoch = readEpoch(row.or_key_epoch);
  const hasEpoch = epoch !== null;

  if (hasCiphertext && hasSalt && epoch !== null) {
    if (epoch !== CURRENT_OR_KEY_EPOCH) {
      // Deliberately refuses in BOTH directions. A newer epoch means this
      // build is the stale one and must not guess at a format it predates. An
      // older epoch means a migration exists that has not been written, and
      // treating the material as current would be assuming the migration was a
      // no-op.
      return {
        mode: "refuse",
        reason: `Orange Rails key material is generation ${epoch} and this app understands generation ${CURRENT_OR_KEY_EPOCH}.`,
      };
    }
    return {
      mode: "unwrap",
      ciphertext: row.enc_or_mek_ciphertext as string,
      saltContext: row.or_subkey_salt as string,
    };
  }

  const anyPresent = hasCiphertext || hasSalt || hasEpoch;
  if (anyPresent) {
    const missing = [
      hasCiphertext ? null : "the sealed key",
      hasSalt ? null : "its salt",
      hasEpoch ? null : "its generation",
    ].filter((x): x is string => x !== null);
    return {
      mode: "refuse",
      reason: `Orange Rails key material is partly stored: ${missing.join(" and ")} missing, so the subkeys cannot be reproduced.`,
    };
  }

  if (typeof kdfSalt !== "string" || kdfSalt.length === 0) {
    return {
      mode: "refuse",
      reason: "No vault salt is available to pin Orange Rails key material against.",
    };
  }

  // Read through an optional chain deliberately. The option is required in the
  // type, so this is unreachable from typed code, but the callers this guard
  // exists for are exactly the ones that lost their types at a boundary, and
  // one of those shapes is omitting the argument entirely. Without the chain
  // that caller gets a TypeError instead of a refusal, which turns a
  // diagnosable answer back into a crash.
  const stated = options?.saltMatchesExistingRows;

  if (stated === false) {
    // Nothing is pinned AND the salt just rotated.
    // Deriving here is what silently destroyed history: it yields a well
    // formed key, pins it as authoritative, reports success, and every row the
    // customer already synced stops opening forever with nothing on screen to
    // say so.
    return {
      mode: "refuse",
      reason:
        "Orange Rails key material was never pinned for this account and the vault salt has just changed, so the key that opened existing rows cannot be reproduced. Anything synced before this point needs a re-sync.",
    };
  }

  if (stated !== true) {
    // Reached only from a caller that lost its types at a boundary, because
    // the option is required. It is kept as a runtime guard rather than left
    // to the compiler because the cost of the two outcomes is not symmetric:
    // a wrong refusal disables one namespace for one session, and a wrong
    // derivation permanently orphans everything the customer has already
    // synced. Silence is not a claim that the salt is unchanged.
    return {
      mode: "refuse",
      reason:
        "Orange Rails key material was never pinned for this account and the caller did not state whether the vault salt still matches the rows already sealed, so deriving now could produce a key that opens none of them.",
    };
  }

  return { mode: "derive-and-pin", saltContext: kdfSalt, epoch: CURRENT_OR_KEY_EPOCH };
}

/**
 * Thrown by the Orange Rails accessors when the vault IS unlocked but the
 * Orange Rails namespace is not usable (DL-1506).
 *
 * A named class rather than a message convention because the caller's correct
 * response differs completely from the other failure in this area. "Vault is
 * locked" means ask for the password. This means the password will not help,
 * so a surface should disable itself and say why. Matching on message text
 * would make every consumer depend on wording that a copy edit can break, and
 * a broad catch would swallow real errors, which is exactly what a banner
 * built on one must not do.
 */
export class OrNamespaceDisabledError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`Orange Rails is unavailable in this session: ${reason}`);
    this.name = "OrNamespaceDisabledError";
    this.reason = reason;
    // Required for `instanceof` to survive the ES5 downlevel target.
    Object.setPrototypeOf(this, OrNamespaceDisabledError.prototype);
  }
}
