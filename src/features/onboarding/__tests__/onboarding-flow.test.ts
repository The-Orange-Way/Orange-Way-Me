import { describe, it, expect } from "vitest";
import { resolvePopState } from "../onboarding-flow";

// A minimal 4-step registry: steps 0-1 are reversible, 2-3 are one-way
// (simulating vault-creation and recovery-code screens).
const STEPS = [
  { id: "name", title: "Name" },
  { id: "email", title: "Email" },
  { id: "vault-password", title: "Set password", oneWay: true },
  { id: "recovery", title: "Recovery code", oneWay: true },
];

describe("resolvePopState — oneWay guard fires before state-shape check", () => {
  it("re-pushes when state is null and current step is one-way", () => {
    // Browser-native back entry (no owStep) while on vault-password (oneWay).
    // Before the fix, line 170 returned early and the re-push never happened.
    expect(resolvePopState(null, 2, STEPS)).toEqual({
      type: "stay",
      pushStep: 2,
    });
  });

  it("re-pushes when state is a foreign object and current step is one-way", () => {
    // An entry from before the wizard opened carries arbitrary state.
    expect(resolvePopState({ foo: "bar" }, 3, STEPS)).toEqual({
      type: "stay",
      pushStep: 3,
    });
  });

  it("re-pushes even when a valid owStep is present if current step is one-way", () => {
    // User navigated forward past a one-way step; browser back sends a valid
    // owStep pointing to the previous screen. Still must refuse.
    expect(resolvePopState({ owStep: 1 }, 2, STEPS)).toEqual({
      type: "stay",
      pushStep: 2,
    });
  });

  it("returns null (ignore) when state is null and step is not one-way", () => {
    expect(resolvePopState(null, 1, STEPS)).toBeNull();
  });

  it("returns null when state has no owStep and step is not one-way", () => {
    expect(resolvePopState({ foo: "bar" }, 0, STEPS)).toBeNull();
  });
});

describe("resolvePopState — owStep bounds clamp prevents blank screen", () => {
  it("moves to the exact step when owStep is in range", () => {
    expect(resolvePopState({ owStep: 1 }, 0, STEPS)).toEqual({
      type: "move",
      index: 1,
    });
  });

  it("clamps an owStep past the end to the last valid index", () => {
    // Registry shrank (biometric removal removed a step); stale history entry
    // carries owStep=99. Before the fix this produced `active = undefined`
    // at render, returning null — blank screen with no recovery.
    expect(resolvePopState({ owStep: 99 }, 0, STEPS)).toEqual({
      type: "move",
      index: 3,
    });
  });

  it("clamps a negative owStep to 0", () => {
    expect(resolvePopState({ owStep: -5 }, 1, STEPS)).toEqual({
      type: "move",
      index: 0,
    });
  });
});
