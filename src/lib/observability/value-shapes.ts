/**
 * Shared value-shape redaction, imported by BOTH telemetry scrubbers.
 *
 * The key-name lists in posthog-scrubber.ts and sentry.ts answer the
 * question "is this property called something dangerous". They cannot
 * answer "is this VALUE dangerous", which is the case where a callsite
 * puts sensitive content under an innocuous name:
 *
 *   posthog.capture("wallet_import_failed", { step: "decode", detail: xpub })
 *   new Error(`sync failed for ${xpub}`)
 *
 * These patterns run over free-form strings on both products so neither
 * path depends on the callsite having named the property well.
 *
 * This lives in ONE module on purpose. The two key-name lists it
 * complements have already drifted apart once, and a value-shape rule
 * that only one product enforces is worse than none, because it reads as
 * covered.
 *
 * DELIBERATELY NOT HERE: a BIP39 mnemonic word-list matcher. Twelve
 * common English words in a row is a shape ordinary prose can reach, and
 * a false positive eats an error message we needed to debug. The shapes
 * below are prefix-anchored, so a false positive is effectively
 * impossible.
 */

/** What a matched value is replaced with. Distinct from "[redacted]" so a
 *  reader of an event can tell a key-name hit from a value-shape hit. */
export const VALUE_SHAPE_REDACTED = "[redacted-key-shape]";

/**
 * BIP32 extended keys, public and private, mainnet and testnet:
 * xpub/xprv, ypub/yprv, zpub/zprv (SLIP-132 wrapped-segwit and native
 * segwit), tpub/tprv, upub/uprv, vpub/vprv (testnet).
 *
 * Body is base58check, which excludes 0 O I l. A real extended key is
 * 111 characters; 50 is a floor that cannot be reached by prose.
 */
const EXTENDED_KEY_RE =
  /\b(?:xpub|xprv|ypub|yprv|zpub|zprv|tpub|tprv|upub|uprv|vpub|vprv)[1-9A-HJ-NP-Za-km-z]{50,}/g;

export const VALUE_SHAPE_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [EXTENDED_KEY_RE, VALUE_SHAPE_REDACTED],
];

/**
 * Replace every sensitive-shaped substring in `input`. Returns the input
 * unchanged when nothing matches, so it is safe to run over every string
 * on the way to the network.
 */
export function redactValueShapes(input: string): string {
  let out = input;
  for (const [re, repl] of VALUE_SHAPE_PATTERNS) {
    // Explicit reset: these RegExp objects are module-level and /g, and
    // a caller reaching for .test() elsewhere would leave lastIndex set.
    re.lastIndex = 0;
    out = out.replace(re, repl);
  }
  return out;
}
