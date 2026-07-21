import * as React from "react";
import { cn } from "../lib/cn";

export interface KioskInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  mono?: boolean;
}

/** Крупное поле pre-flight (84px): surface-2, работает в перчатках. */
export const KioskInput = React.forwardRef<HTMLInputElement, KioskInputProps>(({ className, mono, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "h-[84px] w-full rounded-2xl border-2 border-kiosk-border-2 bg-kiosk-surface-2 px-7 text-kiosk-text placeholder:text-kiosk-text-4 focus-visible:border-kiosk-ok focus-visible:outline-none",
      mono && "font-mono",
      className,
    )}
    style={{ fontSize: "var(--kiosk-fs-idle-sub)" }}
    {...props}
  />
));
KioskInput.displayName = "KioskInput";
