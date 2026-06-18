import type { Connector } from "./types";
import { ComingSoonFlow } from "./flows/ComingSoonFlow";

export const simplefinConnector: Connector = {
  type: "simplefin",
  label: "SimpleFIN",
  icon: "Landmark",
  description: "Sync US/CA bank accounts via SimpleFIN.",
  comingSoon: true,
  FlowComponent: ComingSoonFlow,
};
