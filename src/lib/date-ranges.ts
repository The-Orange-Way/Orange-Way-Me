/**
 * Date range presets + month navigator helpers.
 */
import { addMonths, endOfMonth, format, startOfMonth, startOfYear } from "date-fns";

export type RangePresetKey =
  | "this_month"
  | "last_month"
  | "this_year"
  | "ytd"
  | "all_time"
  | "custom";

export interface DateRange {
  start: string; // YYYY-MM-DD
  end: string;
  label: string;
  preset: RangePresetKey;
}

const fmt = (d: Date) => format(d, "yyyy-MM-dd");

export function monthRange(anchor: Date): DateRange {
  return {
    start: fmt(startOfMonth(anchor)),
    end: fmt(endOfMonth(anchor)),
    label: format(anchor, "MMMM yyyy"),
    preset: "this_month",
  };
}

export function presetRange(key: RangePresetKey, anchor: Date = new Date()): DateRange {
  const today = new Date();
  switch (key) {
    case "this_month":
      return monthRange(anchor);
    case "last_month": {
      const m = addMonths(anchor, -1);
      return { ...monthRange(m), preset: "last_month" };
    }
    case "this_year":
      return {
        start: fmt(startOfYear(today)),
        end: fmt(new Date(today.getFullYear(), 11, 31)),
        label: `${today.getFullYear()}`,
        preset: "this_year",
      };
    case "ytd":
      return {
        start: fmt(startOfYear(today)),
        end: fmt(today),
        label: "Year-to-date",
        preset: "ytd",
      };
    case "all_time":
      return {
        start: "1970-01-01",
        end: "2999-12-31",
        label: "All time",
        preset: "all_time",
      };
    case "custom":
    default:
      return monthRange(anchor);
  }
}

export function shiftMonth(anchor: Date, delta: number): Date {
  return addMonths(anchor, delta);
}
