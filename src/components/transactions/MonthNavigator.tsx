import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import type { DateRange, RangePresetKey } from "@/lib/date-ranges";
import { monthRange, presetRange, shiftMonth } from "@/lib/date-ranges";
import { useState } from "react";
import { cn } from "@/lib/utils";

const PRESETS: { key: RangePresetKey; label: string }[] = [
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "ytd", label: "Year-to-date" },
  { key: "this_year", label: "This year" },
  { key: "all_time", label: "All time" },
];

export function MonthNavigator({
  anchor,
  range,
  onChange,
}: {
  anchor: Date;
  range: DateRange;
  onChange: (anchor: Date, range: DateRange) => void;
}) {
  const [customStart, setCustomStart] = useState<Date | undefined>();
  const [customEnd, setCustomEnd] = useState<Date | undefined>();

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => {
          const next = shiftMonth(anchor, -1);
          onChange(next, monthRange(next));
        }}
        aria-label="Previous month"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" className="min-w-[160px] gap-2 font-semibold">
            <CalendarIcon className="h-4 w-4" />
            {range.label}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <div className="grid grid-cols-[160px_1fr]">
            <div className="border-r border-border p-2">
              {PRESETS.map((p) => (
                <button
                  key={p.key}
                  className={cn(
                    "block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-accent",
                    range.preset === p.key && "bg-accent font-medium",
                  )}
                  onClick={() => onChange(new Date(), presetRange(p.key))}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="p-3">
              <div className="mb-2 text-xs font-medium text-muted-foreground">Custom range</div>
              <div className="flex flex-col gap-2">
                <div>
                  <div className="mb-1 text-xs">Start</div>
                  <Calendar
                    mode="single"
                    selected={customStart}
                    onSelect={setCustomStart}
                    className={cn("rounded-md border pointer-events-auto p-2")}
                  />
                </div>
                <div>
                  <div className="mb-1 text-xs">End</div>
                  <Calendar
                    mode="single"
                    selected={customEnd}
                    onSelect={setCustomEnd}
                    className={cn("rounded-md border pointer-events-auto p-2")}
                  />
                </div>
                <Button
                  size="sm"
                  disabled={!customStart || !customEnd}
                  onClick={() => {
                    if (!customStart || !customEnd) return;
                    onChange(customStart, {
                      start: format(customStart, "yyyy-MM-dd"),
                      end: format(customEnd, "yyyy-MM-dd"),
                      label: `${format(customStart, "MMM d")} – ${format(customEnd, "MMM d, yyyy")}`,
                      preset: "custom",
                    });
                  }}
                >
                  Apply custom range
                </Button>
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => {
          const next = shiftMonth(anchor, 1);
          onChange(next, monthRange(next));
        }}
        aria-label="Next month"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
