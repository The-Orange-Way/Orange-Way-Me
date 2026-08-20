/**
 * Disconnect routing, contract tests.
 *
 * The defect these pin: a private connection was sent to the ordinary delete
 * endpoint, which is scoped by subaccount and cannot see it, so it answered
 * 404 and the row could never be removed.
 */

import { describe, it, expect } from "vitest";
import { buildDeletePlan, classifyDeleteReadback } from "../connection-delete";

const BASE = { connectionId: "conn-123", subaccountId: "sub-abc" };

describe("buildDeletePlan", () => {
  it("sends an ordinary connection to or-connection-delete, scoped by subaccount", () => {
    expect(buildDeletePlan({ ...BASE, isStealth: false })).toEqual({
      endpoint: "or-connection-delete",
      payload: { subaccount_id: "sub-abc", connection_id: "conn-123" },
    });
  });

  it("sends a private connection to the stealth endpoint instead", () => {
    expect(buildDeletePlan({ ...BASE, isStealth: true })).toEqual({
      endpoint: "or-stealth-connection-delete",
      payload: { connection_id: "conn-123" },
    });
  });

  it("never sends subaccount_id on the stealth path", () => {
    // The stealth store is not scoped by subaccount. Sending one would be a
    // field the endpoint ignores, and would imply a scoping that is not real.
    const plan = buildDeletePlan({ ...BASE, isStealth: true });
    expect(plan.payload).not.toHaveProperty("subaccount_id");
  });

  it("never sends an owner from the browser on either path", () => {
    // The owner (app_user_id) is resolved server side from the authenticated
    // session inside ow-or-proxy and is never accepted from the client. This
    // asserts the browser sends no owner field on either path.
    for (const isStealth of [true, false]) {
      const plan = buildDeletePlan({ ...BASE, isStealth });
      expect(plan.payload).not.toHaveProperty("app_user_id");
      expect(plan.payload).not.toHaveProperty("user_id");
    }
  });

  it("treats an absent flag as an ordinary connection", () => {
    // is_stealth is optional on the row type: it arrives over the wire and an
    // older response simply omits it. Absent must mean "ordinary", never
    // "private", so a missing field cannot silently reroute a delete.
    expect(buildDeletePlan({ ...BASE, isStealth: undefined }).endpoint).toBe(
      "or-connection-delete",
    );
  });
});

describe("classifyDeleteReadback", () => {
  it("is a silent failure when the row is STILL present after a 2xx delete", () => {
    // The core DL-1181 case: the endpoint returned 2xx, the optimistic UI
    // removed the row, but the read-back shows it is still there. This must
    // never be reported as success.
    const rows = [{ id: "conn-123" }, { id: "conn-other" }];
    expect(classifyDeleteReadback(rows, "conn-123")).toBe("silent-failure");
  });

  it("is confirmed-gone when the row is absent from a list we could read", () => {
    const rows = [{ id: "conn-other" }];
    expect(classifyDeleteReadback(rows, "conn-123")).toBe("confirmed-gone");
  });

  it("is confirmed-gone against an empty list", () => {
    expect(classifyDeleteReadback([], "conn-123")).toBe("confirmed-gone");
  });

  it("is unconfirmed when the list could not be read back", () => {
    // rows null/undefined means refreshList failed. We only know the endpoint
    // returned 2xx, so we must not claim a verified delete.
    expect(classifyDeleteReadback(null, "conn-123")).toBe("unconfirmed");
    expect(classifyDeleteReadback(undefined, "conn-123")).toBe("unconfirmed");
  });
});
