/**
 * @vitest-environment node
 *
 * Tests for the two pure pieces the Bitcoin source button depends on:
 *
 *   1. buildStealthConnectUrl, which must address the widget route itself
 *      rather than the hosted landing page, and must carry parent_origin
 *      encoded and nothing else.
 *   2. buildStealthInit, which must supply exactly the identifiers the
 *      widget validates and must never carry key material or the fields
 *      the transport owns.
 *   3. stealthErrorMessage, which must never surface the widget's own
 *      string and must fall back for any code it does not know.
 *
 * VITE_OR_CONNECT_URL is stubbed before the import because OR_CONNECT_BASE
 * is read at module load.
 */
import { describe, it, expect, vi } from "vitest";

vi.stubEnv("VITE_OR_CONNECT_URL", "https://connect.orangerails.com/connect");

const {
  buildStealthConnectUrl,
  buildStealthInit,
  stealthErrorMessage,
  STEALTH_ERROR_FALLBACK,
  STEALTH_GAP_LIMIT,
} = await import("../connect");

describe("buildStealthConnectUrl", () => {
  it("addresses the stealth route, not the hosted landing page", () => {
    const url = buildStealthConnectUrl("https://orangeway.app");
    expect(url.startsWith("https://connect.orangerails.com/connect/stealth?")).toBe(true);
    // The landing pages are what the old handoff opened, and they ask the
    // user for a second click we can never satisfy from here.
    expect(url).not.toMatch(/\/connect\/(bitcoin|sparrow)\b/);
  });

  it("carries parent_origin encoded and carries nothing else", () => {
    const url = new URL(buildStealthConnectUrl("http://localhost:3000"));
    expect(url.searchParams.get("parent_origin")).toBe("http://localhost:3000");
    expect([...url.searchParams.keys()]).toEqual(["parent_origin"]);
    // A port or a non-default scheme has to survive the round trip intact.
    expect(url.search).toContain("http%3A%2F%2Flocalhost%3A3000");
  });
});

// Built at runtime from a plain sentence rather than pasted as a base64
// literal: a 44 character base64 blob in a test file reads as a real key to
// both a scanner and a human, and neither should have to decide.
const KEY_B64 = btoa("stand-in for the wrapping key, not a key");

describe("buildStealthInit", () => {
  it("supplies the identifiers the widget validates, mode add, and the wrapping key", () => {
    const init = buildStealthInit({
      appSlug: "orangeway-me-dev",
      appUserId: "user-1",
      orStealthKeyB64: KEY_B64,
    });
    expect(init).toEqual({
      app_slug: "orangeway-me-dev",
      app_user_id: "user-1",
      mode: "add",
      or_stealth_key_b64: KEY_B64,
    });
  });

  it("refuses to build a message with no wrapping key", () => {
    // The widget refuses a missing key with the same code it uses for its own
    // faults, so a caller must never reach that state: failing here keeps the
    // cause of the failure legible.
    expect(() =>
      buildStealthInit({ appSlug: "orangeway-me", appUserId: "user-1", orStealthKeyB64: "" }),
    ).toThrow(/wrapping key/i);
  });

  it("includes gap_limit only when the caller asks for one", () => {
    const withGap = buildStealthInit({
      appSlug: "orangeway-me",
      appUserId: "user-1",
      orStealthKeyB64: KEY_B64,
      gapLimit: STEALTH_GAP_LIMIT,
    });
    expect(withGap.gap_limit).toBe(STEALTH_GAP_LIMIT);
    expect(STEALTH_GAP_LIMIT).toBeGreaterThanOrEqual(1);
    expect(STEALTH_GAP_LIMIT).toBeLessThanOrEqual(1000);

    const withoutGap = buildStealthInit({
      appSlug: "orangeway-me",
      appUserId: "user-1",
      orStealthKeyB64: KEY_B64,
    });
    expect("gap_limit" in withoutGap).toBe(false);
  });

  it("carries no session token and none of the fields the transport owns", () => {
    const init = buildStealthInit({
      appSlug: "orangeway-me",
      appUserId: "user-1",
      orStealthKeyB64: KEY_B64,
      gapLimit: 250,
    });
    // The wrapping key is the only key material on this path. A session token
    // is not ours to send, and the origin and version belong to the transport.
    for (const owned of ["access_token", "return_callback_origin", "protocol_version"]) {
      expect(owned in init).toBe(false);
    }
  });
});

describe("stealthErrorMessage", () => {
  it("maps a known code to fixed local copy", () => {
    const refused = stealthErrorMessage({
      type: "OR_STEALTH_ERROR",
      code: "ORIGIN_NOT_ALLOWED",
    } as never);
    expect(refused).toMatch(/not yet authorised/i);
    expect(refused).not.toBe(STEALTH_ERROR_FALLBACK);
  });

  it("falls back for an unknown, missing, or non-string code", () => {
    expect(stealthErrorMessage({ type: "OR_STEALTH_ERROR", code: "NOPE" } as never)).toBe(
      STEALTH_ERROR_FALLBACK,
    );
    expect(stealthErrorMessage({ type: "OR_STEALTH_ERROR" } as never)).toBe(STEALTH_ERROR_FALLBACK);
    expect(stealthErrorMessage({ type: "OR_STEALTH_ERROR", code: 500 } as never)).toBe(
      STEALTH_ERROR_FALLBACK,
    );
  });

  it("falls back for a code naming an inherited object member", () => {
    // The code is attacker-controlled. Against an object literal, these names
    // resolve to inherited members and the lookup yields a function rather
    // than copy, so the lookup must not be a plain index.
    for (const code of ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"]) {
      const out = stealthErrorMessage({ type: "OR_STEALTH_ERROR", code } as never);
      expect(typeof out).toBe("string");
      expect(out).toBe(STEALTH_ERROR_FALLBACK);
    }
  });

  it("never surfaces a string supplied by the widget", () => {
    const hostile = stealthErrorMessage({
      type: "OR_STEALTH_ERROR",
      code: "ORIGIN_NOT_ALLOWED",
      message: "<img src=x onerror=alert(1)>",
    } as never);
    expect(hostile).not.toContain("<img");
    expect(hostile).not.toContain("alert");
  });
});
