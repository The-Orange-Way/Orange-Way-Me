import type { Connector, ConnectorType } from "./types";
import { manualConnector } from "./manual";
import { csvConnector } from "./csv";
import { simplefinConnector } from "./simplefin";
import { orangeRailsConnector } from "./orange-rails";

// Same build-time flag the ConnectionsPage button uses (VITE_OR_CONNECT_ENABLED
// in deploy.yml). It is set to "true" on BOTH the dev and prod branches. It is
// empty only for a build off some other branch, or a local build that does not
// set it.
//
// An earlier version of this comment said the flag was "empty on prod". That is
// not what deploy.yml does, so do not read the filter below as a prod kill
// switch: on prod the Orange Rails entry is shown.
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

/**
 * The Add Account picker surface. A SUBSET of the registry above, in an order
 * chosen for the customer rather than inherited from the import list.
 *
 * Two properties, both of which were defects before:
 *
 * 1. Anything not wired up yet sorts BELOW every working route. The picker
 *    renders a comingSoon tile disabled, so somebody reading top to bottom
 *    used to reach a dead tile before they reached one that works. Deriving
 *    the order from each connector's own comingSoon flag, rather than from a
 *    hand-kept list, means a future placeholder cannot land above a working
 *    route by accident.
 * 2. The Orange Rails entry is hidden when the build did not set the flag, so
 *    a build with no OR provisioning offers no route into it. #177 gated only
 *    the ConnectionsPage button, which left the picker as a second way in.
 *
 * Taking the flag as an argument rather than reading it here is what makes
 * both properties testable: import.meta.env is fixed at module load.
 */
export function buildPickerConnectors(
  connectors: Connector[],
  orConnectEnabled: boolean,
): Connector[] {
  return connectors
    .filter((c) => c.type !== "orange_rails" || orConnectEnabled)
    .sort((a, b) => Number(!!a.comingSoon) - Number(!!b.comingSoon));
}

export const PICKER_CONNECTORS: Connector[] = buildPickerConnectors(CONNECTORS, OR_CONNECT_ENABLED);

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
