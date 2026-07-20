import { ChevronLeft, ChevronRight } from "lucide-react";
import * as React from "react";
import { DayPicker } from "react-day-picker";
import { cn } from "../lib/cn";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

// Thin, fully token-styled wrapper around react-day-picker's `DayPicker`.
// Deliberately does NOT import `react-day-picker/style.css` — every visual
// is driven by semantic Tailwind tokens (theme.css) via `classNames`, per
// the package's no-hardcoded-colors rule, instead of react-day-picker's own
// `--rdp-*` CSS variables.
export function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      navLayout="around"
      className={cn("p-1", className)}
      classNames={{
        months: "flex flex-col gap-4",
        month: "relative flex w-full flex-col gap-3",
        month_caption: "flex h-8 items-center justify-center text-body font-medium text-foreground",
        button_previous: cn(
          "absolute left-0 top-0 inline-flex size-7 items-center justify-center rounded-md",
          "text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
          "disabled:pointer-events-none disabled:opacity-50",
        ),
        button_next: cn(
          "absolute right-0 top-0 inline-flex size-7 items-center justify-center rounded-md",
          "text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
          "disabled:pointer-events-none disabled:opacity-50",
        ),
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday: "w-9 text-center text-caption font-normal text-muted-foreground",
        week: "mt-1 flex w-full",
        day: cn(
          "p-0 text-center align-middle",
          "[&>button]:size-9 [&>button]:rounded-md [&>button]:font-normal [&>button]:text-foreground",
          "[&>button]:transition-colors [&>button]:hover:bg-muted",
          "[&>button]:focus-visible:outline-none [&>button]:focus-visible:ring-2 [&>button]:focus-visible:ring-ring",
        ),
        today: "[&>button]:bg-accent [&>button]:text-accent-foreground",
        selected: "[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary",
        outside: "[&>button]:text-muted-foreground [&>button]:opacity-50",
        disabled: "[&>button]:pointer-events-none [&>button]:text-muted-foreground [&>button]:opacity-50",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        // Only `orientation` is meaningful here — the rest of react-day-picker's
        // Chevron props (`size`/`disabled`/`style`) aren't valid lucide-react
        // <svg> props, so they're deliberately not spread through.
        Chevron: ({ orientation }) =>
          orientation === "left" ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />,
      }}
      {...props}
    />
  );
}
