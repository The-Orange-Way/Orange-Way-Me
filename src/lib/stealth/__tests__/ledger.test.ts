/**
 * DL-1116. These cover the two things that made stealth transactions
 * invisible on our side, and one thing that is not settled yet.
 *
 * The wire-shape tests were written before Orange Rails finalised how stealth
 * rows come back (their DL-1174). That has now landed, and the real shape was
 * neither of the two guessed at: a separate endpoint whose rows carry NO
 * connection id and whose envelope is split rather than concatenated. The
 * `orRowsForConnection` tests are kept as-is because that function still owns
 * the non-stealth response; the new block at the bottom covers the real
 * stealth shape, and the first test in it is the trap that would otherwise
 * have made this whole change a no-op.
 */

import { describe, expect, it } from "vitest";

import {
  STEALTH_WALLET_CURRENCY,
  STEALTH_WALLET_FALLBACK_LABEL,
  orRowsForConnection,
  sealedRecordToCipherB64,
  stealthPageFromResponse,
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

/* -------------------------------------------------------------------------
 * The real DL-1174 shape.
 * ------------------------------------------------------------------------- */

/** A 12-byte IV and a short ciphertext, as base64, matching the real framing. */
const IV_B64 = btoa("\x00\x01\x02\x03\x04\x05\x06\x07\x08\x09\x0a\x0b");
const CT_B64 = btoa("sealed-bytes");

function sealed(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    algorithm: "AES-256-GCM",
    iv_b64: IV_B64,
    ciphertext_b64: CT_B64,
    ...overrides,
  };
}

function stealthRow(id: string, blockHeight = 800000, overrides: Record<string, unknown> = {}) {
  return {
    id,
    sealed_record: sealed(),
    occurred_at: "2026-08-01T00:00:00.000Z",
    block_height: blockHeight,
    txid_blind_index_hex: "a".repeat(64),
    ...overrides,
  };
}

describe("stealthPageFromResponse", () => {
  it("reads rows that carry no connection_id of their own", () => {
    // THE TRAP. The endpoint puts the connection id at the top level and the
    // rows do not repeat it. `orRowsForConnection` filters on the row field,
    // so routing this response through it returns [] -- indistinguishable
    // from an empty wallet, which is exactly the reported bug. If this test
    // ever goes red because someone consolidated the two readers, the bug is
    // back and it will not announce itself in production.
    const res = { connection_id: CONN, transactions: [stealthRow("t1"), stealthRow("t2", 799999)] };

    expect(orRowsForConnection(res, CONN)).toEqual([]);
    expect(stealthPageFromResponse(res, CONN).rows.map((r) => r.id)).toEqual(["t1", "t2"]);
  });

  it("refuses a response for a different connection", () => {
    // A mismatched id means we are holding someone else's page. Importing it
    // would attribute another wallet's history to this one, which is worse
    // than showing nothing.
    const res = { connection_id: OTHER_CONN, transactions: [stealthRow("t1")] };
    expect(stealthPageFromResponse(res, CONN).rows).toEqual([]);
  });

  it("returns an empty page for malformed input instead of throwing", () => {
    for (const bad of [null, undefined, 42, "nope", {}, { connection_id: CONN }]) {
      const page = stealthPageFromResponse(bad, CONN);
      expect(page.rows).toEqual([]);
      expect(page.hasMore).toBe(false);
    }
  });

  it("skips a row sealed under an envelope version it does not understand", () => {
    // Decrypting a future envelope under today's framing assumptions either
    // throws or authenticates against the wrong bytes. Leaving the row out and
    // letting `total` disagree with the row count is the honest outcome.
    const res = {
      connection_id: CONN,
      total: 2,
      transactions: [
        stealthRow("ok"),
        stealthRow("future", 799998, { sealed_record: sealed({ version: 2 }) }),
      ],
    };
    const page = stealthPageFromResponse(res, CONN);
    expect(page.rows.map((r) => r.id)).toEqual(["ok"]);
    expect(page.total).toBe(2);
    expect(page.skipped).toBe(1);
  });

  it("still reports a skipped row when the server omits total", () => {
    // The case that made the previous "the count mismatch shows" claim false.
    // With no server `total`, total used to be derived from the SURVIVING
    // rows, so it agreed with rows.length by construction and the dropped row
    // left no trace anywhere. Two things now prevent that: total falls back to
    // the DELIVERED length, and the skip is counted outright.
    const res = {
      connection_id: CONN,
      transactions: [
        stealthRow("ok"),
        stealthRow("future", 799998, { sealed_record: sealed({ version: 2 }) }),
      ],
    };
    const page = stealthPageFromResponse(res, CONN);
    expect(page.rows.map((r) => r.id)).toEqual(["ok"]);
    expect(page.skipped).toBe(1);
    expect(page.total).toBe(2);
    // The load-bearing assertion: the two must NOT agree, or the page looks
    // complete while a row is missing.
    expect(page.total).not.toBe(page.rows.length);
  });

  it("does not count a de-duplicated row as skipped", () => {
    // A duplicate is collapsed, not lost, so nothing is missing from the
    // customer's view and it must not inflate the "you are not seeing
    // everything" signal.
    const page = stealthPageFromResponse(
      { connection_id: CONN, transactions: [stealthRow("dup"), stealthRow("dup")] },
      CONN,
    );
    expect(page.rows).toHaveLength(1);
    expect(page.skipped).toBe(0);
  });

  it("counts a structurally malformed entry as skipped", () => {
    const page = stealthPageFromResponse(
      { connection_id: CONN, transactions: [stealthRow("ok"), null, {}, { id: "no-record" }] },
      CONN,
    );
    expect(page.rows.map((r) => r.id)).toEqual(["ok"]);
    expect(page.skipped).toBe(3);
    expect(page.total).toBe(4);
  });

  it("reports zero skipped on a clean page", () => {
    const page = stealthPageFromResponse(
      { connection_id: CONN, transactions: [stealthRow("a"), stealthRow("b", 799999)] },
      CONN,
    );
    expect(page.skipped).toBe(0);
    expect(page.total).toBe(2);
  });

  it("skips a row whose algorithm is not the one we can open", () => {
    const res = {
      connection_id: CONN,
      transactions: [
        stealthRow("x", 800000, { sealed_record: sealed({ algorithm: "ChaCha20-Poly1305" }) }),
      ],
    };
    const page = stealthPageFromResponse(res, CONN);
    expect(page.rows).toEqual([]);
    expect(page.skipped).toBe(1);
  });

  it("de-duplicates by row id", () => {
    const res = { connection_id: CONN, transactions: [stealthRow("dup"), stealthRow("dup")] };
    expect(stealthPageFromResponse(res, CONN).rows).toHaveLength(1);
  });

  it("reports hasMore only when a usable two-half cursor came with it", () => {
    const base = { connection_id: CONN, transactions: [stealthRow("t1")], has_more: true };

    // No cursor at all: a caller that trusted has_more here would re-request
    // page one forever.
    expect(stealthPageFromResponse({ ...base, next_cursor: null }, CONN).hasMore).toBe(false);

    // Half a cursor is not a cursor. block_height is not unique, so a
    // height-only cursor silently drops the rest of a block at a page edge.
    expect(
      stealthPageFromResponse({ ...base, next_cursor: { before_block: 800000 } }, CONN).hasMore,
    ).toBe(false);

    const good = stealthPageFromResponse(
      {
        ...base,
        next_cursor: { before_block: 800000, before_txid_blind_index_hex: "b".repeat(64) },
      },
      CONN,
    );
    expect(good.hasMore).toBe(true);
    expect(good.nextCursor).toEqual({
      before_block: 800000,
      before_txid_blind_index_hex: "b".repeat(64),
    });
  });

  it("does not claim more pages when the server says there are none", () => {
    const res = {
      connection_id: CONN,
      transactions: [stealthRow("t1")],
      has_more: false,
      total: 1,
    };
    expect(stealthPageFromResponse(res, CONN).hasMore).toBe(false);
  });
});

describe("sealedRecordToCipherB64", () => {
  it("reframes split iv/ciphertext into the concatenated form decryptText expects", () => {
    // decryptText slices the first 12 bytes off as the IV and treats the rest
    // as ciphertext+tag. Assert on that split rather than on a magic string,
    // so the test still means something if the fixture changes.
    const out = sealedRecordToCipherB64(sealed());
    const raw = atob(out);
    expect(raw.slice(0, 12)).toBe(atob(IV_B64));
    expect(raw.slice(12)).toBe(atob(CT_B64));
  });

  it("throws rather than handing back something that fails later as an opaque decrypt error", () => {
    expect(() => sealedRecordToCipherB64(sealed({ version: 9 }) as never)).toThrow();
    expect(() => sealedRecordToCipherB64(sealed({ iv_b64: btoa("short") }) as never)).toThrow(
      /IV length/,
    );
  });
});
