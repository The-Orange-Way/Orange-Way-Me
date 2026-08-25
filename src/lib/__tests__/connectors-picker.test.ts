import { describe, it, expect } from "vitest";
import { CONNECTORS, PICKER_CONNECTORS, buildPickerConnectors } from "../connectors";
import type { Connector } from "../connectors";

/**
 * DL-1429. A tester in Europe asked why there is no way to connect a bank.
 *
 * The Add Account picker rendered in import order, which put a disabled
 * "Coming soon" tile above a working one, and the only tile carrying the word
 * "bank" was the disabled one. The tile that does reach the bank route
 * described itself as Bitcoin wallets and exchanges, so the route existed and
 * had no signpost.
 *
 * The picker itself is a React component and this repo has no DOM test stack
 * by design, so these pin the two things a pure test can hold: the order the
 * picker is handed, and the copy the tiles carry.
 */

const connector = (over: Partial<Connector> & Pick<Connector, "type">): Connector =>
  ({
    label: over.type,
    icon: "Wallet",
    description: "",
    FlowComponent: () => null,
    ...over,
  }) as unknown as Connector;

describe("buildPickerConnectors", () => {
  it("puts every connector that is not wired up below every one that is", () => {
    const out = buildPickerConnectors(
      [
        connector({ type: "simplefin", comingSoon: true }),
        connector({ type: "manual" }),
        connector({ type: "csv" }),
      ],
      false,
    );
    expect(out.map((c) => c.type)).toEqual(["manual", "csv", "simplefin"]);
  });

  it("keeps the relative order of the working connectors", () => {
    const out = buildPickerConnectors(
      [connector({ type: "manual" }), connector({ type: "csv" })],
      false,
    );
    expect(out.map((c) => c.type)).toEqual(["manual", "csv"]);
  });

  it("shows the Orange Rails entry when the build enabled it", () => {
    const out = buildPickerConnectors([connector({ type: "orange_rails" })], true);
    expect(out.map((c) => c.type)).toEqual(["orange_rails"]);
  });

  it("hides the Orange Rails entry when the build did not enable it", () => {
    const out = buildPickerConnectors([connector({ type: "orange_rails" })], false);
    expect(out).toEqual([]);
  });

  it("does not reorder the registry it was handed", () => {
    const before = CONNECTORS.map((c) => c.type);
    buildPickerConnectors(CONNECTORS, true);
    expect(CONNECTORS.map((c) => c.type)).toEqual(before);
  });
});

describe("the picker copy names a route the customer can actually take", () => {
  const bySlug = (t: string) => {
    const c = CONNECTORS.find((x) => x.type === t);
    if (!c) throw new Error(`missing connector: ${t}`);
    return c;
  };

  it("names banks on the tile that reaches the bank route", () => {
    const or = bySlug("orange_rails");
    expect(or.navigateTo).toBe("/connections");
    expect(or.comingSoon).toBeFalsy();
    expect(or.description.toLowerCase()).toContain("bank");
  });

  it("sends the disabled bank tile at the working route instead of nowhere", () => {
    const sf = bySlug("simplefin");
    expect(sf.comingSoon).toBe(true);
    expect(sf.description).toContain(bySlug("orange_rails").label);
  });

  it("exports a picker list that is a subset of the registry", () => {
    for (const c of PICKER_CONNECTORS) expect(CONNECTORS).toContain(c);
  });
});
