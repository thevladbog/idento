import { cn } from "../lib/cn";

export interface ScanFrameProps {
  tone?: "ok" | "onBrand";
  dimmed?: boolean;
  className?: string;
}

/** Рамка-видоискатель для camera-режима (1a idle, attract 1g). */
export function ScanFrame({ tone = "ok", dimmed, className }: ScanFrameProps) {
  const c = tone === "ok" ? "border-kiosk-ok" : "border-kiosk-text";
  const line = tone === "ok" ? "var(--kiosk-ok)" : "var(--kiosk-text)";
  const corners = [
    "left-0 top-0 border-l-[7px] border-t-[7px] rounded-tl-2xl",
    "right-0 top-0 border-r-[7px] border-t-[7px] rounded-tr-2xl",
    "left-0 bottom-0 border-l-[7px] border-b-[7px] rounded-bl-2xl",
    "right-0 bottom-0 border-r-[7px] border-b-[7px] rounded-br-2xl",
  ];
  return (
    <div aria-hidden className={cn("relative size-[clamp(220px,32vh,400px)]", dimmed && "opacity-35", className)}>
      {corners.map((pos) => <span key={pos} data-corner className={cn("absolute size-16", pos, c)} />)}
      {!dimmed && (
        <span data-scanline className="absolute left-[6%] h-[3px] w-[88%]" style={{ background: `linear-gradient(90deg, transparent, ${line}, transparent)`, animation: "kiosk-scan 2.8s infinite" }} />
      )}
    </div>
  );
}
