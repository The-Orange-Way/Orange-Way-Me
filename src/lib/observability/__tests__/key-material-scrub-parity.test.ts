import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  KEY_MATERIAL_FIELDS,
  extractColumnNames,
  keyMaterialColumns,
  looksLikeKeyMaterial,
  uncoveredByInventory,
} from "@/lib/observability/key-material-fields";
import { scrubPostHogEvent } from "@/lib/observability/posthog-scrubber";
import { isSecretKey } from "@/lib/observability/sentry";

/**
 * Minimal stand-in for posthog-js's CaptureResult, matching the helper already
 * used in posthog-scrubber.test.ts. The scrubber only touches .properties.
 */
function event(properties: Record<string, unknown>) {
  return scrubPostHogEvent({
    uuid: "00000000-0000-0000-0000-000000000000",
    event: "test",
    properties,
  } as unknown as Parameters<typeof scrubPostHogEvent>[0]);
}

function posthogRedacts(key: string): boolean {
  const r = event({ [key]: "sensitive-value" });
  return r?.properties[key] === "[redacted]";
}

const TYPES_PATH = fileURLToPath(
  new URL("../../../integrations/supabase/types.ts", import.meta.url),
);

describe("key-material inventory: both scrubbers", () => {
  // The whole point of the inventory: ONE list, and the two independently
  // maintained scrubbers are both measured against it. A name added to one
  // list and forgotten in the other used to look exactly like coverage.
  it.each(KEY_MATERIAL_FIELDS.map((f) => [f]))(
    "PostHog redacts a property named %s",
    (field) => {
      expect(posthogRedacts(field)).toBe(true);
      expect(posthogRedacts(`wallet_${field}`)).toBe(true);
    },
  );

  it.each(KEY_MATERIAL_FIELDS.map((f) => [f]))("Sentry redacts a key named %s", (field) => {
    expect(isSecretKey(field)).toBe(true);
    expect(isSecretKey(`wallet_${field}`)).toBe(true);
  });

  // Named explicitly, not only as part of the loop above, because these two
  // are the concrete residual gap this change was filed to close.
  it("PostHog redacts passphrase and entropy", () => {
    const r = event({
      passphrase: "correct horse battery staple",
      entropy: "0f9a1b...",
      label: "safe context",
    });

    expect(r?.properties.passphrase).toBe("[redacted]");
    expect(r?.properties.entropy).toBe("[redacted]");
    expect(r?.properties.label).toBe("safe context");
  });
});

describe("key-material inventory: anchored names do not over-match", () => {
  // pin and salt are matched as whole words. A bare substring "pin" also
  // matches shipping_address and spinner_state; blanking those costs analytics
  // and incident-response signal for no security gain, which is the same class
  // of harm as the leak, one direction over.
  it("PostHog does not redact words that merely contain pin or salt", () => {
    const r = event({
      shipping_address: "123 Main St",
      spinner_state: "loading",
      basalt_theme: "dark",
    });

    expect(r?.properties.shipping_address).toBe("123 Main St");
    expect(r?.properties.spinner_state).toBe("loading");
    expect(r?.properties.basalt_theme).toBe("dark");
  });

  it("PostHog still redacts pin and salt as whole words", () => {
    const r = event({ pin: "1234", user_pin: "1234", kdf_salt: "abc", salt: "abc" });

    expect(r?.properties.pin).toBe("[redacted]");
    expect(r?.properties.user_pin).toBe("[redacted]");
    expect(r?.properties.kdf_salt).toBe("[redacted]");
    expect(r?.properties.salt).toBe("[redacted]");
  });
});

describe("key-material inventory: the schema ratchet", () => {
  const source = readFileSync(TYPES_PATH, "utf8");

  it("actually parsed the generated types file", () => {
    // A ratchet that reads zero columns reports a clean result forever. This
    // is the negative control on the read itself: the generated types carry
    // hundreds of column names, so a handful means the parse broke.
    expect(extractColumnNames(source).length).toBeGreaterThan(50);
  });

  it("every key-material-looking column in the schema is named by the inventory", () => {
    const columns = keyMaterialColumns(source);
    const uncovered = uncoveredByInventory(columns, KEY_MATERIAL_FIELDS);

    expect(
      uncovered,
      `These columns look like key material and no entry of KEY_MATERIAL_FIELDS covers them. ` +
        `Add them to src/lib/observability/key-material-fields.ts and to BOTH scrubbers: ` +
        uncovered.join(", "),
    ).toEqual([]);
  });

  it("every key-material-looking column is redacted by both scrubbers", () => {
    for (const column of keyMaterialColumns(source)) {
      expect(posthogRedacts(column), `PostHog does not redact ${column}`).toBe(true);
      expect(isSecretKey(column), `Sentry does not redact ${column}`).toBe(true);
    }
  });

  it("the ratchet can fail: an unnamed key-material column is reported", () => {
    // Proof that the two checks above can go red, using a synthetic types file
    // and a deliberately incomplete inventory. Without this, a broken matcher
    // would report a clean schema and read as a pass.
    const synthetic = [
      "      Row: {",
      "        id: string",
      "        wallet_mnemonic_backup: string | null",
      "        display_label: string | null",
      "      }",
    ].join("\n");

    const columns = keyMaterialColumns(synthetic);
    expect(columns).toContain("wallet_mnemonic_backup");
    expect(columns).not.toContain("display_label");
    expect(uncoveredByInventory(columns, ["seed"])).toContain("wallet_mnemonic_backup");
    expect(uncoveredByInventory(columns, KEY_MATERIAL_FIELDS)).toEqual([]);
  });

  it("token matching does not treat ordinary columns as key material", () => {
    expect(looksLikeKeyMaterial("shipping_address")).toBe(false);
    expect(looksLikeKeyMaterial("spinner_state")).toBe(false);
    expect(looksLikeKeyMaterial("wallet_seed_backup")).toBe(true);
    expect(looksLikeKeyMaterial("kdf_salt")).toBe(true);
  });
});

describe("key-material inventory: both scrubbers fail closed", () => {
  it("PostHog drops the event when scrubbing throws", () => {
    // A half-scrubbed event is worse than no event: it reaches the network
    // carrying whatever the scrubber had not got to yet. Sentry already drops
    // on throw (sentry.ts beforeSend). PostHog must do the same, and returning
    // null from before_send is documented to drop the event.
    const props: Record<string, unknown> = { safe: "ok" };
    Object.defineProperty(props, "hostile", {
      enumerable: true,
      get() {
        throw new Error("property getter blew up mid-scrub");
      },
    });

    expect(event(props)).toBeNull();
  });
});
