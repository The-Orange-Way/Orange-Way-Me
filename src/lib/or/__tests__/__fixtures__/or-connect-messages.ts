/**
 * Real cross-origin message payloads posted by OR's hosted /connect widget.
 *
 * These are PINNED FROM THE SENDER, not invented by the tests that import
 * them. The whole point of DL-1114: a frame-parser test that asserts a shape
 * the test made up stays green even when the real sender changes, which is
 * worse than no test because it reads as coverage.
 *
 * Provenance (Orange Rails, the party that posts these messages):
 *   - or-link-success: posted from the /connect route on completion. The
 *     stealth path posts an empty source_wallets array; the wallet path posts
 *     one entry per selected wallet, shaped { id, external_wallet_id,
 *     currency, label }. Documented in OR's Consumer Integration Guide.
 *   - or-link-cancel: posted when the user cancels.
 *   - OR_QUILTT_LINK_COMPLETE: posted from the /connect/quiltt route. Carries
 *     quilttConnectionId (which the sender may set to null), plus orConnectionId
 *     and orSubaccountId.
 *
 * If OR changes any of these shapes, update this fixture from the sender and
 * let the contract guards in the sibling *.test.ts files flag the drift. Do
 * not edit a consumer to match a shape invented here.
 */

/** or-link-success, wallet path: one or more selected source wallets. */
export const OR_LINK_SUCCESS = {
  type: "or-link-success",
  connection_id: "conn_9f3a2b",
  subaccount_id: "sub_4c1d7e",
  source_wallets: [
    {
      id: "sw_1a2b3c",
      external_wallet_id: "ext_wallet_77",
      currency: "BTC",
      label: "Cold storage",
    },
  ],
} as const;

/** or-link-success, stealth path: source_wallets is present but empty. */
export const OR_LINK_SUCCESS_STEALTH = {
  type: "or-link-success",
  connection_id: "conn_stealth_01",
  subaccount_id: "sub_stealth_01",
  source_wallets: [],
} as const;

/** or-link-cancel: the user closed the widget without completing. */
export const OR_LINK_CANCEL = {
  type: "or-link-cancel",
} as const;

/** OR_QUILTT_LINK_COMPLETE: bank link finished, ids carried back to the app. */
export const OR_QUILTT_LINK_COMPLETE = {
  type: "OR_QUILTT_LINK_COMPLETE",
  quilttConnectionId: "quiltt_conn_abc",
  orConnectionId: "conn_or_123",
  orSubaccountId: "sub_or_123",
} as const;

/**
 * OR_QUILTT_LINK_COMPLETE with a null quilttConnectionId. The sender posts
 * `quilttConnectionId ?? null`, so null is on the wire. Pinned because the
 * app's BankLinkComplete type declares this field as a plain string, a gap
 * the inline literal (always a non-null string) could never surface.
 */
export const OR_QUILTT_LINK_COMPLETE_NULL_CONN = {
  type: "OR_QUILTT_LINK_COMPLETE",
  quilttConnectionId: null,
  orConnectionId: "conn_or_123",
  orSubaccountId: "sub_or_123",
} as const;
