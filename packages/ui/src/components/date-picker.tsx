import * as PopoverPrimitive from "@radix-ui/react-popover";
import { format, isValid, parse } from "date-fns";
import { Calendar as CalendarIcon, X } from "lucide-react";
// `react-day-picker/locale` (v10) re-exports the date-fns locales extended
// with DayPicker's own translated ARIA/navigation control labels
// (labelPrevious/labelNext/labelNav/etc. — see getLabels.js, which reads
// `locale.labels`). Plain `date-fns/locale` objects don't carry those, so
// the nav buttons would stay English even in `locale="ru"` mode. This
// extended locale is a superset of a date-fns `Locale` (same
// formatLong/localize/match, plus `labels`), so it works for BOTH the
// `format()` call below and the `Calendar`'s `locale` prop.
import { enUS, ru } from "react-day-picker/locale";
import * as React from "react";
import { Button } from "./button";
import { Calendar } from "./calendar";
import { cn } from "../lib/cn";

const FMT = "yyyy-MM-dd";

export interface DatePickerProps {
  value: string;
  onValueChange: (v: string) => void;
  locale?: "en" | "ru";
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  // @idento/ui is i18n-agnostic (consumers pass translated strings via
  // props). A native `<input type="date">` lets the user clear it directly
  // (backspace, the browser's built-in ✕); a button-triggered popover has
  // no equivalent gesture, so this optionally renders an explicit clear
  // affordance that calls `onValueChange("")`. Omit it to render a
  // clear-less picker (e.g. a required date field).
  clearLabel?: string;
}

// A drop-in replacement for `<input type="date">`: `value`/`onValueChange`
// stay the SAME `YYYY-MM-DD` string in and out, so date-only consumers
// (e.g. panel's eventTiming.ts UTC-midnight pipeline) don't have to change.
//
// THE LOAD-BEARING RULE: `value` is parsed with date-fns `parse(value,
// "yyyy-MM-dd", new Date())`, which treats it as a LOCAL calendar date —
// never `new Date(value)`, which the ES spec parses as UTC midnight and
// which drifts a day off in any non-UTC timezone once rendered/compared
// locally. Symmetrically, the picked `Date` is formatted back with
// date-fns `format(d, "yyyy-MM-dd")` (LOCAL) — never `d.toISOString()`
// (UTC), which has the same drift in the other direction.
export function DatePicker({
  value,
  onValueChange,
  locale = "en",
  placeholder,
  disabled,
  id,
  className,
  clearLabel,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);
  const dfnsLocale = locale === "ru" ? ru : enUS;
  // `parse` returns an Invalid Date (never throws) for a malformed `value`
  // instead of a parse error — treat that the same as "no value" rather than
  // letting an Invalid Date reach `format()` (throws) or Calendar's
  // `selected` (garbled).
  const parsed = value ? parse(value, FMT, new Date()) : undefined;
  const selected = parsed && isValid(parsed) ? parsed : undefined;
  const showClear = Boolean(clearLabel) && Boolean(value) && !disabled;

  // The popover's content (and with it, the Calendar's own "which month is
  // displayed" state) unmounts on close by default, so a fresh open with an
  // empty `value` — e.g. right after the clear affordance above — would
  // otherwise jump to today's month instead of wherever the user last was.
  // Remembering the last non-empty selected month keeps the calendar
  // anchored there until a new value gives it somewhere better to be.
  const lastSelectedMonthRef = React.useRef<Date | undefined>(selected);
  React.useEffect(() => {
    if (selected) lastSelectedMonthRef.current = selected;
  }, [selected]);

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <div className={cn("relative", className)}>
        <PopoverPrimitive.Trigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            disabled={disabled}
            className={cn("w-full justify-start gap-2 font-normal", !value && "text-muted-foreground", showClear && "pr-8")}
          >
            <CalendarIcon aria-hidden className="size-4" />
            {value && selected ? format(selected, "PPP", { locale: dfnsLocale }) : (placeholder ?? "")}
          </Button>
        </PopoverPrimitive.Trigger>
        {showClear ? (
          <button
            type="button"
            aria-label={clearLabel}
            className="absolute right-1.5 top-1/2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onValueChange("")}
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={4}
          className="z-50 rounded-md border border-border bg-popover p-2 text-popover-foreground shadow-md"
        >
          <Calendar
            mode="single"
            selected={selected}
            defaultMonth={selected ?? lastSelectedMonthRef.current}
            locale={dfnsLocale}
            onSelect={(d) => {
              if (d) {
                onValueChange(format(d, FMT));
                setOpen(false);
              }
            }}
          />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
