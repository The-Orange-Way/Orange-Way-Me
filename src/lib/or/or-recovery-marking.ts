/**
 * Deciding whether a vault_metadata row must be MARKED as having had no
 * Orange Rails material before a recovery, and whether an unlock is seeing a
 * row that was left half-established (DEV-0049 / DL-2266, OWM-T0242).
 *
 * WHY THIS IS A MODULE AND NOT A BLOCK INSIDE recoverWithCode / unlock.
 *
 * Both call sites read the same three columns -- enc_or_mek_ciphertext,
 * or_subkey_salt, or_key_epoch -- and decide from them, one to build an
 * UPDATE payload, the other to build an assertion passed to
 * planOrKeyMaterial. Inline, each was a boolean expression that only code
 * review could compare against the other, and neither could be exercised by
 * a test without driving the whole recovery or unlock function. Extracting
 * them mirrors computeOrPinColumns: pulling the ordering-sensitive
 * arithmetic out of a function that also does I/O and crypto, so the rule
 * itself can be asserted directly.
 *
 * This module is pure and holds no crypto and no I/O, unlike
 * computeOrPinColumns.
 */

import type { OrKeyMaterialRow } from "./or-key-material";

/** The three columns both call sites read before deciding how to treat the row. */
export type OrMarkingSourceRow = Pick<
  OrKeyMaterialRow,
  "enc_or_mek_ciphertext" | "or_subkey_salt" | "or_key_epoch"
>;

/**
 * True when the row carries NONE of the three Orange Rails columns: no MEK
 * ciphertext, no pinned salt, no epoch. This is the shape of a vault that has
 * never had Orange Rails material established at all.
 */
export function isFullyUnpinned(row: OrMarkingSourceRow): boolean {
  return !row.enc_or_mek_ciphertext && !row.or_subkey_salt && row.or_key_epoch == null;
}

/**
 * What recoverWithCode should merge into its UPDATE payload for this row, or
 * null when there is nothing to mark.
 *
 * Only a fully unpinned row gets marked, because only that row is about to
 * lose its only record of "no material yet" once kdf_salt rotates under it.
 * A row that is already half-established -- or_subkey_salt present,
 * enc_or_mek_ciphertext still null, the exact shape a prior unmarked
 * recovery left behind -- is NOT re-marked: isFullyUnpinned is false for it
 * because or_subkey_salt is already set, so this returns null and the
 * existing pin salt is left untouched rather than overwritten with the
 * salt from THIS recovery. A fully pinned row is null for the same reason.
 */
export function recoveryOrMarking(
  row: OrMarkingSourceRow,
  oldSalt: string,
): { or_subkey_salt: string } | null {
  return isFullyUnpinned(row) ? { or_subkey_salt: oldSalt } : null;
}

/**
 * True when something rotated kdf_salt while the Orange Rails material sat
 * unpinned: or_subkey_salt is present (a pin was recorded) but
 * enc_or_mek_ciphertext is not (the MEK itself never was). recoveryOrMarking
 * above exists to stop new rows from reaching this shape; a row that is
 * already in it -- from before the paired fix, or from any other path that
 * rotates the salt -- must not have its current salt treated by unlock as
 * "safe to derive and pin against". planOrKeyMaterial already refuses this
 * row shape unconditionally on its own; this only makes the assertion
 * unlock passes to it honest rather than changing behaviour for this case.
 */
export function saltRotatedWhileUnpinned(row: OrMarkingSourceRow): boolean {
  return Boolean(row.or_subkey_salt) && !row.enc_or_mek_ciphertext;
}
