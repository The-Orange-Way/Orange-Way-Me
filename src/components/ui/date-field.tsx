/**
 * DateField — text input with a calendar popover trigger.
 *
 * Wire format is always ISO YYYY-MM-DD (that's what the DB stores). Display
 * uses the user's dateFormat preference. The user can type a date in their
 * preferred format OR pick from the calendar.
 */
import * as React from "react";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { parseDate, toIsoDate, useLocaleFormat } from "@/lib/locale";

interface DateFieldProps {
  /** Canonical value: ISO YYYY-MM-DD or empty string. */
  value: string;
  onChange: (iso: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
}

export function DateField({
  value,
  onChange,
  placeholder,
  disabled,
  className,
  id,
}: DateFieldProps) {
  const { formatDate, datePref, datePlaceholder } = useLocaleFormat();
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<string>(() => formatDate(value) || "");

  React.useEffect(() => {
    setDraft(formatDate(value) || "");
  }, [value, formatDate]);

  function commitDraft(next: string) {
    const trimmed = next.trim();
    if (!trimmed) {
      onChange("");
      setDraft("");
      return;
    }
    const parsed = parseDate(trimmed, datePref);
    if (parsed) {
      const iso = toIsoDate(parsed);
      onChange(iso);
      setDraft(formatDate(iso));
    } else {
      // Leave draft as-is so user can correct; don't propagate invalid.
      setDraft(trimmed);
    }
  }

  const selected = value ? (parseDate(value, "iso") ?? undefined) : undefined;

  return (
    <div className={cn("relative flex", className)}>
      <Input
        id={id}
        value={draft}
        disabled={disabled}
        placeholder={placeholder ?? datePlaceholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commitDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitDraft(draft);
          }
        }}
        className="pr-10"
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled}
            className="absolute right-0 top-0 h-full w-9 hover:bg-transparent"
            aria-label="Open calendar"
          >
            <CalendarIcon className="h-4 w-4 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-auto p-0">
          <Calendar
            mode="single"
            selected={selected}
            defaultMonth={selected}
            onSelect={(d) => {
              if (d) {
                const iso = toIsoDate(d);
                onChange(iso);
                setDraft(formatDate(iso));
              }
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
