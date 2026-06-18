import type { Account, Connector } from "./types";
import { XpubFlow } from "./flows/XpubFlow";
import { fetchXpubBalanceBtc } from "./xpub-api";

export const xpubConnector: Connector = {
  type: "xpub",
  label: "Bitcoin wallet (xpub)",
  icon: "Bitcoin",
  description: "Watch an xpub / ypub / zpub. Read-only, no spending keys.",
  FlowComponent: XpubFlow,
  refreshBalance: async (account: Account) => {
    const xpub = (account.metadata?.xpub as string | undefined) ?? "";
    if (!xpub) throw new Error("This account has no xpub on file.");
    return fetchXpubBalanceBtc(xpub);
  },
};
