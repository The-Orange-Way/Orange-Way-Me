/**
 * Disconnect routing, contract tests.
 *
 * The defect these pin: a private connection was sent to the ordinary delete
 * endpoint, which is scoped by subaccount and cannot see it, so it answered
 * 404 and the row could never be removed.
 */

import { describe, it, expect } from "vitest";
import { buildDeletePlan } from "../connection-delete";

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
    // app_user_id is forced to the authenticated user inside ow-or-proxy.
    // The stealth endpoint deletes by row id, so a client-supplied owner would
    // let any signed-in caller delete another user's connection by guessing an
    // id. If this assertion ever fails, that hole is open.
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
