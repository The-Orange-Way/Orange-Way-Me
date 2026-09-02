/**
 * registerOpk's rotation-guard retry, which is the one place in the app that
 * branches on `CallProxyError.body`.
 *
 * The first call deliberately omits confirm_rotation, so a first-time
 * registration succeeds and a stale-key mismatch comes back as a rejection.
 * registerOpk then retries once with confirm_rotation set. It recognises that
 * rejection three ways: the 409 status, the `error` string on the body, or the
 * same wording on the message. The body path is covered here because the body
 * is narrowed before callers see it, and this is what proves the field they
 * branch on survived the narrowing.
 */

import { describe, it, expect } from "vitest";

import { registerOpk } from "../bank-sync-opk";
import { CallProxyError } from "../proxy-errors";
import type { OpkKeypair } from "../opk";

type Payload = Record<string, unknown>;

/** Synthetic. The key bytes are never used: registerOpk only forwards the b64. */
const KEYPAIR: OpkKeypair = {
  publicKeyB64: "cHVibGljLWtleS1mb3ItdGVzdHM",
  publicKey: new Uint8Array(32),
  secretKey: new Uint8Array(32),
};

/**
 * The rejection OR's rotation guard produces, with a list of rows alongside
 * it, as a sync-shaped response can carry. The rows must not reach the caller;
 * the error string must.
 */
const ROTATION_BODY = {
  error: "confirm_rotation required",
  transactions: [{ id: "row-1", enc_amount: "-42.10" }],
};

/** What supabase-js says when it has no upstream status to report. */
const OPAQUE_PROXY_MESSAGE = "Edge Function returned a non-2xx status code";

function fakeProxy(responses: Array<() => Promise<unknown>>) {
  const calls: Array<{ endpoint: string; payload: Payload }> = [];
  const fn = async (endpoint: string, payload: Payload): Promise<unknown> => {
    calls.push({ endpoint, payload });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected extra proxy call to ${endpoint}`);
    return next();
  };
  return { fn, calls };
}

const rejectWith = (err: unknown) => () => Promise.reject(err);
const resolveOk = () => Promise.resolve({ status: "ok" });

describe("registerOpk rotation-guard retry", () => {
  it("registers once and does not retry when the first call succeeds", async () => {
    const proxy = fakeProxy([resolveOk]);
    await registerOpk(proxy.fn, KEYPAIR);

    expect(proxy.calls).toHaveLength(1);
    expect(proxy.calls[0].endpoint).toBe("or-sync-key-register");
    expect(proxy.calls[0].payload.opk_public).toBe(KEYPAIR.publicKeyB64);
    expect(proxy.calls[0].payload).not.toHaveProperty("confirm_rotation");
  });

  it("retries with confirm_rotation on a 409", async () => {
    const err = new CallProxyError("confirm_rotation required", 409, ROTATION_BODY);
    const proxy = fakeProxy([rejectWith(err), resolveOk]);
    await registerOpk(proxy.fn, KEYPAIR);

    expect(proxy.calls).toHaveLength(2);
    expect(proxy.calls[1].payload.confirm_rotation).toBe(true);
    expect(proxy.calls[1].payload.rotation_reason).toBe("owm-client-vault-rotated");
  });

  it("retries on the body alone when no status is available", async () => {
    // Status 0 and a message that says nothing, so the only thing left to
    // branch on is body.error. This is the assertion that fails if the
    // narrowing ever stops retaining it.
    const err = new CallProxyError(OPAQUE_PROXY_MESSAGE, 0, ROTATION_BODY);
    expect((err.body as { error?: string }).error).toBe("confirm_rotation required");

    const proxy = fakeProxy([rejectWith(err), resolveOk]);
    await registerOpk(proxy.fn, KEYPAIR);

    expect(proxy.calls).toHaveLength(2);
    expect(proxy.calls[1].payload.confirm_rotation).toBe(true);
  });

  it("carries no rows on the error it branched on", async () => {
    const err = new CallProxyError("confirm_rotation required", 409, ROTATION_BODY);
    expect(JSON.stringify(err.body)).not.toContain("row-1");
    expect(err.body).toEqual({ error: "confirm_rotation required" });
  });

  it("rethrows an unrelated failure instead of retrying", async () => {
    // Retrying a genuine failure with confirm_rotation would write a rotation
    // audit row on OR for something that was never a rotation.
    const err = new CallProxyError("Subaccount not found", 404, { error: "Subaccount not found" });
    const proxy = fakeProxy([rejectWith(err)]);

    await expect(registerOpk(proxy.fn, KEYPAIR)).rejects.toThrow("Subaccount not found");
    expect(proxy.calls).toHaveLength(1);
  });
});
