/**
 * @vitest-environment node
 *
 * Pins "which condition is blocking Create vault" to the submit gate.
 *
 * The defect this guards: `canSubmit` requires length AND strength AND a
 * matching confirm AND the acknowledgement, but the on-screen explanation
 * covered only strength, and even that rendered conditionally on the scorer
 * having advice to give. A customer with a mismatched confirm field got a
 * dead button and a blank form.
 *
 * Both halves matter. Every condition needs a case here, so a fifth
 * condition added to `canSubmit` and not to `vaultGateBlocker` shows up as a
 * failure rather than as a silent button. And exactly one hint may be live at
 * a time, which is what the component's render guards depend on.
 *
 * Wording is deliberately not asserted. The copy belongs to the copywriter
 * and changes without changing behaviour; the codes are the contract.
 */

import { describe, it, expect } from "vitest";
import { vaultGateBlocker, type VaultGateState } from "@/lib/vault-gate";

const READY: VaultGateState = {
  password: "correct horse battery staple",
  confirm: "correct horse battery staple",
  strongEnough: true,
  understood: true,
  minLength: 14,
};

describe("vaultGateBlocker", () => {
  it("returns null when every condition is met", () => {
    expect(vaultGateBlocker(READY)).toBeNull();
  });

  it("says nothing before the customer has typed anything", () => {
    expect(vaultGateBlocker({ ...READY, password: "", confirm: "", understood: false })).toBeNull();
  });

  it("reports length while the password is too short", () => {
    expect(vaultGateBlocker({ ...READY, password: "short", confirm: "short" })).toBe("length");
  });

  it("reports strength once the password is long enough but still weak", () => {
    expect(vaultGateBlocker({ ...READY, strongEnough: false })).toBe("strength");
  });

  it("does not blame strength for a short password", () => {
    // The bug that prompted the length case: a five-character password was
    // told it needed to be stronger, when what it needed was to be longer.
    expect(
      vaultGateBlocker({ ...READY, password: "abc", confirm: "abc", strongEnough: false }),
    ).toBe("length");
  });

  it("reports mismatch, which previously showed nothing at all", () => {
    expect(vaultGateBlocker({ ...READY, confirm: "something else entirely" })).toBe("mismatch");
  });

  it("treats an empty confirm field as not-yet-filled, not as a mismatch", () => {
    expect(vaultGateBlocker({ ...READY, confirm: "" })).toBeNull();
  });

  it("reports the unticked acknowledgement, which previously showed nothing at all", () => {
    expect(vaultGateBlocker({ ...READY, understood: false })).toBe("acknowledgement");
  });

  it("does not ask for the acknowledgement while the confirm field disagrees", () => {
    // Exactly one hint at a time: the component renders each on its own
    // guard, and two visible at once is the thing this ordering prevents.
    expect(vaultGateBlocker({ ...READY, confirm: "nope", understood: false })).toBe("mismatch");
  });

  it("covers every condition in canSubmit", () => {
    const seen = new Set(
      [
        vaultGateBlocker({ ...READY, password: "abc", confirm: "abc" }),
        vaultGateBlocker({ ...READY, strongEnough: false }),
        vaultGateBlocker({ ...READY, confirm: "nope" }),
        vaultGateBlocker({ ...READY, understood: false }),
      ].filter(Boolean),
    );
    expect(seen).toEqual(new Set(["length", "strength", "mismatch", "acknowledgement"]));
  });
});
