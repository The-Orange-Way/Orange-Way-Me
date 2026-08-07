import { describe, it, expect } from "vitest";
import {
  OR_GATEWAY_DEFAULT,
  OR_URL_ALLOWLIST,
  isOrGatewayAllowed,
  resolveOrGatewayUrl,
} from "./or-gateway";

describe("resolveOrGatewayUrl", () => {
  it("resolves an unset env var to the production gateway", () => {
    expect(resolveOrGatewayUrl(null)).toBe("https://api.orangerails.com");
    expect(resolveOrGatewayUrl(undefined)).toBe(OR_GATEWAY_DEFAULT);
  });

  it("allows both real API gateways", () => {
    expect(resolveOrGatewayUrl("https://api.orangerails.com")).toBe("https://api.orangerails.com");
    expect(resolveOrGatewayUrl("https://api.orangerails.dev")).toBe("https://api.orangerails.dev");
  });

  it("refuses a host outside the allowlist", () => {
    expect(resolveOrGatewayUrl("https://evil.example.com")).toBeNull();
  });

  it("refuses lookalike hosts that merely contain an allowed name", () => {
    expect(resolveOrGatewayUrl("https://api.orangerails.com.evil.example")).toBeNull();
    expect(resolveOrGatewayUrl("https://api-orangerails.com")).toBeNull();
    expect(resolveOrGatewayUrl("https://evil.example/api.orangerails.com")).toBeNull();
  });

  it("refuses an allowed host carrying a path or a trailing slash", () => {
    expect(resolveOrGatewayUrl("https://api.orangerails.com/")).toBeNull();
    expect(resolveOrGatewayUrl("https://api.orangerails.com/redirect")).toBeNull();
  });

  it("refuses an http downgrade of an allowed host", () => {
    expect(resolveOrGatewayUrl("http://api.orangerails.com")).toBeNull();
  });

  it("refuses the OR dev CDN origin, which is not an API host", () => {
    expect(resolveOrGatewayUrl("https://dev.orangerails.com")).toBeNull();
  });

  it("refuses an empty string rather than treating it as unset", () => {
    expect(resolveOrGatewayUrl("")).toBeNull();
  });
});

describe("isOrGatewayAllowed", () => {
  it("is exact-match only", () => {
    for (const entry of OR_URL_ALLOWLIST) {
      expect(isOrGatewayAllowed(entry)).toBe(true);
      expect(isOrGatewayAllowed(`${entry}/`)).toBe(false);
      expect(isOrGatewayAllowed(entry.toUpperCase())).toBe(false);
    }
  });

  it("rejects non-strings without throwing", () => {
    expect(isOrGatewayAllowed(null)).toBe(false);
    expect(isOrGatewayAllowed(undefined)).toBe(false);
  });
});
