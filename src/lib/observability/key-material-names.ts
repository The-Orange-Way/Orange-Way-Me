/**
 * The one inventory of wallet key-material field names in this repository.
 *
 * This is the SPECIFICATION both telemetry scrubbers must satisfy, not the
 * only code either of them runs. The analytics client (`posthog-scrubber.ts`)
 * calls isKeyMaterialFieldName directly. The error reporter (`sentry.ts`)
 * does NOT import this module: it keeps SECRET_KEY_PATTERNS, because anchored
 * regexes are the right mechanism there for the reason given under WHAT DOES
 * NOT below. What holds the two together is
 * __tests__/key-material-scrub-parity.test.ts, which asks BOTH scrubbers
 * about every name here and fails when either one misses.
 *
 * So the drift this module exists to stop is stopped by the test, not by a
 * single shared call. That matters when you edit either scrubber: the compiler
 * will not tell you that Sentry has stopped covering a name in this list. The
 * test will.
 *
 * Correcting the record, because this comment said the opposite until
 * 2026-09-15 and someone will have read it: it claimed both scrubbers read
 * this module and that neither kept its own copy. Neither half was ever true,
 * including on the branch that introduced this file. sentry.ts never imported
 * it, and both scrubbers still carry their own lists.
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
  // Key-derivation input. A salt does not reveal a key on its own, but it
  // removes work from anyone holding the ciphertext, and it has no
  // debugging value, so there is nothing to trade away by blanking it.
  //
  // Kept as a plain substring rather than anchored like "pin" below,
  // because both scrubbers already match it that way and narrowing an
  // existing redaction can only ever send MORE to a vendor. The cost is
  // known and accepted: a property named basalt_theme is blanked too. See
  // the over-match case in __tests__/key-material-scrub-parity.test.ts.
  "salt",
  // "nonce" IS NOT IN THIS LIST, on purpose, and this note is here so it
  // does not get added back as an obvious omission.
  //
  // A nonce is not a secret. In AEAD it travels in the clear next to the
  // ciphertext, so blanking it buys no confidentiality. Meanwhile this list
  // is the spec BOTH scrubbers must satisfy, and requiring the error
  // reporter to blank every nonce would break CSP violation debugging,
  // where the nonce is the whole point of the report. posthog-scrubber.ts
  // recorded that exact trade in its own comments before this module
  // existed: redacting a nonce in analytics costs nothing, and the same
  // trade "would NOT be acceptable in sentry.ts".
  //
  // So the analytics client still blanks nonces, through its own
  // SCRUB_VALUE_KEY_HINTS. Nothing is sent that was not sent before. What
  // changed on 2026-09-15 is only that the shared spec stopped asserting
  // something one of its two implementers had already decided against, and
  // that the parity test stopped failing for a reason that was not a leak.
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
