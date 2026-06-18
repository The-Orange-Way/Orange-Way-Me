/**
 * @vitest-environment node
 *
 * Phase 4.4 — row-signing helper tests.
 *
 * The six signed OW tables (transactions, accounts, categories,
 * budgets, goals, rules) each receive a `{ household_id,
 * signature_b64, signature_key_version }` trio from
 * `buildHouseholdSignatureFields`. The server trigger
 * `verify_mutation_signature_on_write` verifies the signature against
 * `convert_to(v_household_id::TEXT, 'UTF8')`; these tests pin the
 * client payload to the same bytes so a future schema drift fails at
 * the unit level instead of in prod.
 *
 * One describe block per table makes the wiring story easy to read in
 * a green run: each table exercises the helper with the active HSK
 * cache for that hook and confirms the row payload it would build.
 */

import { describe, it, expect } from "vitest";

if (typeof (globalThis as unknown as { window?: unknown }).window === "undefined") {
  (globalThis as unknown as { window: typeof globalThis }).window = globalThis;
}

import { buildHouseholdSignatureFields, canonicalRowSignaturePayload } from "@/lib/row-signing";
import {
  generateAndWrapHouseholdSigningKey,
  unwrapHouseholdSigningKey,
  verifySignature,
  type OskHandle,
} from "@/lib/osk";
import { generateHybridKemKeyPair } from "@/lib/pqc";

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

const HOUSEHOLD_ID = "11111111-1111-1111-1111-111111111111";

async function mintHandle(): Promise<{ handle: OskHandle; publicKeyB64: string }> {
  const writer = generateHybridKemKeyPair();
  const bundle = await generateAndWrapHouseholdSigningKey(HOUSEHOLD_ID, [
    {
      userId: "22222222-2222-2222-2222-222222222222",
      publicKeyB64: bytesToBase64(writer.publicKey),
    },
  ]);
  const privateKeyBytes = await unwrapHouseholdSigningKey(
    bundle.wraps[0].wrapped_private_key,
    writer.secretKey,
  );
  return {
    handle: { privateKeyBytes, keyVersion: bundle.keyVersion },
    publicKeyB64: bundle.publicKeyB64,
  };
}

// ---------------------------------------------------------------------------
// Cross-table contract.
// ---------------------------------------------------------------------------

describe("buildHouseholdSignatureFields — solo (no household)", () => {
  it("returns all-NULL fields when household_id is null", () => {
    const out = buildHouseholdSignatureFields(null, null);
    expect(out).toEqual({
      household_id: null,
      signature_b64: null,
      signature_key_version: null,
    });
  });
});

describe("buildHouseholdSignatureFields — pre-mint (household present, no HSK cached)", () => {
  it("stamps household_id but leaves signature columns NULL", () => {
    const out = buildHouseholdSignatureFields(HOUSEHOLD_ID, null);
    expect(out).toEqual({
      household_id: HOUSEHOLD_ID,
      signature_b64: null,
      signature_key_version: null,
    });
  });
});

describe("canonicalRowSignaturePayload — wire format pin", () => {
  it("encodes household_id as UTF-8 bytes — matches the SQL trigger", () => {
    const bytes = canonicalRowSignaturePayload(HOUSEHOLD_ID);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(bytes)).toBe(HOUSEHOLD_ID);
  });
});

// ---------------------------------------------------------------------------
// Per-table wiring proofs. Each describe pretends to be the row builder
// for one of the six signed tables and confirms `buildHouseholdSignatureFields`
// produces a signature the household's public key verifies.
//
// We don't construct full encrypted rows here — the field set varies
// per table and is exercised at the integration level. The point is to
// prove every hook's spread of `...buildHouseholdSignatureFields()`
// lands the right three columns on the wire.
// ---------------------------------------------------------------------------

describe("transactions — sigFields round-trip", () => {
  it("inserts produce a signature the household public key verifies", async () => {
    const { handle, publicKeyB64 } = await mintHandle();
    const row = {
      user_id: "u",
      account_id: "a",
      date: "2026-01-01",
      enc_amount: "ct",
      ...buildHouseholdSignatureFields(HOUSEHOLD_ID, handle),
    };
    expect(row.household_id).toBe(HOUSEHOLD_ID);
    expect(row.signature_key_version).toBe(1);
    expect(
      verifySignature(
        publicKeyB64,
        canonicalRowSignaturePayload(HOUSEHOLD_ID),
        row.signature_b64 as string,
      ),
    ).toBe(true);
  });
});

describe("accounts — sigFields round-trip", () => {
  it("updates include verifiable signature fields", async () => {
    const { handle, publicKeyB64 } = await mintHandle();
    const upd = {
      enc_name: "ct",
      ...buildHouseholdSignatureFields(HOUSEHOLD_ID, handle),
    };
    expect(upd.household_id).toBe(HOUSEHOLD_ID);
    expect(
      verifySignature(
        publicKeyB64,
        canonicalRowSignaturePayload(HOUSEHOLD_ID),
        upd.signature_b64 as string,
      ),
    ).toBe(true);
  });
});

describe("categories — sigFields round-trip", () => {
  it("inserts include verifiable signature fields", async () => {
    const { handle, publicKeyB64 } = await mintHandle();
    const row = {
      user_id: "u",
      enc_name: "ct",
      sort_order: 0,
      type: "expense",
      ...buildHouseholdSignatureFields(HOUSEHOLD_ID, handle),
    };
    expect(row.household_id).toBe(HOUSEHOLD_ID);
    expect(
      verifySignature(
        publicKeyB64,
        canonicalRowSignaturePayload(HOUSEHOLD_ID),
        row.signature_b64 as string,
      ),
    ).toBe(true);
  });
});

describe("budgets — sigFields round-trip", () => {
  it("inserts include verifiable signature fields", async () => {
    const { handle, publicKeyB64 } = await mintHandle();
    const row = {
      user_id: "u",
      month: "2026-01-01",
      enc_mode: "ct",
      enc_data: "ct",
      ...buildHouseholdSignatureFields(HOUSEHOLD_ID, handle),
    };
    expect(row.household_id).toBe(HOUSEHOLD_ID);
    expect(
      verifySignature(
        publicKeyB64,
        canonicalRowSignaturePayload(HOUSEHOLD_ID),
        row.signature_b64 as string,
      ),
    ).toBe(true);
  });
});

describe("goals — sigFields round-trip", () => {
  it("inserts include verifiable signature fields", async () => {
    const { handle, publicKeyB64 } = await mintHandle();
    const row = {
      user_id: "u",
      is_completed: false,
      enc_name: "ct",
      ...buildHouseholdSignatureFields(HOUSEHOLD_ID, handle),
    };
    expect(row.household_id).toBe(HOUSEHOLD_ID);
    expect(
      verifySignature(
        publicKeyB64,
        canonicalRowSignaturePayload(HOUSEHOLD_ID),
        row.signature_b64 as string,
      ),
    ).toBe(true);
  });
});

describe("rules — sigFields round-trip", () => {
  it("inserts include verifiable signature fields", async () => {
    const { handle, publicKeyB64 } = await mintHandle();
    const row = {
      user_id: "u",
      enc_name: "ct",
      enc_conditions: "ct",
      enc_actions: "ct",
      match_mode: "all",
      is_enabled: true,
      sort_order: 0,
      ...buildHouseholdSignatureFields(HOUSEHOLD_ID, handle),
    };
    expect(row.household_id).toBe(HOUSEHOLD_ID);
    expect(
      verifySignature(
        publicKeyB64,
        canonicalRowSignaturePayload(HOUSEHOLD_ID),
        row.signature_b64 as string,
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Idempotency / safety.
// ---------------------------------------------------------------------------

describe("buildHouseholdSignatureFields — idempotent + key-version stable", () => {
  it("two consecutive calls produce signatures that both verify (deterministic key, fresh nonce)", async () => {
    const { handle, publicKeyB64 } = await mintHandle();
    const a = buildHouseholdSignatureFields(HOUSEHOLD_ID, handle);
    const b = buildHouseholdSignatureFields(HOUSEHOLD_ID, handle);
    expect(a.household_id).toBe(b.household_id);
    expect(a.signature_key_version).toBe(b.signature_key_version);
    const payload = canonicalRowSignaturePayload(HOUSEHOLD_ID);
    expect(verifySignature(publicKeyB64, payload, a.signature_b64 as string)).toBe(true);
    expect(verifySignature(publicKeyB64, payload, b.signature_b64 as string)).toBe(true);
  });

  it("a signature minted for one household does NOT verify against another household_id", async () => {
    const { handle, publicKeyB64 } = await mintHandle();
    const sigForHhA = buildHouseholdSignatureFields(HOUSEHOLD_ID, handle);
    const wrongPayload = canonicalRowSignaturePayload("99999999-9999-9999-9999-999999999999");
    expect(verifySignature(publicKeyB64, wrongPayload, sigForHhA.signature_b64 as string)).toBe(
      false,
    );
  });
});
