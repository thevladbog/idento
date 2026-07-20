import { cn } from "../lib/cn";

export interface LanguageToggleProps {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  tone?: "brand" | "dark";
  className?: string;
}

export function LanguageToggle({ value, options, onChange, tone = "brand", className }: LanguageToggleProps) {
  return (
    <div role="radiogroup" className={cn("flex rounded-full p-1", tone === "brand" ? "bg-kiosk-overlay-ink" : "bg-kiosk-surface-2 border border-kiosk-border-2", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-full px-6 py-2.5 font-bold",
              active ? (tone === "brand" ? "bg-kiosk-text text-kiosk-brand" : "bg-kiosk-text text-kiosk-bg") : "opacity-85",
            )}
            style={{ fontSize: "var(--kiosk-fs-chrome)" }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
