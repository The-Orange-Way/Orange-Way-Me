/**
 * @vitest-environment node
 *
 * Feature-flags module: pin the default-OFF behaviour and the truthy
 * value parsing. If these flip to ON by default, Phase 4.4 UI ships to
 * customers before the real ML-DSA verifier lands.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("feature-flags", () => {
  const originalEnv = { ...import.meta.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    // Restore env after each test so module cache + env stays clean.
    for (const k of Object.keys(import.meta.env)) {
      if (!(k in originalEnv)) {
        delete (import.meta.env as Record<string, unknown>)[k];
      }
    }
    Object.assign(import.meta.env, originalEnv);
  });

  it("phase44Public defaults to false when env var is undefined", async () => {
    delete (import.meta.env as Record<string, unknown>).VITE_PHASE_4_4_PUBLIC;
    const { featureFlags } = await import("@/lib/feature-flags");
    expect(featureFlags.phase44Public).toBe(false);
  });

  it("phase44Public is false for empty string", async () => {
    (import.meta.env as Record<string, unknown>).VITE_PHASE_4_4_PUBLIC = "";
    const { featureFlags } = await import("@/lib/feature-flags");
    expect(featureFlags.phase44Public).toBe(false);
  });

  it("phase44Public is false for the string 'false'", async () => {
    (import.meta.env as Record<string, unknown>).VITE_PHASE_4_4_PUBLIC = "false";
    const { featureFlags } = await import("@/lib/feature-flags");
    expect(featureFlags.phase44Public).toBe(false);
  });

  it("phase44Public flips to true when env var is the string 'true'", async () => {
    (import.meta.env as Record<string, unknown>).VITE_PHASE_4_4_PUBLIC = "true";
    const { featureFlags } = await import("@/lib/feature-flags");
    expect(featureFlags.phase44Public).toBe(true);
  });

  it("phase44Public flips to true for '1' and 'yes' as well", async () => {
    (import.meta.env as Record<string, unknown>).VITE_PHASE_4_4_PUBLIC = "1";
    const a = await import("@/lib/feature-flags");
    expect(a.featureFlags.phase44Public).toBe(true);

    vi.resetModules();
    (import.meta.env as Record<string, unknown>).VITE_PHASE_4_4_PUBLIC = "yes";
    const b = await import("@/lib/feature-flags");
    expect(b.featureFlags.phase44Public).toBe(true);
  });
});
