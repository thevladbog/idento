import * as React from "react";
import * as QRCode from "qrcode";

export interface QrSvgProps {
  value: string;
  className?: string;
  label: string;
}

// Local, pure-JS QR rendering — `QRCode.toString(..., { type: "svg" })` never
// touches `<canvas>` (verified against the `qrcode` package's own SVG
// renderer, which only ever calls `QRCode.create` + a string-templated SVG
// builder), so this works identically in the real browser and under jsdom,
// and never calls out to a 3rd-party QR image API (a login-token string is
// exactly the kind of secret that must never leave the client to render).
// `errorCorrectionLevel: "M"` and `margin: 0` are fixed per the task brief —
// the card/print layout around this component supplies its own quiet-zone
// padding, so the SVG itself doesn't double it up. No color options are
// passed, so `qrcode` renders its own default literal black-on-white — never
// overridden or themed to token colors, deliberately: this is the QR-code
// half of the ONE documented non-token-color exception (Global Constraints,
// docs/superpowers/plans/2026-07-16-panel-p2.2-zones-staff.md, line 23 —
// see print.css for the other half, the printed card's literal white
// background). A scannable code can't shift with the viewer's theme.
//
// The outer container carries the accessible name (`role="img"
// aria-label={label}` — WCAG 1.4.1: this IS the "text alternative" for a
// purely-visual code); the injected markup is wrapped `aria-hidden` so
// assistive tech doesn't also try to read the SVG's own (non-existent,
// but not worth relying on) accessible content as a second, redundant name.
export function QrSvg({ value, className, label }: QrSvgProps) {
  const [svgMarkup, setSvgMarkup] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setSvgMarkup(null);
    QRCode.toString(value, { type: "svg", errorCorrectionLevel: "M", margin: 0 })
      .then((markup) => {
        if (!cancelled) setSvgMarkup(markup);
      })
      .catch(() => {
        // No i18n'd error state exists for this (a real generation failure
        // is effectively unreachable for the short token strings this ever
        // encodes) — leave the container empty rather than fabricate one.
        if (!cancelled) setSvgMarkup(null);
      });
    return () => {
      cancelled = true;
    };
  }, [value]);

  return (
    <div role="img" aria-label={label} className={className}>
      {svgMarkup ? (
        // `qrcode`'s SVG renderer only ever emits a `viewBox` (no explicit
        // width/height — no `width` option is passed above), so the raw
        // <svg> defaults to `display: inline` and won't fill a sized
        // container on its own. The child-selector utilities force it to
        // fill whatever box `className` above gives the container, in
        // every context this is used (the on-screen card's small swatch,
        // the print sheet's larger one) without each caller re-deriving it.
        <div
          aria-hidden="true"
          className="h-full w-full [&>svg]:h-full [&>svg]:w-full"
          dangerouslySetInnerHTML={{ __html: svgMarkup }}
        />
      ) : null}
    </div>
  );
}
