import { describe, it, expect } from "vitest";
import { CallProxyError, isSubaccountNotFound } from "../proxy-errors";

describe("CallProxyError", () => {
  it("carries the upstream status and body for callers that branch on them", () => {
    const body = { error: "Subaccount not found" };
    const err = new CallProxyError("Subaccount not found", 404, body);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("CallProxyError");
    expect(err.status).toBe(404);
    expect(err.body).toBe(body);
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
