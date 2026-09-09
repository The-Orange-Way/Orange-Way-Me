import { describe, expect, it } from "vitest";
import { toAccountSubtotalEntries } from "../format";

describe("toAccountSubtotalEntries", () => {
  it("looks up the transaction sum by the zero-balance account id", () => {
    expect(
      toAccountSubtotalEntries(
        [{ id: "checking", balance: "0", currency: "USD" }],
        new Map([["checking", 125.5]]),
      ),
    ).toEqual([
      {
        amount: "125.5",
        currency: "USD",
      },
    ]);
  });

  it("does not cross-wire transaction sums between accounts", () => {
    expect(
      toAccountSubtotalEntries(
        [
          { id: "checking", balance: "0", currency: "USD" },
          { id: "savings", balance: "0", currency: "USD" },
        ],
        new Map([
          ["checking", 10],
          ["savings", 20],
        ]),
      ),
    ).toEqual([
      { amount: "10", currency: "USD" },
      { amount: "20", currency: "USD" },
    ]);
  });

  it("keeps a nonzero stored balance over that account's transaction sum", () => {
    expect(
      toAccountSubtotalEntries(
        [{ id: "checking", balance: "80", currency: "USD" }],
        new Map([["checking", 125.5]]),
      ),
    ).toEqual([
      {
        amount: "80",
        currency: "USD",
        format_version: undefined,
      },
    ]);
  });
});
