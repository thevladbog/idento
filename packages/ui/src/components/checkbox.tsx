import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import * as React from "react";
import { cn } from "../lib/cn";

export const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      // WCAG 2.5.8 (Target Size, Minimum, AA) needs the interactive element
      // itself >=24x24 CSS px — `size-4` (16px) failed this live in the
      // P5.3.3 axe-core/playwright sweep on AttendeeTable's row checkbox,
      // which sits inside a much larger row-level click target (so the
      // "sufficient offset from neighboring targets" alternative doesn't
      // save it either). `size-6` (24px) is the exact floor; the border/
      // check-glyph stay visually proportional via the bumped icon size
      // below rather than looking lost in a bigger box.
      "peer flex size-6 shrink-0 items-center justify-center rounded-sm border border-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="flex items-center justify-center">
      <Check className="size-4" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = "Checkbox";
