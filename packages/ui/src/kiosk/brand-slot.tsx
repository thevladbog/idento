import { cn } from "../lib/cn";

export interface BrandSlotProps {
  src?: string;
  alt?: string;
  placeholderLabel?: string;
  className?: string;
}

/** Слот брендинга attract-экрана: ограниченная зона 380×130, дальше бренд не расползается. */
export function BrandSlot({ src, alt = "", placeholderLabel, className }: BrandSlotProps) {
  if (src) {
    return (
      <div className={cn("grid h-[130px] w-[380px] place-items-center", className)}>
        <img src={src} alt={alt} className="max-h-full max-w-full object-contain" />
      </div>
    );
  }
  return (
    <div
      className={cn("grid h-[130px] w-[380px] place-items-center rounded-2xl border-[3px] border-dashed border-kiosk-text/55", className)}
      style={{ background: "repeating-linear-gradient(45deg, var(--kiosk-overlay-light) 0 14px, transparent 14px 28px)" }}
    >
      {placeholderLabel && <span className="font-mono opacity-85" style={{ fontSize: "var(--kiosk-fs-chrome)" }}>{placeholderLabel}</span>}
    </div>
  );
}
