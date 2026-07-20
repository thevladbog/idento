import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "../lib/cn";

const kioskButtonVariants = cva(
  "inline-flex items-center justify-center rounded-2xl font-extrabold transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kiosk-ok disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        primary: "bg-kiosk-brand text-kiosk-text hover:opacity-90",
        outline: "border-[3px] border-kiosk-outline text-kiosk-text-2 hover:bg-kiosk-surface-2",
        ghost: "text-kiosk-text-2 hover:bg-kiosk-surface-2",
      },
      size: {
        md: "h-16 px-8",
        lg: "h-[84px] px-10",
      },
    },
    defaultVariants: { variant: "primary", size: "lg" },
  },
);

export interface KioskButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof kioskButtonVariants> {}

export const KioskButton = React.forwardRef<HTMLButtonElement, KioskButtonProps>(({ className, variant, size, ...props }, ref) => (
  <button ref={ref} type="button" className={cn(kioskButtonVariants({ variant, size }), className)} style={{ fontSize: "var(--kiosk-fs-idle-sub)" }} {...props} />
));
KioskButton.displayName = "KioskButton";
