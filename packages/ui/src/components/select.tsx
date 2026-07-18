import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "../lib/cn";

const selectVariants = cva(
  "border border-input bg-card text-body text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "flex h-9 w-full rounded-md px-3 py-1 shadow-sm",
        pill: "h-9 rounded-full px-3",
        compact: "h-9 w-auto rounded-md px-2",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface SelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement>,
    VariantProps<typeof selectVariants> {}

// Wraps a native <select> rather than a custom listbox: every call site this
// replaces (panel/AGENTS.md's "primitives only from @idento/ui" rule,
// closing a CodeRabbit finding on PR #77) already relies on native keyboard
// nav, the OS's own mobile picker, and plain <option>/<optgroup> children --
// and every one of those call sites' tests already assert via
// getByRole("combobox")/userEvent.selectOptions. A Radix-style listbox would
// change the DOM role structure and break all of them for no behavioral gain.
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, variant, ...props }, ref) => (
    <select ref={ref} className={cn(selectVariants({ variant }), className)} {...props} />
  ),
);
Select.displayName = "Select";

export { selectVariants };
