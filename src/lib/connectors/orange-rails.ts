import type { Connector } from "./types";
import { ComingSoonFlow } from "./flows/ComingSoonFlow";

/**
 * OrangeRails is a navigation tile, not a flow tile.
 *
 * The full OR connect flow (provider creds → wallet picker →
 * destination mapping) is multi-step, vault-bound, and routes through
 * the bb-or-proxy edge function — none of which fit cleanly inside
 * the AddAccountDialog's single-modal flow. So clicking the
 * OrangeRails tile in the picker just navigates to /connections,
 * where the full flow lives.
 *
 * `comingSoon` is intentionally false: OR is live. Removing the
 * coming-soon badge fixes the misleading UX where users were told to
 * wait for an integration that already exists. `FlowComponent` is
 * still set (to the inert ComingSoonFlow) only because the type
 * requires it; the AddAccountDialog never renders it when
 * `navigateTo` is present.
 */
export const orangeRailsConnector: Connector = {
  type: "orange_rails",
  label: "OrangeRails",
  icon: "Plug",
  description: "Connect Bitcoin wallets and exchanges (Blink today; xpub, BTCPay, more soon).",
  navigateTo: "/connections",
  FlowComponent: ComingSoonFlow,
};
