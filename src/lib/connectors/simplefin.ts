import type { Connector } from "./types";
import { ComingSoonFlow } from "./flows/ComingSoonFlow";

/**
 * Not wired up. The description has to name the route that IS wired up,
 * because this tile used to be the only one in the picker with the word
 * "bank" in it: somebody looking for a bank found a disabled tile and no
 * pointer to the route that would have worked.
 *
 * It also sorts to the bottom of the picker, see buildPickerConnectors.
 */
export const simplefinConnector: Connector = {
  type: "simplefin",
  label: "SimpleFIN",
  icon: "Landmark",
  description: "Not available yet. Connect a bank through OrangeRails instead.",
  comingSoon: true,
  FlowComponent: ComingSoonFlow,
};
