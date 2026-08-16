/**
 * DL-1113.
 *
 * Provenance of the fixtures, because DL-1114 is the reason this file says so
 * out loud: the response shape below is a RECORDED one. `stability-probe.js`
 * drove the deployed dev app through eight reload rounds and logged every
 * `ow-or-proxy` answer by shape, and every round produced
 *
 *   arrays {"connections":[...]} scalars {"stealth_unavailable":false}
 *
 * So the field name, its position (top level, sibling of `connections`) and
 * its type are all observed rather than invented.
 *
 * What is NOT observed: the `true` case. No degradation has been provoked on
 * dev, so the true-branch tests below assert on a payload built by flipping a
 * recorded false to true. That is a smaller leap than inventing a shape, and it
 * is still a leap. Do not upgrade this comment to "verified" without a
 * recording.
 */
import { describe, it, expect } from "vitest";
import { describeStealthAvailability, readStealthUnavailable } from "../availability";

/**
 * Shape as recorded from deployed dev, trimmed to the fields under test. The
 * shape is what this fixture is for; the id inside it is not under test and is
 * never parsed, so it uses the reserved repeated-block pattern the rest of the
 * suite uses (11111111-..., 22222222-...).
 */
const RECORDED_HEALTHY = {
  connections: [{ id: "dddddddd-dddd-dddd-dddd-dddddddddddd" }],
  stealth_unavailable: false,
};

describe("readStealthUnavailable", () => {
  it("reads false from the recorded healthy response", () => {
    expect(readStealthUnavailable(RECORDED_HEALTHY)).toBe(false);
  });

  it("reads true when the arm reports itself down", () => {
    expect(readStealthUnavailable({ ...RECORDED_HEALTHY, stealth_unavailable: true })).toBe(true);
  });

  it("treats an absent flag as available, so an older backend gets no banner", () => {
    expect(readStealthUnavailable({ connections: [] })).toBe(false);
  });

  it("treats non-boolean values as available rather than alarming the user", () => {
    // The quiet direction is the safe one here: a stray truthy value would
    // tell someone their wallets are gone while those wallets are on screen.
    for (const v of ["true", 1, {}, [], "yes"]) {
      expect(readStealthUnavailable({ connections: [], stealth_unavailable: v })).toBe(false);
    }
  });

  it("survives a response that is not an object at all", () => {
    for (const v of [null, undefined, "", 0, "nope"]) {
      expect(readStealthUnavailable(v)).toBe(false);
    }
  });
});

describe("describeStealthAvailability", () => {
  it("says nothing at all when the arm is healthy", () => {
    expect(
      describeStealthAvailability({ stealthUnavailable: false, connectionCount: 2 }),
    ).toBeNull();
    expect(
      describeStealthAvailability({ stealthUnavailable: false, connectionCount: 0 }),
    ).toBeNull();
  });

  it("reports an incomplete list when other connections survived", () => {
    const n = describeStealthAvailability({ stealthUnavailable: true, connectionCount: 2 });
    expect(n).not.toBeNull();
    expect(n!.detail).toMatch(/incomplete/i);
    expect(n!.detail).toMatch(/nothing is lost/i);
    expect(n!.retryLabel).toBe("Try again");
  });

  it("tells a user with nothing left NOT to re-add, which is the whole point", () => {
    // This is the case that can cost someone a duplicate they cannot delete
    // while DL-1079 is open. If this assertion is ever relaxed, read DL-1079
    // first.
    const n = describeStealthAvailability({ stealthUnavailable: true, connectionCount: 0 });
    expect(n).not.toBeNull();
    expect(n!.detail).toMatch(/don't add it again/i);
    expect(n!.detail).toMatch(/come back on its own/i);
  });

  it("never uses alarming words, because nothing is actually lost", () => {
    for (const connectionCount of [0, 3]) {
      const n = describeStealthAvailability({ stealthUnavailable: true, connectionCount });
      const all = `${n!.headline} ${n!.detail}`;
      expect(all).not.toMatch(/error|failed|lost your|deleted|gone forever/i);
    }
  });

  it("gives the same non-alarming headline either way", () => {
    const a = describeStealthAvailability({ stealthUnavailable: true, connectionCount: 0 })!;
    const b = describeStealthAvailability({ stealthUnavailable: true, connectionCount: 5 })!;
    expect(a.headline).toBe(b.headline);
    expect(a.detail).not.toBe(b.detail);
  });
});
