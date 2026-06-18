import type { Connector } from "./types";
import { CsvFlow } from "./flows/CsvFlow";

export const csvConnector: Connector = {
  type: "csv",
  label: "CSV import",
  icon: "FileSpreadsheet",
  description: "Upload a statement file (.csv) from any bank.",
  FlowComponent: CsvFlow,
};
