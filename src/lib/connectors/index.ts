import type { Connector, ConnectorType } from "./types";
import { manualConnector } from "./manual";
import { csvConnector } from "./csv";
import { simplefinConnector } from "./simplefin";
import { orangeRailsConnector } from "./orange-rails";

// Gate the Orange Rails stealth-sync connector to environments where it is
// provisioned. Same build-time flag the ConnectionsPage button uses
// (VITE_OR_CONNECT_ENABLED in deploy.yml): "true" on dev, empty on prod.
// #177 gated only the ConnectionsPage button, but the connector still
// surfaced in the Add Account dialog (AddAccountDialog maps over CONNECTORS),
// a second route to the broken XPUB sync screen on prod. Gating the registry
// removes it from every surface at once. An absent or empty flag folds the
// compare to false, so the prod bundle registers only the always-on connectors.
const OR_CONNECT_ENABLED = import.meta.env.VITE_OR_CONNECT_ENABLED === "true";

export const CONNECTORS: Connector[] = [
  manualConnector,
  csvConnector,
  simplefinConnector,
  ...(OR_CONNECT_ENABLED ? [orangeRailsConnector] : []),
];

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
