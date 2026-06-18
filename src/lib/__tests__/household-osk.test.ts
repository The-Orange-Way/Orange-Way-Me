/**
 * @vitest-environment node
 *
 * Phase 4.4 — household-osk.ts (high-level Household Signing Key
 * orchestration) tests.
 *
 * Uses vi.mock to swap the Supabase client for a tiny in-memory fake.
 * The pqc + osk primitives are exercised against the real
 * implementations so the wire format stays end-to-end correct.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

if (typeof (globalThis as unknown as { window?: unknown }).window === "undefined") {
  (globalThis as unknown as { window: typeof globalThis }).window = globalThis;
}

// ---------------------------------------------------------------------------
// Mock the Supabase client BEFORE the SUT imports it.
// ---------------------------------------------------------------------------

interface FakeState {
  members: Array<{ user_id: string | null; role: string; status: string; household_id: string }>;
  publicKeys: Array<{ user_id: string; public_key_b64: string }>;
  signingKeys: Array<{ household_id: string; key_version: number }>;
  wraps: Array<{ user_id: string; household_id: string; key_version: number }>;
  /** Latest body posted to mint-household-signing-key. */
  lastMintBody: unknown;
  /** What invoke returns. */
  invokeResult: { data: unknown; error: unknown };
}

const state: FakeState = {
  members: [],
  publicKeys: [],
  signingKeys: [],
  wraps: [],
  lastMintBody: null,
  invokeResult: {
    data: { ok: true, household_id: "hh-1", key_version: 1, wrap_count: 0 },
    error: null,
  },
};

function resetState() {
  state.members = [];
  state.publicKeys = [];
  state.signingKeys = [];
  state.wraps = [];
  state.lastMintBody = null;
  state.invokeResult = {
    data: { ok: true, household_id: "hh-1", key_version: 1, wrap_count: 0 },
    error: null,
  };
}

// A minimal chainable query builder that supports the operations our SUT
// actually uses: .select.eq.in.order.limit.maybeSingle. The mock returns
// itself from each method, so the chain composes — the chained-builder
// pattern is what justifies the `any` types below.
type Row = Record<string, unknown>;
interface QueryBuilder {
  select: () => QueryBuilder;
  eq: (col: string, val: unknown) => QueryBuilder;
  in: (col: string, vals: unknown[]) => QueryBuilder;
  order: () => QueryBuilder;
  limit: (n: number) => QueryBuilder;
  maybeSingle: () => Promise<{ data: Row | null; error: null }>;
  then: (
    onFulfilled: (v: { data: Row[]; error: null }) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) => Promise<unknown>;
}

function makeQuery(rows: Row[]): QueryBuilder {
  const filters: Array<(r: Row) => boolean> = [];
  let limited = rows;
  const builder: QueryBuilder = {
    select() {
      return builder;
    },
    eq(col, val) {
      filters.push((r) => r[col] === val);
      return builder;
    },
    in(col, vals) {
      filters.push((r) => vals.includes(r[col]));
      return builder;
    },
    order() {
      return builder;
    },
    limit(n) {
      limited = limited.slice(0, n);
      return builder;
    },
    maybeSingle() {
      const filtered = limited.filter((r) => filters.every((f) => f(r)));
      return Promise.resolve({ data: filtered[0] ?? null, error: null });
    },
    then(onFulfilled, onRejected) {
      const filtered = limited.filter((r) => filters.every((f) => f(r)));
      return Promise.resolve({ data: filtered, error: null }).then(onFulfilled, onRejected);
    },
  };
  return builder;
}

vi.mock("@/integrations/supabase/client", () => {
  return {
    supabase: {
      from(table: string) {
        switch (table) {
          case "household_members":
            return makeQuery(state.members);
          case "user_public_keys":
            return makeQuery(state.publicKeys);
          case "household_signing_keys":
            return makeQuery(state.signingKeys);
          case "household_member_osk_wraps":
            return makeQuery(state.wraps);
          default:
            throw new Error(`Unexpected table in test stub: ${table}`);
        }
      },
      functions: {
        async invoke(_name: string, opts: { body: unknown }) {
          state.lastMintBody = opts.body;
          return state.invokeResult;
        },
      },
    },
  };
});

// ---------------------------------------------------------------------------
// SUT imports — must happen AFTER vi.mock.
// ---------------------------------------------------------------------------

import {
  listHouseholdWriters,
  mintSigningKeyForHousehold,
  householdHasSigningKey,
  verifyHouseholdMemberOskWrap,
} from "@/lib/household-osk";
import { generateHybridKemKeyPair } from "@/lib/pqc";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

beforeEach(() => {
  resetState();
});

describe("listHouseholdWriters", () => {
  it("returns only active writer roles with published public keys", async () => {
    const kp = generateHybridKemKeyPair();
    state.members = [
      { user_id: "u-owner", role: "owner", status: "active", household_id: "hh-1" },
      { user_id: "u-partner", role: "partner", status: "active", household_id: "hh-1" },
      // Auditor — excluded.
      { user_id: "u-aud", role: "auditor", status: "active", household_id: "hh-1" },
      // Inactive — excluded.
      { user_id: "u-old", role: "partner", status: "removed", household_id: "hh-1" },
    ];
    state.publicKeys = [
      { user_id: "u-owner", public_key_b64: bytesToBase64(kp.publicKey) },
      // u-partner has no published key yet → silently skipped.
    ];

    const writers = await listHouseholdWriters("hh-1");
    expect(writers).toHaveLength(1);
    expect(writers[0].userId).toBe("u-owner");
  });

  it("returns an empty list when there are no writers", async () => {
    state.members = [];
    const writers = await listHouseholdWriters("hh-1");
    expect(writers).toHaveLength(0);
  });
});

describe("mintSigningKeyForHousehold", () => {
  it("posts the public key + wraps and returns the bundle", async () => {
    const kp = generateHybridKemKeyPair();
    state.members = [{ user_id: "u-owner", role: "owner", status: "active", household_id: "hh-1" }];
    state.publicKeys = [{ user_id: "u-owner", public_key_b64: bytesToBase64(kp.publicKey) }];

    const result = await mintSigningKeyForHousehold("hh-1");
    expect(result.bundle.wraps).toHaveLength(1);
    expect(result.bundle.keyVersion).toBe(1);

    const body = state.lastMintBody as Record<string, unknown>;
    expect(body.household_id).toBe("hh-1");
    expect(body.public_key_b64).toBe(result.bundle.publicKeyB64);
    expect(body.wraps).toHaveLength(1);
  });

  it("throws when no writers are found", async () => {
    state.members = [];
    await expect(mintSigningKeyForHousehold("hh-1")).rejects.toThrow(/no active writer/i);
  });

  it("bumps key_version for a subsequent mint", async () => {
    const kp = generateHybridKemKeyPair();
    state.members = [{ user_id: "u-owner", role: "owner", status: "active", household_id: "hh-1" }];
    state.publicKeys = [{ user_id: "u-owner", public_key_b64: bytesToBase64(kp.publicKey) }];
    state.signingKeys = [{ household_id: "hh-1", key_version: 3 }];

    const result = await mintSigningKeyForHousehold("hh-1");
    expect(result.bundle.keyVersion).toBe(4);
  });
});

describe("householdHasSigningKey", () => {
  it("returns false when no row exists", async () => {
    expect(await householdHasSigningKey("hh-empty")).toBe(false);
  });
  it("returns true when a row exists", async () => {
    state.signingKeys = [{ household_id: "hh-1", key_version: 1 }];
    expect(await householdHasSigningKey("hh-1")).toBe(true);
  });
});

describe("verifyHouseholdMemberOskWrap", () => {
  it("returns true when a wrap exists for the member", async () => {
    state.wraps = [{ user_id: "u-1", household_id: "hh-1", key_version: 1 }];
    expect(await verifyHouseholdMemberOskWrap("u-1", "hh-1")).toBe(true);
  });
  it("returns false when no wrap exists", async () => {
    expect(await verifyHouseholdMemberOskWrap("u-1", "hh-1")).toBe(false);
  });
  it("returns false for empty inputs", async () => {
    expect(await verifyHouseholdMemberOskWrap("", "hh-1")).toBe(false);
    expect(await verifyHouseholdMemberOskWrap("u-1", "")).toBe(false);
  });
});
