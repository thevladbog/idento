import { cn } from "../lib/cn";

export interface BarcodeBeamProps {
  dimmed?: boolean;
  className?: string;
}

/** Метафора аппаратного сканера (2a): штрихкод + ходящий луч. Transform-only — дёшево для Pi. */
export function BarcodeBeam({ dimmed, className }: BarcodeBeamProps) {
  return (
    <div aria-hidden className={cn("relative grid h-[220px] w-[480px] place-items-center", dimmed && "opacity-35", className)}>
      <div
        className="h-[150px] w-[440px] rounded-md"
        style={{ background: "repeating-linear-gradient(90deg, var(--kiosk-outline) 0 8px, transparent 8px 16px, var(--kiosk-outline) 16px 22px, transparent 22px 36px, var(--kiosk-outline) 36px 40px, transparent 40px 52px)" }}
      />
      {!dimmed && (
        <span
          data-beam
          className="absolute -top-2.5 -bottom-2.5 left-1/2 -ml-0.5 w-1 rounded-sm"
          style={{ background: "linear-gradient(180deg, transparent, var(--kiosk-ok) 20%, var(--kiosk-ok) 80%, transparent)", boxShadow: "0 0 24px var(--kiosk-ok)", animation: "kiosk-beam 3.2s ease-in-out infinite" }}
        />
      )}
    </div>
  );
}
