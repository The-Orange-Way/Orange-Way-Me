/**
 * OWM-T0211. orImportBridge.ts's buildReconciliationMemo packs a real
 * Bitcoin txid into a transaction's memo as a line reading
 * "Txid: <64 hex chars>", alongside an optional preceding "Address: ..."
 * line. TransactionsList.tsx shows that memo as plain text; this is the
 * one place that line is parsed back out so the txid can link to a public
 * block explorer instead of staying inert.
 *
 * Matched against exactly 64 hex characters (32 bytes), which is what every
 * real Bitcoin txid is. A shorter or longer run is either a placeholder
 * value from a test fixture or not a txid at all, and either way must not
 * become a link to someone else's transaction.
 */
export function extractMemoTxid(memo: string): string | null {
  const match = memo.match(/(?:^|\n)Txid: ([0-9a-fA-F]{64})(?:\n|$)/);
  return match ? match[1] : null;
}

/**
 * mempool.space needs no API key and resolves both mainnet and, via its own
 * UI, unconfirmed transactions, which is why it is used here rather than a
 * provider that requires registration.
 */
export function blockExplorerUrl(txid: string): string {
  return `https://mempool.space/tx/${txid}`;
}
