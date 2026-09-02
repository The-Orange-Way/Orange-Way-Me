/**
 * Single-connection Sync press dispatch, contract tests.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM sync-route.test.ts (OWM-T0544). That
 * file proves planSyncRoute answers "private" for a private connection. It
 * proves nothing about anybody ACTING on the answer, and until this change
 * nothing did: the four lines in ConnectionsPage.handleSync that sent a
 * private connection to handleStealthSync could be deleted and the entire
 * repository's test suite stayed green. The rule was defended in a module the
 * defect never lived in.
 *
 * So every test here is about the dispatch, and most of them assert an
 * ABSENCE. The defect was never a wrong return value: it was a press arriving
 * at the one arm that exports the Orange Rails credentials key and the
 * transactions key from the vault.
 */

import { describe, it, expect, vi } from "vitest";
import { dispatchSyncPress, type SyncPressActions, type SyncRouteCandidate } from "../sync-route";

/**
 * One spy per arm. Spies rather than a recorded route string, because the
 * question is which arm RAN, and an arm that did not run is exactly what has
 * to be provable here.
 */
function arms() {
  return {
    bank: vi.fn(),
    private: vi.fn(),
    orSync: vi.fn(),
  };
}

describe("dispatchSyncPress", () => {
  it("runs the private arm, and no other arm, for every private shape", async () => {
    const privateShapes: SyncRouteCandidate[] = [
      { is_stealth: true },
      { is_stealth: true, provider_type: "blink" },
      { is_stealth: true, provider_type: "strike" },
      { is_stealth: true, provider_type: null },
      { is_stealth: true, provider_type: undefined },
    ];

    for (const conn of privateShapes) {
      const actions = arms();
      const route = await dispatchSyncPress(conn, actions);

      expect(route).toBe("private");
      expect(actions.private).toHaveBeenCalledTimes(1);
      // THE ASSERTION THAT MATTERS. or-sync is the only arm that exports vault
      // keys, and a private connection must never reach it.
      expect(actions.orSync).not.toHaveBeenCalled();
      expect(actions.bank).not.toHaveBeenCalled();
    }
  });

  it("keeps a private connection off the or-sync arm in both states of the kill switch", async () => {
    // The switch is modelled where it actually lives, inside the private arm:
    // handleStealthSync awaits refreshRuntimeFlags and either scans or refuses
    // above the key export. Whichever it does, the press has already stopped
    // being the or-sync path's problem. The original defect (OWM-T0530) was
    // the opposite: an off switch moved the press ONTO the key-exporting arm.
    const observed: string[] = [];
    const armBehaviours = [
      async () => {
        observed.push("switch on: the widget scan started");
      },
      async () => {
        observed.push("switch off: the private arm refused, no key exported");
      },
    ];

    for (const behaviour of armBehaviours) {
      const actions = { bank: vi.fn(), private: vi.fn(behaviour), orSync: vi.fn() };
      await dispatchSyncPress({ is_stealth: true }, actions);

      expect(actions.private).toHaveBeenCalledTimes(1);
      expect(actions.orSync).not.toHaveBeenCalled();
    }

    // Both arms really ran; a loop that silently executed neither would
    // otherwise satisfy every assertion above.
    expect(observed).toHaveLength(2);
  });

  it("runs the or-sync arm for an ordinary Bitcoin source", async () => {
    const actions = arms();
    const route = await dispatchSyncPress({ provider_type: "blink", is_stealth: false }, actions);

    expect(route).toBe("or-sync");
    expect(actions.orSync).toHaveBeenCalledTimes(1);
    expect(actions.private).not.toHaveBeenCalled();
    expect(actions.bank).not.toHaveBeenCalled();
  });

  it("runs the bank arm for a bank connection", async () => {
    const actions = arms();
    const route = await dispatchSyncPress({ provider_type: "quiltt" }, actions);

    expect(route).toBe("bank");
    expect(actions.bank).toHaveBeenCalledTimes(1);
    expect(actions.orSync).not.toHaveBeenCalled();
    expect(actions.private).not.toHaveBeenCalled();
  });

  it("waits for the arm it chose before returning", async () => {
    // A dropped await would return while the scan is still starting, and the
    // caller would treat an unfinished press as a finished one.
    let armFinished = false;
    const actions = {
      bank: vi.fn(),
      private: vi.fn(async () => {
        await Promise.resolve();
        armFinished = true;
      }),
      orSync: vi.fn(),
    };

    await dispatchSyncPress({ is_stealth: true }, actions);

    expect(armFinished).toBe(true);
  });

  it("cannot be given the kill switch as an input", () => {
    // Structural, same reason as the arity pin on planSyncRoute. No assertion
    // about behaviour catches a third parameter coming back, because it would
    // be undefined in every test above and all of them would still pass.
    //
    // If you are here because this failed: the switch must not decide which
    // arm runs. It belongs inside the private arm, above the key export, where
    // an off switch refuses instead of redirecting.
    expect(dispatchSyncPress.length).toBe(2);
  });

  it("does not accept an actions object with the private arm missing", () => {
    // THE PIN THAT REPLACES THE MISSING TEST. Deleting the private arm from
    // the call site in ConnectionsPage.handleSync used to fail nothing at all.
    // It is now a type error, so it fails `bunx tsc --noEmit` in the Lint +
    // build job. If this line ever stops erroring, the ts-expect-error below
    // becomes an unused directive and this test file stops compiling, which is
    // the loud version of the silence this whole ticket is about.
    const withoutPrivateArm = { bank: vi.fn(), orSync: vi.fn() };
    // @ts-expect-error the private arm is required and a call site may not omit it
    const actions: SyncPressActions = withoutPrivateArm;

    expect(typeof actions.bank).toBe("function");
  });
});
