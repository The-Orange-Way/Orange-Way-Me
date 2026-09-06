import { describe, expect, it } from "vitest";
import { nextTransactionsPage } from "./transactions-page";

function row(id: string, occurredAt: string) {
  return {
    id,
    connection_id: "conn-1",
    external_id: id,
    encrypted_payload: "cipher",
    occurred_at: occurredAt,
  };
}

describe("nextTransactionsPage", () => {
  it("stops on a short page: nothing asked for was withheld", () => {
    const response = {
      transactions: [row("a", "2026-01-03T00:00:00Z")],
      truncated: false,
      next_before: null,
    };
    const page = nextTransactionsPage(response, 500);
    expect(page.rows).toHaveLength(1);
    expect(page.hasMore).toBe(false);
    expect(page.nextBefore).toBeNull();
  });

  it("stops on an empty page", () => {
    const page = nextTransactionsPage(
      { transactions: [], truncated: false, next_before: null },
      500,
    );
    expect(page.hasMore).toBe(false);
    expect(page.nextBefore).toBeNull();
  });

  it("a full untruncated page may not be everything (the OWM-T0722 case)", () => {
    // 500 held rows, requested in pages of 3: the first page comes back
    // exactly 3 long with truncated:false, which is exactly what a
    // long-history account looked like before this change. A one-call
    // reader stopped here and silently dropped everything below it.
    const rows = [
      row("r0", "2026-01-03T00:00:00Z"),
      row("r1", "2026-01-02T00:00:00Z"),
      row("r2", "2026-01-01T00:00:00Z"),
    ];
    const page = nextTransactionsPage(
      { transactions: rows, truncated: false, next_before: null },
      3,
    );
    expect(page.rows).toHaveLength(3);
    expect(page.hasMore).toBe(true);
    expect(page.nextBefore).toBe("2026-01-01T00:00:00Z");
  });

  it("truncated/next_before wins over the page-size heuristic", () => {
    // Only 1 row delivered even though the request asked for 500: OR's byte
    // cap cut the response short. truncated + next_before must win even
    // though rows.length (1) is far short of requestedLimit (500).
    const rows = [row("a", "2026-01-02T00:00:00Z")];
    const page = nextTransactionsPage(
      { transactions: rows, truncated: true, next_before: "2026-01-02T00:00:00Z" },
      500,
    );
    expect(page.hasMore).toBe(true);
    expect(page.nextBefore).toBe("2026-01-02T00:00:00Z");
  });

  it("drops a malformed row rather than throwing or including it", () => {
    const page = nextTransactionsPage(
      {
        transactions: [row("a", "2026-01-01T00:00:00Z"), { id: "missing-fields" }],
        truncated: false,
        next_before: null,
      },
      500,
    );
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0].id).toBe("a");
  });

  it("returns an empty, non-paging page for a null or non-object response", () => {
    expect(nextTransactionsPage(null, 500)).toEqual({
      rows: [],
      hasMore: false,
      nextBefore: null,
    });
    expect(nextTransactionsPage("not an object", 500)).toEqual({
      rows: [],
      hasMore: false,
      nextBefore: null,
    });
  });

  it("returns an empty page when transactions is missing or not an array", () => {
    expect(nextTransactionsPage({ truncated: false }, 500)).toEqual({
      rows: [],
      hasMore: false,
      nextBefore: null,
    });
  });
});
