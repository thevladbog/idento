import * as React from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { QrSvg } from "./QrSvg";

export interface QrPrintCard {
  email: string;
  roleLabel: string;
  zonesCaption: string;
  token: string;
}

export interface QrPrintSheetProps {
  cards: QrPrintCard[];
  onAfterPrint: () => void;
}

// The browser-print counterpart to StaffCard's on-screen QR area — mounted
// by StaffPage whenever there's something to print (a single card, or the
// "Print all" batch), torn down once the browser's native print flow
// settles. Everything here portals into a dedicated `#qr-print-root` div
// this component owns for its own lifetime (created once, appended to
// `document.body` on mount, removed on unmount) rather than the app's normal
// `#root` tree, so `print.css`'s `body[data-qr-print="1"] #root { display:
// none }` can hide the whole app UI for the print, leaving only the cards.
export function QrPrintSheet({ cards, onAfterPrint }: QrPrintSheetProps) {
  const { t } = useTranslation();
  const [container] = React.useState(() => {
    const el = document.createElement("div");
    el.id = "qr-print-root";
    return el;
  });

  React.useEffect(() => {
    document.body.appendChild(container);
    // print.css keys off this attribute (not just #qr-print-root's own
    // display rule) so it can ALSO hide `#root` for the duration — without
    // it, a plain "#qr-print-root { display: block }" print rule would show
    // the cards ALONGSIDE the full app UI instead of replacing it.
    document.body.dataset.qrPrint = "1";
    return () => {
      container.remove();
      delete document.body.dataset.qrPrint;
    };
  }, [container]);

  React.useEffect(() => {
    window.addEventListener("afterprint", onAfterPrint);
    return () => window.removeEventListener("afterprint", onAfterPrint);
  }, [onAfterPrint]);

  // Fires `window.print()` exactly once, gated on every card's QrSvg having
  // actually resolved its real SVG into the live DOM. This observes the DOM
  // directly (rather than running a SECOND, independent QR-generation pass
  // just to know when the first one — the one QrSvg itself is doing — is
  // done) so there is no possible gap between "detected ready" and "what's
  // actually on the page" for window.print() to race against: the moment the
  // observer sees the Nth <svg>, that IS the current, final DOM state.
  React.useEffect(() => {
    let printed = false;
    const total = cards.length;

    function checkReady() {
      if (printed) return;
      if (container.querySelectorAll("svg").length < total) return;
      printed = true;
      observer.disconnect();
      window.print();
    }

    const observer = new MutationObserver(checkReady);
    observer.observe(container, { childList: true, subtree: true });
    // Covers the (degenerate) case where `total` is already satisfied
    // before any mutation fires — e.g. an empty card list.
    checkReady();
    return () => observer.disconnect();
  }, [cards, container]);

  return createPortal(
    <>
      {cards.map((card) => (
        <div key={card.token} className="qr-print-card">
          <QrSvg
            value={card.token}
            label={t("staffQrPrintLabel", { email: card.email })}
            className="qr-print-svg"
          />
          <p className="qr-print-email">{card.email}</p>
          <p className="qr-print-role">{card.roleLabel}</p>
          <p className="qr-print-zones">{card.zonesCaption}</p>
        </div>
      ))}
    </>,
    container,
  );
}
