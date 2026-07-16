import { render, waitFor } from "@testing-library/react";
import { QrPrintSheet, type QrPrintCard } from "./QrPrintSheet";
import "../../shared/i18n";

const CARDS: QrPrintCard[] = [
  {
    email: "alice@example.com", roleLabel: "Admin", zonesCaption: "QR login · zones: Main hall", token: "QR_alice_token",
  },
  {
    email: "bob@example.com", roleLabel: "Staff", zonesCaption: "No zones assigned", token: "QR_bob_token",
  },
];

describe("QrPrintSheet", () => {
  // Mocked in every test, not just the ones asserting on it directly — every
  // QrPrintSheet render eventually satisfies its own "all svgs resolved"
  // gate and calls the real window.print(), which jsdom doesn't implement
  // (it logs a noisy "Not implemented" error otherwise).
  beforeEach(() => {
    vi.spyOn(window, "print").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.getElementById("qr-print-root")?.remove();
    delete document.body.dataset.qrPrint;
  });

  it("portals N cards (email + zones caption + a resolved QR svg) into a #qr-print-root div on document.body", async () => {
    render(<QrPrintSheet cards={CARDS} onAfterPrint={() => {}} />);

    const root = document.getElementById("qr-print-root");
    expect(root).not.toBeNull();
    expect(root?.parentElement).toBe(document.body);

    await waitFor(() => expect(root?.querySelectorAll("svg").length).toBe(2));
    expect(root?.textContent).toContain("alice@example.com");
    expect(root?.textContent).toContain("QR login · zones: Main hall");
    expect(root?.textContent).toContain("bob@example.com");
    expect(root?.textContent).toContain("No zones assigned");
  });

  it("sets document.body.dataset.qrPrint while mounted and removes both the flag and the root div on unmount", async () => {
    const { unmount } = render(<QrPrintSheet cards={CARDS} onAfterPrint={() => {}} />);
    expect(document.body.dataset.qrPrint).toBe("1");
    expect(document.getElementById("qr-print-root")).not.toBeNull();

    unmount();

    expect(document.body.dataset.qrPrint).toBeUndefined();
    expect(document.getElementById("qr-print-root")).toBeNull();
  });

  it("calls window.print() exactly once, only once every card's QR svg has resolved", async () => {
    render(<QrPrintSheet cards={CARDS} onAfterPrint={() => {}} />);

    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1));
    // By the time print() fired, both svgs must already be in the DOM —
    // otherwise this would be printing a page with missing codes.
    expect(document.getElementById("qr-print-root")?.querySelectorAll("svg").length).toBe(2);
    // Give any further (incorrect) mutations a chance to fire a second call.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(window.print).toHaveBeenCalledTimes(1);
  });

  it("calls onAfterPrint when the browser's afterprint event fires", async () => {
    const onAfterPrint = vi.fn();
    render(<QrPrintSheet cards={CARDS} onAfterPrint={onAfterPrint} />);

    window.dispatchEvent(new Event("afterprint"));

    expect(onAfterPrint).toHaveBeenCalledTimes(1);
  });

  it("stops listening for afterprint once unmounted", async () => {
    const onAfterPrint = vi.fn();
    const { unmount } = render(<QrPrintSheet cards={CARDS} onAfterPrint={onAfterPrint} />);
    unmount();

    window.dispatchEvent(new Event("afterprint"));

    expect(onAfterPrint).not.toHaveBeenCalled();
  });
});
