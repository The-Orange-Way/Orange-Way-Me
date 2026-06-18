import type { Connector, ConnectorType } from "./types";
import { manualConnector } from "./manual";
import { csvConnector } from "./csv";
import { xpubConnector } from "./xpub";
import { simplefinConnector } from "./simplefin";
import { orangeRailsConnector } from "./orange-rails";

export const CONNECTORS: Connector[] = [
  manualConnector,
  csvConnector,
  xpubConnector,
  simplefinConnector,
  orangeRailsConnector,
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
