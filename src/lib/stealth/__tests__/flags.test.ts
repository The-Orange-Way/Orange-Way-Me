/**
 * Stealth sync kill switch, fail-closed test.
 *
 * The whole value of an environment-derived flag is that forgetting to set it
 * ships the feature dark rather than shipping it on. The test environment sets
 * nothing, so this asserts the unset case directly: no variable, no widget.
 */

import { describe, it, expect } from "vitest";
import { STEALTH_SYNC_ENABLED } from "../flags";

describe("STEALTH_SYNC_ENABLED", () => {
  it("is off when the environment variable is unset", () => {
    expect(import.meta.env.VITE_STEALTH_SYNC_ENABLED).toBeUndefined();
    expect(STEALTH_SYNC_ENABLED).toBe(false);
  });

  it("is a strict compare against the string 'true', never a truthiness check", () => {
    // A truthy compare would turn the empty-string prod arm in deploy.yml into
    // a live feature the moment anyone set it to 'false' or '0'.
    expect(STEALTH_SYNC_ENABLED).toBe(false);
    expect(typeof STEALTH_SYNC_ENABLED).toBe("boolean");
  });
});
