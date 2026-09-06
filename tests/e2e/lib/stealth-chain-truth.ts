import { HDKey } from "@scure/bip32";
import * as btc from "@scure/btc-signer";
import bs58check from "bs58check";

/**
 * Independent chain-truth helper for OWM-T0617 / OWM-E0008 acceptance 1a.
 *
 * This derives receive and change addresses from a watch-only extended
 * public key and asks mempool.space (a public block explorer, not any
 * Orange Way or Orange Rails surface) which of them have on-chain history.
 * It never touches our own database. It is the "source of truth that is
 * not our own ledger" the epic's acceptance criterion asks for.
 *
 * DERIVATION PARITY WITH PRODUCTION. The version-byte table and the
 * per-script-type payment construction below are copied from Orange
 * Rails' own xpub connector so this derives addresses exactly the way
 * the system under test derives them:
 *   - supabase/functions/_shared/providers/xpub/canonical.ts (VERSION_TABLE,
 *     the xpub/ypub/zpub -> script-type mapping and the version-byte
 *     rewrite that lets @scure/bip32 parse a non-xpub-prefixed key)
 *   - supabase/functions/_shared/providers/xpub/index.ts (deriveAddress,
 *     scanChain, default gap_limit of 20)
 * Read on the orangerails repo at ref chore/dl-0544-risk-tiered-merge,
 * 2026-09-06. Re-check these constants if that code changes shape.
 *
 * PRIVACY. The extended public key is used ONLY in this Node process to
 * do local elliptic-curve math. It is never sent to mempool.space or any
 * other network endpoint. Only derived addresses, one at a time, are
 * looked up. Taproot (p2tr) is deliberately NOT implemented here: Orange
 * Rails' own suite has BIP86 test vectors this module has not been
 * checked against, so a p2tr xpub throws rather than silently deriving
 * addresses nobody has verified.
 */

export type ScriptType = "p2pkh" | "p2sh-p2wpkh" | "p2wpkh";

const XPUB_VERSION = Uint8Array.from([0x04, 0x88, 0xb2, 0x1e]);

// hex(version bytes) -> script type. Source: Orange Rails canonical.ts
// VERSION_TABLE, see module doc comment above.
const SLIP132_VERSIONS: Record<string, ScriptType> = {
  "0488b21e": "p2pkh", // xpub
  "049d7cb2": "p2sh-p2wpkh", // ypub
  "04b24746": "p2wpkh", // zpub
};

export interface ParsedExtendedKey {
  hdRoot: HDKey;
  scriptType: ScriptType;
}

/**
 * Rewrites an SLIP-132 extended public key's version bytes to standard
 * xpub bytes so @scure/bip32 can parse it, and reports the script type
 * implied by the ORIGINAL prefix (or the override, if the caller wants
 * to force p2wpkh on an xpub-prefixed BIP84 key).
 */
export function parseExtendedKey(extendedKey: string, scriptTypeOverride?: ScriptType): ParsedExtendedKey {
  const decoded = bs58check.decode(extendedKey);
  const versionBytes = decoded.subarray(0, 4);
  const versionHex = Buffer.from(versionBytes).toString("hex");
  const detected = SLIP132_VERSIONS[versionHex];
  if (!detected) {
    throw new Error(
      `unrecognized extended-key version bytes 0x${versionHex}. Supported: xpub, ypub, zpub. ` +
        `(tpub/upub/vpub testnet keys and p2tr xpubs are not supported by this helper.)`,
    );
  }

  const rewritten = new Uint8Array(decoded.length);
  rewritten.set(XPUB_VERSION, 0);
  rewritten.set(decoded.subarray(4), 4);
  const canonicalXpub = bs58check.encode(Buffer.from(rewritten));

  const hdRoot = HDKey.fromExtendedKey(canonicalXpub);
  return { hdRoot, scriptType: scriptTypeOverride ?? detected };
}

/** m/chain/index, non-hardened, matching Orange Rails' deriveAddress. */
export function deriveAddress(hdRoot: HDKey, chain: 0 | 1, index: number, scriptType: ScriptType): string {
  const child = hdRoot.deriveChild(chain).deriveChild(index);
  if (!child.publicKey) {
    throw new Error(`no public key derived at chain ${chain} index ${index}`);
  }

  let payment: { address?: string };
  switch (scriptType) {
    case "p2pkh":
      payment = btc.p2pkh(child.publicKey);
      break;
    case "p2wpkh":
      payment = btc.p2wpkh(child.publicKey);
      break;
    case "p2sh-p2wpkh":
      payment = btc.p2sh(btc.p2wpkh(child.publicKey));
      break;
    default:
      throw new Error(`unsupported script type: ${scriptType satisfies never}`);
  }

  if (!payment.address) {
    throw new Error(`no address produced for script type ${scriptType} at chain ${chain} index ${index}`);
  }
  return payment.address;
}

const MEMPOOL_API = "https://mempool.space/api";

/**
 * All txids touching one address, confirmed and unconfirmed, paginated.
 * Never sends the xpub, only the single derived address.
 */
export async function fetchAddressTxids(address: string): Promise<string[]> {
  const txids: string[] = [];
  let lastSeenTxid: string | undefined;

  for (;;) {
    const url = lastSeenTxid
      ? `${MEMPOOL_API}/address/${address}/txs/chain/${lastSeenTxid}`
      : `${MEMPOOL_API}/address/${address}/txs`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`mempool.space returned ${res.status} for address ${address}`);
    }
    const page: Array<{ txid: string }> = await res.json();
    if (page.length === 0) break;
    txids.push(...page.map((t) => t.txid));
    lastSeenTxid = page[page.length - 1].txid;
  }

  return txids;
}

export interface ChainScanResult {
  usedAddresses: string[];
  txids: Set<string>;
}

/**
 * Scans receive (chain 0) and change (chain 1) addresses with the same
 * gap-limit convention Orange Rails' scanner uses (default 20 consecutive
 * empty addresses ends that chain). Returns the union of distinct txids
 * across every used address, because a transaction touching two of our
 * own addresses (e.g. a payment plus its change) must count once, not
 * twice, in the on-chain transaction count.
 */
export async function scanWalletTxids(
  hdRoot: HDKey,
  scriptType: ScriptType,
  gapLimit = 20,
): Promise<ChainScanResult> {
  const allTxids = new Set<string>();
  const usedAddresses: string[] = [];

  for (const chain of [0, 1] as const) {
    let consecutiveEmpty = 0;
    let index = 0;
    while (consecutiveEmpty < gapLimit) {
      const address = deriveAddress(hdRoot, chain, index, scriptType);
      const txids = await fetchAddressTxids(address);
      if (txids.length === 0) {
        consecutiveEmpty += 1;
      } else {
        consecutiveEmpty = 0;
        usedAddresses.push(address);
        for (const t of txids) allTxids.add(t);
      }
      index += 1;
    }
  }

  return { usedAddresses, txids: allTxids };
}
