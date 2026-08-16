/**
 * DL-1116. These cover the two things that made stealth transactions
 * invisible on our side, and one thing that is not settled yet.
 *
 * The wire-shape tests exist because Orange Rails has NOT finalised how
 * stealth rows come back (their DL-1174). Their CTO ruled the read path is
 * fixed additively and that stealth rows are not concatenated into
 * `transactions`, so both the shape that exists today and the separate-array
 * shape are asserted here. When the real shape lands, the test that fails is
 * the specification of what changed.
 */

import { describe, expect, it } from "vitest";

import {
  STEALTH_WALLET_CURRENCY,
  STEALTH_WALLET_FALLBACK_LABEL,
  orRowsForConnection,
  stealthSourceWalletId,
  withStealthSourceWallet,
  withStealthSourceWalletId,
} from "../ledger";

// Fixture ids only. Never paste a real connection id into a test in a public
// repo: it is a live identifier from someone's account and the diff keeps it
// forever.
const CONN = "conn-stealth-0001";
const OTHER_CONN = "conn-other-0002";

function row(id: string, connectionId: string) {
  return {
    id,
    connection_id: connectionId,
    external_id: `ext-${id}`,
    encrypted_payload: "sealed",
    occurred_at: "2026-01-01T00:00:00.000Z",
  };
}

describe("withStealthSourceWallet", () => {
  it("gives a stealth connection exactly one wallet when it has none", () => {
    const wallets = withStealthSourceWallet({ id: CONN, is_stealth: true }, []);
    expect(wallets).toHaveLength(1);
    expect(wallets[0].external_wallet_id).toBe(CONN);
    expect(wallets[0].currency).toBe(STEALTH_WALLET_CURRENCY);
  });

  it("marks the synthetic wallet synced, or the mapping dialog filters it away", () => {
    const [wallet] = withStealthSourceWallet({ id: CONN, is_stealth: true }, []);
    expect(wallet.is_synced).toBe(true);
  });

  it("uses the connection's own label when it has one", () => {
    const [wallet] = withStealthSourceWallet(
      { id: CONN, is_stealth: true, decrypted_label: "  Cold storage  " },
      [],
    );
    expect(wallet.label).toBe("Cold storage");
  });

  it("falls back to a generic label rather than showing an empty chip", () => {
    const [wallet] = withStealthSourceWallet(
      { id: CONN, is_stealth: true, decrypted_label: "   " },
      [],
    );
    expect(wallet.label).toBe(STEALTH_WALLET_FALLBACK_LABEL);
  });

  it("leaves a non-stealth connection alone, including when it has no wallets", () => {
    expect(withStealthSourceWallet({ id: CONN, is_stealth: false }, [])).toEqual([]);
    expect(withStealthSourceWallet({ id: CONN }, [])).toEqual([]);
  });

  it("yields to real wallets if Orange Rails ever returns them for a stealth row", () => {
    const real = [
      {
        id: "w1",
        external_wallet_id: "or-wallet-1",
        is_synced: true,
        currency: "BTC",
        label: "theirs",
      },
    ];
    expect(withStealthSourceWallet({ id: CONN, is_stealth: true }, real)).toBe(real);
  });
});

describe("withStealthSourceWalletId", () => {
  it("routes an untagged stealth row to the synthetic wallet", () => {
    const tagged = withStealthSourceWalletId({ source_wallet_id: null }, CONN, true);
    expect(tagged.source_wallet_id).toBe(stealthSourceWalletId(CONN));
  });

  it("never overwrites a tag Orange Rails did send", () => {
    const tagged = withStealthSourceWalletId({ source_wallet_id: "theirs" }, CONN, true);
    expect(tagged.source_wallet_id).toBe("theirs");
  });

  it("leaves a non-stealth untagged row untagged, so the bridge still skips it", () => {
    const tagged = withStealthSourceWalletId({ source_wallet_id: null }, CONN, false);
    expect(tagged.source_wallet_id).toBeNull();
  });
});

describe("orRowsForConnection", () => {
  it("reads the shape that exists today", () => {
    const res = { transactions: [row("a", CONN), row("b", OTHER_CONN)] };
    expect(orRowsForConnection(res, CONN).map((r) => r.id)).toEqual(["a"]);
  });

  it("reads a separate stealth array, which is one of the shapes Orange Rails may ship", () => {
    const res = { transactions: [row("a", OTHER_CONN)], stealth_transactions: [row("s", CONN)] };
    expect(orRowsForConnection(res, CONN).map((r) => r.id)).toEqual(["s"]);
  });

  it("reads both arrays when both carry rows for the connection", () => {
    const res = { transactions: [row("a", CONN)], stealth_transactions: [row("s", CONN)] };
    expect(orRowsForConnection(res, CONN).map((r) => r.id)).toEqual(["a", "s"]);
  });

  it("does not double-import a row echoed into both arrays", () => {
    const res = { transactions: [row("a", CONN)], stealth_transactions: [row("a", CONN)] };
    expect(orRowsForConnection(res, CONN)).toHaveLength(1);
  });

  it("ignores an unrecognised array rather than guessing it holds transactions", () => {
    const res = { some_future_array: [row("x", CONN)] };
    expect(orRowsForConnection(res, CONN)).toEqual([]);
  });

  it("returns empty for a malformed response instead of throwing", () => {
    expect(orRowsForConnection(null, CONN)).toEqual([]);
    expect(orRowsForConnection("nope", CONN)).toEqual([]);
    expect(orRowsForConnection({ transactions: "nope" }, CONN)).toEqual([]);
    expect(orRowsForConnection({}, CONN)).toEqual([]);
  });
});
