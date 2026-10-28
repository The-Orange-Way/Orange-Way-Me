/**
 * OWM-T0772: the dashboard goals card must format its figures in the user's
 * primary currency.
 *
 * computeProgress(goal, accounts, primaryCurrency) returns current and target
 * already converted to primaryCurrency. Formatting them with the linked
 * account's own currency re-reads a converted dollar figure as a sats or BTC
 * amount. This renders the card for a goal linked to a Bitcoin account and
 * pins the currency that reaches the formatter.
 *
 * The data hooks, the router link and the math module are mocked so the test
 * exercises only the card's own formatting wiring. It renders to static
 * markup, so it runs in the node test environment without a DOM.
 */
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GoalsProgressWidget } from "../GoalsProgressWidget";

const state = vi.hoisted(() => ({
  linkedCurrency: "BTC",
  primaryCurrency: "USD",
  formatCurrency: vi.fn((amount: number, currency: string) => `${currency}|${amount}`),
}));

vi.mock("@tanstack/react-router", async () => {
  const React = await import("react");
  return {
    Link: (props: { to: string; children?: ReactNode }) =>
      React.createElement("a", { href: props.to }, props.children),
  };
});

vi.mock("@/hooks/useGoals", () => ({
  useGoals: () => ({
    loading: false,
    goals: [
      {
        id: "goal-1",
        name: "Save for a car",
        is_completed: false,
        linked_account_ids: ["acct-1"],
      },
    ],
  }),
}));

vi.mock("@/hooks/useAccounts", () => ({
  useAccounts: () => ({ accounts: [{ id: "acct-1", currency: state.linkedCurrency }] }),
}));

vi.mock("@/hooks/useDashboardPrefs", () => ({
  useDashboardPrefs: () => ({ prefs: { primaryCurrency: state.primaryCurrency } }),
}));

vi.mock("@/lib/locale", () => ({
  useLocaleFormat: () => ({ formatCurrency: state.formatCurrency }),
}));

// A 0.25 BTC account at 65000 USD per BTC is 16250 USD, against a 32500 USD
// target. computeProgress hands these back already in the primary currency.
vi.mock("@/lib/goals-math", () => ({
  computeProgress: () => ({
    pct: 0.5,
    current: 16250,
    target: 32500,
    untrackableReason: null,
  }),
}));

function renderCard(): string {
  return renderToStaticMarkup(createElement(GoalsProgressWidget));
}

describe("GoalsProgressWidget currency (OWM-T0772)", () => {
  beforeEach(() => {
    state.formatCurrency.mockClear();
    state.linkedCurrency = "BTC";
    state.primaryCurrency = "USD";
  });

  it("formats a BTC-linked goal in the primary currency, not the account currency", () => {
    const html = renderCard();
    expect(html).toContain("USD|16250");
    expect(html).toMatch(/of (<!-- -->)?USD\|32500/);
    expect(html).not.toContain("BTC|");
  });

  it("never hands the linked account currency to the formatter", () => {
    renderCard();
    const currencies = state.formatCurrency.mock.calls.map((call) => call[1]);
    expect(currencies).toEqual(["USD", "USD"]);
  });

  it("follows the primary currency when it is not USD", () => {
    state.primaryCurrency = "EUR";
    const html = renderCard();
    expect(html).toContain("EUR|16250");
    expect(html).not.toContain("BTC|");
  });
});
