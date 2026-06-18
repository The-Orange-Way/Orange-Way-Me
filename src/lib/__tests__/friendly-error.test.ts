import { describe, expect, it } from "vitest";
import { humanizeError } from "../friendly-error";

describe("humanizeError", () => {
  it("returns fallback for empty / nullish input", () => {
    expect(humanizeError(null, "fallback.")).toBe("fallback.");
    expect(humanizeError("", "fallback.")).toBe("fallback.");
    expect(humanizeError("undefined", "fallback.")).toBe("fallback.");
  });

  it("normalizes session / auth errors", () => {
    expect(humanizeError(new Error("Not authenticated"))).toMatch(/sign in again/i);
    expect(humanizeError(new Error("401 Unauthorized"))).toMatch(/sign in again/i);
  });

  it("strips engineer-y 'Failed to X:' prefixes", () => {
    expect(humanizeError(new Error("Failed to create account: bad input"))).toBe("Bad input.");
    expect(humanizeError(new Error("Failed to map account: row missing"))).toBe("Row missing.");
  });

  it("catches Postgres duplicate / unique violations", () => {
    expect(humanizeError(new Error("duplicate key value violates unique constraint"))).toMatch(
      /already in your account/i,
    );
  });

  it("catches network / fetch failures", () => {
    expect(humanizeError(new Error("Failed to fetch"))).toMatch(/connection problem/i);
    expect(humanizeError(new Error("NetworkError when attempting to fetch"))).toMatch(
      /connection problem/i,
    );
  });

  it("catches timeouts", () => {
    expect(humanizeError(new Error("Request timed out"))).toMatch(/took longer/i);
  });

  it("trims long messages", () => {
    const long = "x".repeat(200);
    const out = humanizeError(new Error(long));
    expect(out.length).toBeLessThanOrEqual(140);
    expect(out.endsWith("…")).toBe(true);
  });

  it("ensures trailing period for plain messages", () => {
    expect(humanizeError(new Error("Something broke"))).toBe("Something broke.");
    expect(humanizeError(new Error("Already a sentence."))).toBe("Already a sentence.");
  });

  it("strips owm-or / or- edge function prefixes", () => {
    // When the tail of the edge-function error is something the humanizer
    // has its own copy for (auth, network, timeout), that copy wins — the
    // strip just removes the slug so the friendly rule downstream can fire.
    expect(humanizeError(new Error("owm-or-quick-connect failed: not signed in"))).toMatch(
      /sign in again/i,
    );
    // Tail without a specific rule → strip + capitalise + period.
    expect(humanizeError(new Error("or-link-mint-token failed (500): upstream is down"))).toBe(
      "Upstream is down.",
    );
  });

  it("uses generic edge-function copy when no tail", () => {
    expect(humanizeError(new Error("owm-or-discover-quiltt failed"))).toMatch(
      /couldn't reach a service/i,
    );
  });

  it("catches Quiltt pipeline 'returned no X' surfaces", () => {
    expect(humanizeError(new Error("Mint returned no widget_token"))).toMatch(
      /couldn't open the bank link/i,
    );
    expect(humanizeError(new Error("discover returned no accounts"))).toMatch(
      /didn't see any accounts/i,
    );
  });

  it("catches Quiltt bank-connection states", () => {
    expect(humanizeError(new Error("mfa_required by bank"))).toMatch(/verify it's really you/i);
    expect(humanizeError(new Error("credentials_required"))).toMatch(/bank login expired/i);
    expect(humanizeError(new Error("invalid credentials supplied"))).toMatch(/bank login expired/i);
    expect(humanizeError(new Error("institution_unavailable"))).toMatch(/down right now/i);
  });

  it("catches 'too many requests' as a rate-limit shape", () => {
    expect(humanizeError(new Error("HTTP 429 Too Many Requests"))).toMatch(/too many tries/i);
    expect(humanizeError(new Error("too many requests"))).toMatch(/too many tries/i);
  });
});
