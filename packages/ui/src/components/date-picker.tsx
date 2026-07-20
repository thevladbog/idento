import * as PopoverPrimitive from "@radix-ui/react-popover";
import { format, parse } from "date-fns";
import { enUS, ru } from "date-fns/locale";
import { Calendar as CalendarIcon, X } from "lucide-react";
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
  const selected = value ? parse(value, FMT, new Date()) : undefined;
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
