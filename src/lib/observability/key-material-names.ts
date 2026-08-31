/**
 * The one inventory of wallet key-material field names in this repository.
 *
 * Both telemetry scrubbers read this module: the error reporter
 * (`sentry.ts`) and the analytics client (`posthog-scrubber.ts`). Neither
 * keeps its own copy of these names any more, because two hand-written
 * lists drift and a drifted pair is worse than a short list: the same
 * property gets blanked on one path and sent in the clear on the other,
 * and nothing in either file shows you the difference.
 *
 * WHAT BELONGS HERE: wallet key material, key-derivation inputs, and the
 * secrets a person types or writes down.
 *
 * WHAT DOES NOT: business data. The analytics client deliberately blanks
 * broad things like "account" and "name"; the error reporter deliberately
 * anchors its business-data patterns instead, because it is the tool a
 * maintainer debugs a live incident with, and blanking every property
 * whose name merely contains "name" or "token" would degrade incident
 * response silently. Those vendor-specific lists stay in their own files.
 *
 * TWO MATCHING RULES, AND THE CHOICE IS MADE PER NAME:
 *
 *   KEY_MATERIAL_SUBSTRINGS matches anywhere in a lowercased key. A name
 *   belongs here only when it is long and specific enough that an
 *   incidental match on an ordinary word is implausible.
 *
 *   KEY_MATERIAL_PATTERNS matches as an anchored expression. A name
 *   belongs here when the bare substring would fire on ordinary words,
 *   and the reason is written next to it.
 */

/** Matched anywhere in a lowercased property key. */
export const KEY_MATERIAL_SUBSTRINGS: readonly string[] = [
  // Any key of any kind. Deliberately broad, and it is the reason this
  // list does not have to enumerate every spelling: wrapped_private_key,
  // dek_key_version, or_stealth_key_b64 and cred_key_b64 all match here.
  "key",
  // Recovery-phrase material and the words this codebase uses for it.
  "seed",
  "mnemonic",
  "entropy",
  // Extended keys. The public one is included on purpose: an extended
  // public key reveals every address in the account and therefore the
  // whole balance history, which is exactly the thing the product
  // promises the server cannot see.
  "xpub",
  "xpriv",
  "xprv",
  // Key-derivation inputs. A salt or a nonce does not reveal a key on its
  // own, but it removes work from anyone holding the ciphertext, and it
  // has no analytics or debugging value at all, so there is nothing to
  // trade away by blanking it.
  "salt",
  "nonce",
  // Vault key material, by the names used for it in this codebase.
  "mek",
  "opk",
  // Secrets a person types, is shown once, or writes down.
  "secret",
  "password",
  "passphrase",
  "recovery",
];

/** Matched as anchored expressions against a lowercased property key. */
export const KEY_MATERIAL_PATTERNS: readonly RegExp[] = [
  // "pin" as a bare substring fires on ordinary words: shipping, spinner,
  // pinned. Anchored to a whole underscore-separated word it still covers
  // pin, wallet_pin, pin_hash and user_pin, and leaves shipping_address
  // alone. Note the error reporter's own list has carried an unanchored
  // /pin/i since before this module existed. That over-match is left in
  // place on purpose: narrowing an existing redaction is a change that
  // can only ever send MORE data to a vendor, so it is not something to
  // slip into a commit whose point is to send less. It is worth a
  // separate look, not a silent widening here.
  /(^|_)pin(_|$)/i,
];

/**
 * True when a property key names wallet key material and must never reach
 * a telemetry vendor in the clear. Both scrubbers call this.
 */
export function isKeyMaterialFieldName(name: string): boolean {
  const k = name.toLowerCase();
  if (KEY_MATERIAL_SUBSTRINGS.some((hint) => k.includes(hint))) return true;
  return KEY_MATERIAL_PATTERNS.some((pattern) => pattern.test(k));
}

/**
 * Detector for a key-material COLUMN name in the generated database types.
 *
 * Deliberately narrower than the matching rules above. It anchors on whole
 * underscore-separated words so that columns which are merely sensitive
 * (recovery_ciphertext, verifier_ciphertext, quiltt_session_token) are not
 * swept in here: those are covered by the vendor lists on the analytics
 * side, and forcing them into this shared inventory would push broad
 * business-data substrings into the error reporter, which is the exact
 * thing this file exists to avoid.
 */
export const KEY_MATERIAL_COLUMN_RE =
  /(^|_)(key|keys|seed|seeds|secret|passphrase|mnemonic|entropy|salt|nonce|pin|mek|opk|xpub|xpriv|xprv|privkey)(_|$)/;

/**
 * Every concrete key-material field name known to this repository.
 *
 * The companion test asserts two things about this list, and both of them
 * fail loudly rather than quietly:
 *   1. both scrubbers redact every name in it;
 *   2. every column in the generated database types that the detector
 *      above calls key material appears in it. Add such a column without
 *      adding the name here and the build goes red.
 *
 * Column entries verified against src/integrations/supabase/types.ts.
 */
export const KEY_MATERIAL_FIELD_NAMES: readonly string[] = [
  // Columns in the generated database types.
  "dek_key_version",
  "signature_key_version",
  "encrypted_metadata_key_version",
  "wrapped_private_key",
  "enc_private_key",
  "enc_mek_ciphertext",
  "enc_or_mek_ciphertext",
  "hmac_salt",
  "kdf_salt",
  "or_subkey_salt",
  // Client-side names that never became columns. They travel through
  // application state and error payloads, which is precisely why a
  // schema-derived list on its own would have missed them.
  "or_stealth_key_b64",
  "stealth_key",
  "cred_key_b64",
  "xpub",
  "xpriv",
  "xprv",
  "seed",
  "mnemonic",
  "entropy",
  "passphrase",
  "pin",
  "nonce",
  "secret",
  "mek",
  "opk",
];
