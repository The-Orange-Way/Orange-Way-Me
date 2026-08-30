/**
 * The ONE inventory of wallet key-material field names in this repository.
 *
 * Consumed by src/lib/observability/__tests__/key-material-scrub-parity.test.ts,
 * which uses it to hold two properties that neither scrubber can state about
 * itself:
 *
 *   1. BOTH telemetry scrubbers redact every name in this list. Sentry lives in
 *      sentry.ts (SECRET_KEY_PATTERNS, reached through isSecretKey) and PostHog
 *      lives in posthog-scrubber.ts (SCRUB_VALUE_KEY_HINTS plus
 *      SCRUB_VALUE_KEY_PATTERNS, reached through scrubPostHogEvent).
 *
 *   2. Every key-material-looking column in the generated Supabase types is
 *      covered by some entry here. Add a column called wallet_mnemonic_backup
 *      to the schema, regenerate types, and the test fails until this list
 *      names it.
 *
 * The entries are matched as LOWERCASE SUBSTRINGS of a field name, because that
 * is how both scrubbers actually behave for these names: "wallet_seed_backup"
 * is covered by "seed". Two entries are deliberately NOT substring-matched by
 * the scrubbers and are noted below.
 */

/**
 * Wallet key material, and the two generic names both scrubbers already carry.
 *
 * Ordering is by class, not alphabetical, so a reader can see what is here.
 */
export const KEY_MATERIAL_FIELDS = [
  // BIP39 recovery material. "seed" covers seed, wallet_seed, seed_phrase.
  // "mnemonic" is NOT covered by any other entry and was uncovered by BOTH
  // scrubbers before this change.
  "mnemonic",
  "seed",
  "entropy",
  "passphrase",

  // BIP32 extended keys. The serialization prefix is literally "xprv", so a
  // list carrying only the spelled-out "xpriv" would miss the real field name.
  "xpriv",
  "xprv",
  "xpub",

  // Local unlock material. Both are matched by the scrubbers as WHOLE WORDS,
  // not as bare substrings, because a bare "pin" also matches shipping_address
  // and spinner_state, and a bare "salt" also matches basalt. See the anchored
  // patterns in posthog-scrubber.ts and sentry.ts.
  "pin",
  "salt",

  // Key-derivation and protocol inputs.
  "nonce",
  "mek",
  "opk",

  // Named keys this product actually has.
  "or_stealth_key",
  "stealth_key",
  "cred_key",
  "txn_key",
  "private_key",
  "vault_key",

  // The two generic names both scrubbers already redact on a bare substring.
  // They are listed so that a column such as encryption_key_id counts as
  // covered, which is true: both lists redact anything containing "key".
  "key",
  "secret",
] as const;

/**
 * Field-name tokens that make a column LOOK like key material. A column name is
 * a candidate when any underscore-separated token is in this set.
 *
 * Token equality, not substring: "shipping_address" must not be a candidate
 * because it happens to contain the letters p, i, n in order. The point of the
 * ratchet is that a real key-material column cannot slip in unnoticed, and a
 * ratchet that fires on half the schema gets switched off within a week.
 */
const KEY_MATERIAL_TOKENS = new Set([
  "mnemonic",
  "seed",
  "entropy",
  "passphrase",
  "pin",
  "salt",
  "nonce",
  "xpriv",
  "xprv",
  "xpub",
  "mek",
  "opk",
  "key",
  "keys",
  "privkey",
  "secret",
  "secrets",
]);

/**
 * Pull every property name out of a generated Supabase types file.
 *
 * The generated file declares each column as an indented property, so this
 * matches an indented lowercase identifier followed by an optional "?" and a
 * colon. Type names are PascalCase and are excluded by the leading [a-z].
 *
 * Returns names WITHOUT deduplication order guarantees; the caller sorts.
 * A caller that gets an implausibly small list should treat that as a parse
 * failure rather than as a clean result: see the count assertion in the test.
 */
export function extractColumnNames(source: string): string[] {
  const out = new Set<string>();
  const re = /^[ \t]+([a-z][a-z0-9_]*)\??:/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    out.add(m[1]);
  }
  return [...out].sort();
}

/** True when a field name has a token that makes it key-material-looking. */
export function looksLikeKeyMaterial(name: string): boolean {
  return name
    .toLowerCase()
    .split("_")
    .some((token) => KEY_MATERIAL_TOKENS.has(token));
}

/** Every key-material-looking column name in a generated types file. */
export function keyMaterialColumns(source: string): string[] {
  return extractColumnNames(source).filter(looksLikeKeyMaterial);
}

/**
 * The names in `columns` that NO entry of `inventory` covers.
 *
 * Coverage is substring containment, which is what the scrubbers do. Passing
 * the inventory in rather than closing over it is what lets the test prove this
 * check can FAIL, with a deliberately incomplete inventory as the control.
 */
export function uncoveredByInventory(
  columns: readonly string[],
  inventory: readonly string[],
): string[] {
  return columns.filter((c) => !inventory.some((f) => c.toLowerCase().includes(f)));
}
