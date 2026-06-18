import type { Connector } from "./types";
import { ManualFlow } from "./flows/ManualFlow";

export const manualConnector: Connector = {
  type: "manual",
  label: "Manual entry",
  icon: "PencilLine",
  description: "Just a name and a starting balance.",
  FlowComponent: ManualFlow,
};
