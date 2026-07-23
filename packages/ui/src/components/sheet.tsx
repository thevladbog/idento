import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import * as React from "react";
import { cn } from "../lib/cn";

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

const sheetVariants = cva(
  "fixed z-50 flex flex-col gap-4 bg-card p-6 shadow-lg transition data-[state=open]:animate-in data-[state=closed]:animate-out",
  {
    variants: {
      side: {
        left: "inset-y-0 left-0 h-full w-3/4 max-w-xs border-r border-border data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left",
        right: "inset-y-0 right-0 h-full w-3/4 max-w-xs border-l border-border data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right",
        bottom:
          "inset-x-0 bottom-0 max-h-[85vh] rounded-t-2xl border-t border-border pb-[max(1.5rem,env(safe-area-inset-bottom))] data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom",
      },
    },
    defaultVariants: { side: "left" },
  },
);

export const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> &
    VariantProps<typeof sheetVariants> & { closeLabel: string }
>(({ className, children, side, closeLabel, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay/40 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
    <DialogPrimitive.Content ref={ref} className={cn(sheetVariants({ side }), className)} {...props}>
      {children}
      <DialogPrimitive.Close
        aria-label={closeLabel}
        // WCAG 2.5.8 target size — same fix/rationale as dialog.tsx's
        // DialogContent close button (icon-only size-4 alone is 16px,
        // under the 24px floor; size-6 + flex-centering is this codebase's
        // established icon-button hit-target convention).
        // Bottom sheets are phone-only chrome — 44px per the P6 adaptive rules (WCAG 2.5.5 level).
        className={cn(
          "absolute right-4 top-4 inline-flex items-center justify-center rounded-sm text-muted-foreground opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          side === "bottom" ? "size-11" : "size-6",
        )}
      >
        <X className="size-4" />
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
SheetContent.displayName = "SheetContent";

export function SheetHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1.5", className)} {...props} />;
}

export const SheetTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn("text-section-title", className)} {...props} />
));
SheetTitle.displayName = "SheetTitle";
