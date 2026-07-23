import { X } from "lucide-react";
import * as QRCode from "qrcode";
import * as React from "react";
import { cn } from "../lib/cn";
import { Button } from "./button";

export interface QrDisplayProps {
  /** The raw payload encoded into the QR (a token, a URL — plain string). */
  value: string;
  title: string;
  subtitle: string;
  /** ISO timestamp the code stops being valid at, or null for no expiry UI. */
  expiresAt: string | null;
  expiredLabel: string;
  regenerateLabel: string;
  closeLabel: string;
  onClose: () => void;
  onRegenerate: () => void;
  /** Small caption under the code (who/what it's for). */
  hint?: string;
  className?: string;
  /**
   * Whether to render the small regenerate text-button in the non-expired
   * state. Defaults to `true` for the three consumers with a real
   * "regenerate" action (staff login QR, station provisioning QR, staff
   * self-service QR). Callers whose QR is a static, non-rotating value (e.g.
   * an attendee's badge QR) have no real regenerate action to wire up and
   * should pass `false` here rather than leave a focusable, accessible-name-
   * less no-op control in the DOM (WCAG 4.1.2).
   */
  showRegenerate?: boolean;
}

function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

// Board 8l/8m/8s — one full-screen QR pattern shared by every QR moment
// (staff login token, station provisioning token, staff self-service).
// The canvas is ALWAYS rendered on a white surface regardless of the app's
// theme ("scan contrast beats theming" — a scanner reading a dark-mode
// QR against a dark background is a real failure mode this avoids).
// Local rendering only (`qrcode` npm package) — never a third-party chart
// API, since every value this component is handed is a bearer credential.
export function QrDisplay({
  value, title, subtitle, expiresAt, expiredLabel, regenerateLabel, closeLabel, onClose, onRegenerate, hint, className,
  showRegenerate = true,
}: QrDisplayProps) {
  const [svg, setSvg] = React.useState<string | null>(null);
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    let cancelled = false;
    void QRCode.toString(value, { type: "svg", errorCorrectionLevel: "M", margin: 0 }).then((markup) => {
      if (!cancelled) setSvg(markup);
    });
    return () => {
      cancelled = true;
    };
  }, [value]);

  React.useEffect(() => {
    if (!expiresAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);

  const msRemaining = expiresAt ? Date.parse(expiresAt) - now : null;
  const expired = msRemaining !== null && msRemaining <= 0;

  return (
    <div
      className={cn(
        "relative flex min-h-screen flex-col items-center bg-white px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(3rem,env(safe-area-inset-top))] text-center text-black",
        className,
      )}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label={closeLabel}
        className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] flex size-11 items-center justify-center rounded-full bg-black/5 text-black/70 hover:bg-black/10"
      >
        <X aria-hidden className="size-4" />
      </button>

      <div className="mt-14">
        <div className="text-card-title font-bold">{title}</div>
        <div className="mt-1 text-caption text-black/60">{subtitle}</div>
      </div>

      <div className="relative mt-8 rounded-2xl border border-black/10 p-4">
        {expired ? (
          <div className="flex size-[228px] flex-col items-center justify-center gap-2">
            <span className="text-body font-bold">{expiredLabel}</span>
          </div>
        ) : svg ? (
          <div
            role="img"
            aria-label={value}
            className="size-[228px] [&_svg]:size-full"
            // Local, deterministic SVG string from the `qrcode` package —
            // never externally-sourced markup.
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : (
          <div className="size-[228px]" />
        )}
      </div>

      {!expired && msRemaining !== null ? (
        <div className="mt-5 inline-flex items-center gap-2 rounded-full bg-black/5 px-3.5 py-1.5 text-caption font-semibold">
          <span aria-live="polite">Expires in {formatCountdown(msRemaining)}</span>
        </div>
      ) : null}

      {expired ? (
        // Structurally unreachable when `expiresAt` is null (as it is for the
        // `showRegenerate={false}` callers), but guarded for defensive
        // correctness anyway.
        showRegenerate ? (
          <Button className="mt-6 w-[228px]" onClick={onRegenerate}>
            {regenerateLabel}
          </Button>
        ) : null
      ) : showRegenerate ? (
        <button type="button" onClick={onRegenerate} className="mt-5 text-caption font-semibold text-black/70 underline-offset-2 hover:underline">
          {regenerateLabel}
        </button>
      ) : null}

      {hint ? <p className="mt-auto max-w-[280px] pt-8 text-caption text-black/50">{hint}</p> : null}
    </div>
  );
}
