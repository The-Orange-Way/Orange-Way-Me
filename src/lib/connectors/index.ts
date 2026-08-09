import type { Connector, ConnectorType } from "./types";
import { manualConnector } from "./manual";
import { csvConnector } from "./csv";
import { simplefinConnector } from "./simplefin";
import { orangeRailsConnector } from "./orange-rails";

// Same build-time flag the ConnectionsPage button uses
// (VITE_OR_CONNECT_ENABLED in deploy.yml): "true" on dev, empty on prod.
const OR_CONNECT_ENABLED = import.meta.env.VITE_OR_CONNECT_ENABLED === "true";

// Registry is TOTAL and unconditional. Every connector that any stored account
// can reference MUST resolve here, or getConnector throws and AccountDetailPage
// and useAccounts crash for live accounts of that type (the orange_rails
// accounts already on prod). Never gate this list.
export const CONNECTORS: Connector[] = [
  manualConnector,
  csvConnector,
  simplefinConnector,
  orangeRailsConnector,
];

// Picker surface (Add Account dialog) is a SUBSET gated by environment. #177
// gated only the ConnectionsPage button; the connector still surfaced in the
// Add Account dialog, a second route to the broken XPUB sync screen on prod.
// This hides the Orange Rails entry from the picker where it is not provisioned
// (empty flag on prod) while resolution above stays total, so existing
// orange_rails accounts still render.
export const PICKER_CONNECTORS: Connector[] = CONNECTORS.filter(
  (c) => c.type !== "orange_rails" || OR_CONNECT_ENABLED,
);

export function getConnector(type: ConnectorType): Connector {
  const c = CONNECTORS.find((x) => x.type === type);
  if (!c) throw new Error(`Unknown connector: ${type}`);
  return c;
}

export type {
  Connector,
  ConnectorType,
  Account,
  AccountDraft,
  TransactionDraft,
  AccountTypeKey,
  ConnectorFlowProps,
} from "./types";
