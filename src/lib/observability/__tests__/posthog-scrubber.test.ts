import { describe, expect, it } from "vitest";
import { scrubPostHogEvent } from "@/lib/observability/posthog-scrubber";

// Minimal stand-in for posthog-js's CaptureResult: the scrubber
// only touches .properties so the rest of the shape can be ignored
// in tests. Cast through unknown to satisfy the function signature
// without pulling the SDK's full type surface into the test.
function event(properties: Record<string, unknown>) {
  return scrubPostHogEvent({
    uuid: "00000000-0000-0000-0000-000000000000",
    event: "test",
    properties,
  } as unknown as Parameters<typeof scrubPostHogEvent>[0]);
}

describe("posthog scrubber", () => {
  it("redacts the reserved auto-capture keys", () => {
    const r = event({ $ip: "1.2.3.4", $browser: "Chrome", normal: "ok" });
    expect(r?.properties.$ip).toBe("[redacted]");
    expect(r?.properties.$browser).toBe("[redacted]");
    expect(r?.properties.normal).toBe("ok");
  });

  it("redacts substring-hint keys (account, household, ...)", () => {
    const r = event({ account_id: "abc", random: 1 });
    expect(r?.properties.account_id).toBe("[redacted]");
    expect(r?.properties.random).toBe(1);
  });

  it("does NOT redact innocent keys that lack a $ prefix or hint", () => {
    const r = event({ window_width: 1024, page_count: 3 });
    expect(r?.properties.window_width).toBe(1024);
    expect(r?.properties.page_count).toBe(3);
  });

  it("scrubs URL query strings on $current_url", () => {
    const r = event({ $current_url: "https://x.test/route?a=1" });
    expect(r?.properties.$current_url).toBe("https://x.test/route?[redacted]");
  });

  it("scrubs URL fragments on $current_url", () => {
    const r = event({ $current_url: "https://x.test/route#token=xyz" });
    expect(r?.properties.$current_url).toBe("https://x.test/route#[redacted]");
  });

  it("recurses into nested objects and redacts sensitive keys inside", () => {
    const r = event({
      ctx: { transaction_memo: "buy coffee", label: "innocent" },
    });
    const ctx = r?.properties.ctx as Record<string, unknown>;
    expect(ctx.transaction_memo).toBe("[redacted]");
    expect(ctx.label).toBe("innocent");
  });

  it("recurses into arrays of objects", () => {
    const r = event({
      items: [
        { account_balance: 100, label: "a" },
        { account_balance: 200, label: "b" },
      ],
    });
    const items = r?.properties.items as Record<string, unknown>[];
    expect(items[0].account_balance).toBe("[redacted]");
    expect(items[1].account_balance).toBe("[redacted]");
  });

  it("stops at the depth cap and redacts any further nesting", () => {
    const deep = { a: { b: { c: { d: { e: { secret: "x" } } } } } };
    const r = event(deep);
    // The cap is 4, so by the 5th level the deeper object is redacted.
    let cur: unknown = r?.properties.a;
    for (const key of ["b", "c", "d"]) {
      cur = (cur as Record<string, unknown>)[key];
    }
    // cur is the object at depth 4 ({ e: { secret: "x" } }); its inner
    // object should now be the [redacted-deep] sentinel.
    expect((cur as Record<string, unknown>).e).toBe("[redacted-deep]");
  });

  it("caps long strings at 256 chars with an ellipsis", () => {
    const long = "a".repeat(300);
    const r = event({ notes_field_x: long });
    // notes_field_x will be substring-redacted by "notes"; pick a
    // non-hint key for the truncation test.
    const r2 = event({ payload: long });
    expect((r2?.properties.payload as string).endsWith("…")).toBe(true);
    expect((r2?.properties.payload as string).length).toBe(257);
    // sanity: the redacted form still works
    expect(r?.properties.notes_field_x).toBe("[redacted]");
  });

  it("passes null events through unchanged", () => {
    expect(scrubPostHogEvent(null)).toBeNull();
  });
});
