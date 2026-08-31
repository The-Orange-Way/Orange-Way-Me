import { describe, it, expect } from "vitest";
import { CallProxyError, isSubaccountNotFound, narrowProxyErrorBody } from "../proxy-errors";

/**
 * A response shape the sync endpoints really return: an error string sitting
 * next to a list of application rows. The list is what must not survive onto
 * the error; the string is what callers branch on and must survive.
 */
const RESPONSE_WITH_ROWS = {
  error: "sync failed",
  transactions: [
    { id: "row-1", enc_amount: "-42.10", enc_description: "example", enc_merchant: "example" },
  ],
  count: 1,
};

describe("narrowProxyErrorBody", () => {
  it("keeps the error string and drops everything alongside it", () => {
    expect(narrowProxyErrorBody(RESPONSE_WITH_ROWS)).toEqual({ error: "sync failed" });
  });

  it("keeps the code-shaped siblings of error", () => {
    const body = { error: "nope", error_code: "E_NOPE", code: 42, reason: "because" };
    expect(narrowProxyErrorBody(body)).toEqual(body);
  });

  it("drops an allowlisted key whose value is not a scalar", () => {
    // Otherwise a payload could travel under a name that is on the list.
    const body = { error: { detail: "x", rows: [1, 2, 3] } };
    expect(narrowProxyErrorBody(body)).toBeNull();
  });

  it("returns null for a top-level list, which is rows and never an error", () => {
    expect(narrowProxyErrorBody([{ id: "row-1" }])).toBeNull();
  });

  it("returns null when nothing on the allowlist is present", () => {
    expect(narrowProxyErrorBody({ transactions: [{ id: "row-1" }] })).toBeNull();
  });

  it("truncates a long string body rather than carrying it whole", () => {
    const long = "x".repeat(5000);
    expect(String(narrowProxyErrorBody(long))).toHaveLength(200);
  });

  it("passes null, undefined and scalars through unchanged", () => {
    expect(narrowProxyErrorBody(null)).toBeNull();
    expect(narrowProxyErrorBody(undefined)).toBeNull();
    expect(narrowProxyErrorBody(503)).toBe(503);
  });
});

describe("CallProxyError", () => {
  it("carries the upstream status and the error-shaped body for callers", () => {
    const body = { error: "Subaccount not found" };
    const err = new CallProxyError("Subaccount not found", 404, body);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("CallProxyError");
    expect(err.status).toBe(404);
    expect(err.body).toEqual(body);
  });

  it("narrows in the constructor, so no throw site can attach rows", () => {
    const err = new CallProxyError("sync failed", 500, RESPONSE_WITH_ROWS);
    expect(err.body).toEqual({ error: "sync failed" });
    expect(JSON.stringify(err.body)).not.toContain("row-1");
  });

  it("does not keep the caller's object, so later mutation cannot widen it", () => {
    const body: Record<string, unknown> = { error: "sync failed" };
    const err = new CallProxyError("sync failed", 500, body);
    body.transactions = [{ id: "row-1" }];
    expect(err.body).toEqual({ error: "sync failed" });
  });
});

describe("isSubaccountNotFound", () => {
  it("matches OR's rejection of a subaccount id it never issued", () => {
    expect(isSubaccountNotFound(new CallProxyError("Subaccount not found", 404, null))).toBe(true);
  });

  it("matches regardless of casing, since the wording is OR's to change", () => {
    expect(isSubaccountNotFound(new CallProxyError("subaccount not found", 404, null))).toBe(true);
  });

  // The recovery this predicate guards clears the cached subaccount and
  // re-provisions. That is the right move for an id OR does not recognise and
  // the wrong move for anything else: it cannot fix an unrelated failure, and
  // it would replace the real error with a silent retry. So each case below is
  // a bug the predicate has to keep out, not a formality.

  it("ignores a 404 that is not about the subaccount", () => {
    // A missing connection or a retired endpoint. Re-provisioning would not
    // fix either, and would bury the error the user needs to see.
    expect(isSubaccountNotFound(new CallProxyError("Connection not found", 404, null))).toBe(false);
  });

  it("ignores the subaccount wording on a non-404 status", () => {
    // A 500 mentioning a subaccount is OR failing, not OR disowning the id.
    // Throwing away a good subaccount over a transient fault would be worse
    // than the fault.
    expect(isSubaccountNotFound(new CallProxyError("Subaccount not found", 500, null))).toBe(false);
  });

  it("ignores a plain Error carrying the same message", () => {
    // useOrConnectionsList's callProxy throws bare Errors. Without the
    // instanceof check, a message match alone would let a status-less error
    // trigger the recovery path.
    expect(isSubaccountNotFound(new Error("Subaccount not found"))).toBe(false);
  });

  it("ignores non-error values", () => {
    expect(isSubaccountNotFound(null)).toBe(false);
    expect(isSubaccountNotFound(undefined)).toBe(false);
    expect(isSubaccountNotFound("Subaccount not found")).toBe(false);
  });
});
