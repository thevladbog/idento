import * as React from "react";
import { Button } from "./button";
import { Input } from "./input";
import { cn } from "../lib/cn";

// Tailwind arbitrary variant hides the native spinners (webkit + firefox).
const NO_SPINNER =
  "[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

export interface NumberInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> {
  value: number | "";
  onValueChange: (v: number | "") => void;
  step?: number;
  min?: number;
  max?: number;
  showSteppers?: boolean;
  // Optional accessible names for the stepper buttons. @idento/ui carries no
  // i18n dependency (house rule), so localized labels come from the consumer;
  // when omitted the visible "−"/"+" glyph is the button's accessible name
  // (locale-neutral) — never a hardcoded English string.
  decrementLabel?: string;
  incrementLabel?: string;
}

export const NumberInput = React.forwardRef<HTMLInputElement, NumberInputProps>(
  ({ className, value, onValueChange, step = 1, min, max, showSteppers = true, decrementLabel, incrementLabel, ...props }, ref) => {
    const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
    const bump = (dir: 1 | -1) => onValueChange(clamp((typeof value === "number" ? value : 0) + dir * step));
    return (
      <div className="flex items-center gap-1">
        {showSteppers && (
          <Button
            type="button"
            variant="outline"
            className="size-9 shrink-0 p-0"
            aria-label={decrementLabel}
            disabled={props.disabled}
            onClick={() => bump(-1)}
          >
            −
          </Button>
        )}
        <Input
          ref={ref}
          type="number"
          inputMode="numeric"
          step={step}
          min={min}
          max={max}
          className={cn(NO_SPINNER, className)}
          value={value}
          onChange={(e) => onValueChange(e.target.value === "" ? "" : Number(e.target.value))}
          {...props}
        />
        {showSteppers && (
          <Button
            type="button"
            variant="outline"
            className="size-9 shrink-0 p-0"
            aria-label={incrementLabel}
            disabled={props.disabled}
            onClick={() => bump(1)}
          >
            +
          </Button>
        )}
      </div>
    );
  },
);
NumberInput.displayName = "NumberInput";
