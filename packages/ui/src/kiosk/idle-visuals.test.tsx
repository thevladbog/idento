import { render } from "@testing-library/react";
import { BarcodeBeam } from "./barcode-beam";
import { BrandSlot } from "./brand-slot";
import { ScanFrame } from "./scan-frame";

describe("idle visuals", () => {
  it("BarcodeBeam shows beam when active and hides it when dimmed", () => {
    const { container, rerender } = render(<BarcodeBeam />);
    expect(container.querySelector("[data-beam]")).toBeTruthy();
    rerender(<BarcodeBeam dimmed />);
    expect(container.querySelector("[data-beam]")).toBeFalsy();
    expect(container.firstElementChild).toHaveClass("opacity-35");
  });
  it("ScanFrame renders four corners and a scan line", () => {
    const { container } = render(<ScanFrame />);
    expect(container.querySelectorAll("[data-corner]").length).toBe(4);
    expect(container.querySelector("[data-scanline]")).toBeTruthy();
  });
  it("BrandSlot renders image when src given, dashed placeholder otherwise", () => {
    const { container, rerender } = render(<BrandSlot placeholderLabel="логотип события" />);
    expect(container.textContent).toContain("логотип события");
    rerender(<BrandSlot src="/logo.svg" alt="ACME" />);
    expect(container.querySelector("img")).toHaveAttribute("alt", "ACME");
  });
});
