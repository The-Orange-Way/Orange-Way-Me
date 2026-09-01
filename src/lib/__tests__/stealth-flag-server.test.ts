/**
 * The private wallet kill switch, as enforced on the server.
 *
 * Two halves, because the claim has two halves:
 *
 *  1. POLARITY. readStealthSyncEnabled is pure and takes a duck typed client,
 *     so it runs under Node based vitest with a fake. These tests pin the fail
 *     closed rule: only a successful read of a row whose enabled is exactly
 *     boolean true opens the door.
 *
 *  2. WIRING. The polarity tests cannot tell whether the helper is actually
 *     called, or whether it is called before the token is built. A gate that is
 *     correct and unreachable is the failure this second half exists to catch,
 *     so those tests read the function source and assert the ordering.
 *
 * Honest limit: half 2 is a source assertion, not an over the wire test. It
 * proves the refusal cannot be bypassed by deleting or reordering the check.
 * It does not exercise a real request, because this repo has no Deno test
 * runner. See the companion note on the ticket.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  APP_FLAGS_TABLE,
  type AppFlagReader,
  type AppFlagRow,
  readStealthSyncEnabled,
  STEALTH_SYNC_DISABLED_CODE,
  STEALTH_SYNC_DISABLED_ERROR,
  STEALTH_SYNC_DISABLED_STATUS,
  STEALTH_SYNC_FLAG_KEY,
} from "../../../supabase/functions/_shared/stealth-flag.ts";

interface RecordedCall {
  table: string;
  columns: string;
  column: string;
  value: string;
}

/**
 * A fake with the same shape the real Supabase client presents, recording what
 * was asked for so a test can assert the query and not just its answer.
 */
function fakeReader(
  result: { data: AppFlagRow | null; error: unknown } | (() => never),
): { client: AppFlagReader; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const client: AppFlagReader = {
    from(table: string) {
      return {
        select(columns: string) {
          return {
            eq(column: string, value: string) {
              calls.push({ table, columns, column, value });
              return {
                maybeSingle: async () => {
                  if (typeof result === "function") return result();
                  return result;
                },
              };
            },
          };
        },
      };
    },
  };
  return { client, calls };
}

describe("readStealthSyncEnabled: polarity", () => {
  it("is true only when the row says exactly true", async () => {
    const { client } = fakeReader({ data: { enabled: true }, error: null });
    await expect(readStealthSyncEnabled(client)).resolves.toBe(true);
  });

  it("is false when the row says false", async () => {
    const { client } = fakeReader({ data: { enabled: false }, error: null });
    await expect(readStealthSyncEnabled(client)).resolves.toBe(false);
  });

  it("is false when the row is absent", async () => {
    const { client } = fakeReader({ data: null, error: null });
    await expect(readStealthSyncEnabled(client)).resolves.toBe(false);
  });

  it("is false when the row exists but carries no enabled column", async () => {
    const { client } = fakeReader({ data: {}, error: null });
    await expect(readStealthSyncEnabled(client)).resolves.toBe(false);
  });

  it("is false when the read returns an error, even alongside a true row", async () => {
    const { client } = fakeReader({
      data: { enabled: true },
      error: { message: "permission denied for table app_flags" },
    });
    await expect(readStealthSyncEnabled(client)).resolves.toBe(false);
  });

  it("is false when the read throws", async () => {
    const { client } = fakeReader(() => {
      throw new Error("network down");
    });
    await expect(readStealthSyncEnabled(client)).resolves.toBe(false);
  });

  it("is false for truthy values that are not boolean true", async () => {
    for (const enabled of ["true", 1, "yes", {}, []]) {
      const { client } = fakeReader({ data: { enabled }, error: null });
      await expect(readStealthSyncEnabled(client)).resolves.toBe(false);
    }
  });

  it("reads the row we think it reads", async () => {
    const { client, calls } = fakeReader({ data: { enabled: true }, error: null });
    await readStealthSyncEnabled(client);
    expect(calls).toEqual([
      {
        table: APP_FLAGS_TABLE,
        columns: "enabled",
        column: "key",
        value: STEALTH_SYNC_FLAG_KEY,
      },
    ]);
    expect(APP_FLAGS_TABLE).toBe("app_flags");
    expect(STEALTH_SYNC_FLAG_KEY).toBe("stealth_sync_enabled");
  });
});

describe("the refusal the client has to match on", () => {
  it("has a stable code and a non 2xx status", () => {
    expect(STEALTH_SYNC_DISABLED_CODE).toBe("stealth_sync_disabled");
    expect(STEALTH_SYNC_DISABLED_STATUS).toBeGreaterThanOrEqual(400);
    expect(STEALTH_SYNC_DISABLED_ERROR.length).toBeGreaterThan(0);
  });
});

const PROXY_SOURCE = readFileSync(
  new URL("../../../supabase/functions/ow-or-proxy/index.ts", import.meta.url),
  "utf8",
);

describe("ow-or-proxy wiring: the gate exists and sits above the mint", () => {
  const gateAt = PROXY_SOURCE.indexOf("STEALTH_GATED_ENDPOINTS.has(endpoint)");
  const mintAt = PROXY_SOURCE.indexOf("orBody = { app_user_id: user.id, ttl_seconds: ttl };");
  const callAt = PROXY_SOURCE.indexOf("const orRes = await callOr(");

  it("gates the mint action and only the mint action", () => {
    expect(PROXY_SOURCE).toContain(
      'const STEALTH_GATED_ENDPOINTS = new Set(["or-link-mint-token"]);',
    );
  });

  it("calls the shared fail closed reader rather than reading the flag inline", () => {
    expect(PROXY_SOURCE).toContain('from "../_shared/stealth-flag.ts"');
    expect(PROXY_SOURCE).toContain("await readStealthSyncEnabled(");
  });

  it("checks the flag before the request body is built", () => {
    expect(gateAt).toBeGreaterThan(-1);
    expect(mintAt).toBeGreaterThan(-1);
    expect(gateAt).toBeLessThan(mintAt);
  });

  it("checks the flag before anything is sent upstream", () => {
    expect(callAt).toBeGreaterThan(-1);
    expect(gateAt).toBeLessThan(callAt);
  });

  it("returns the stable code on refusal, with no token in the body", () => {
    expect(PROXY_SOURCE).toContain(
      "{ error: STEALTH_SYNC_DISABLED_ERROR, code: STEALTH_SYNC_DISABLED_CODE }",
    );
  });
});
