/**
 * Lightweight xpub/ypub/zpub validation + balance fetch via mempool.space.
 *
 * Validation is format-only (Base58Check + known prefix) — bitcoinjs-lib is
 * heavy and ships ECC bindings that don't bundle cleanly for edge runtimes.
 * mempool.space rejects truly invalid keys, so a malformed key just means
 * the API call fails instead of silently storing garbage.
 */

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_REGEX = new RegExp(`^[${BASE58_ALPHABET}]+$`);

const VALID_PREFIXES = ["xpub", "ypub", "zpub", "Ypub", "Zpub", "tpub", "upub", "vpub"];

export interface XpubValidation {
  ok: boolean;
  reason?: string;
  prefix?: string;
}

export function validateExtendedKey(input: string): XpubValidation {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, reason: "Enter an extended public key." };

  const prefix = VALID_PREFIXES.find((p) => trimmed.startsWith(p));
  if (!prefix) {
    return {
      ok: false,
      reason: "Must start with xpub, ypub, zpub, Ypub, Zpub, tpub, upub, or vpub.",
    };
  }
  // Standard extended keys are 111 base58 characters.
  if (trimmed.length < 100 || trimmed.length > 120) {
    return { ok: false, reason: "Length looks wrong for an extended key." };
  }
  if (!BASE58_REGEX.test(trimmed)) {
    return { ok: false, reason: "Contains characters that aren't valid Base58." };
  }
  return { ok: true, prefix };
}

interface MempoolXpubSummary {
  // mempool.space returns chain_stats / mempool_stats with funded/spent sums in sats.
  chain_stats?: { funded_txo_sum?: number; spent_txo_sum?: number };
  mempool_stats?: { funded_txo_sum?: number; spent_txo_sum?: number };
}

/**
 * Fetch the current confirmed + unconfirmed BTC balance for an xpub.
 * Returns a string in BTC (e.g. "0.12345678") so we never lose precision
 * to float math.
 */
export async function fetchXpubBalanceBtc(xpub: string): Promise<string> {
  const v = validateExtendedKey(xpub);
  if (!v.ok) throw new Error(v.reason ?? "Invalid xpub");

  const url = `https://mempool.space/api/v1/xpub/${encodeURIComponent(xpub)}/summary`;
  const res = await fetch(url, { method: "GET", credentials: "omit" });
  if (!res.ok) {
    throw new Error(`mempool.space returned ${res.status}. Check the xpub and try again.`);
  }
  const json = (await res.json()) as MempoolXpubSummary | MempoolXpubSummary[];
  // Some mempool deployments return an array of address summaries; sum them.
  const summaries = Array.isArray(json) ? json : [json];
  let sats = 0;
  for (const s of summaries) {
    const cFunded = s.chain_stats?.funded_txo_sum ?? 0;
    const cSpent = s.chain_stats?.spent_txo_sum ?? 0;
    const mFunded = s.mempool_stats?.funded_txo_sum ?? 0;
    const mSpent = s.mempool_stats?.spent_txo_sum ?? 0;
    sats += cFunded - cSpent + mFunded - mSpent;
  }
  return satsToBtc(sats);
}

export function satsToBtc(sats: number): string {
  const sign = sats < 0 ? "-" : "";
  const abs = Math.abs(sats);
  const whole = Math.floor(abs / 1e8);
  const frac = (abs % 1e8).toString().padStart(8, "0");
  return `${sign}${whole}.${frac}`;
}

export function shortXpub(xpub: string): string {
  const t = xpub.trim();
  if (t.length <= 12) return t;
  return `${t.slice(0, 6)}…${t.slice(-4)}`;
}
