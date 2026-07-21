import { render, screen } from "@testing-library/react";
import { StatusChip } from "./status-chip";

describe("StatusChip", () => {
  it("ok: quiet dot + label", () => {
    render(<StatusChip node={{ id: "server", label: "Сервер", level: "ok" }} />);
    const chip = screen.getByText("Сервер").closest("[data-level]")!;
    expect(chip).toHaveAttribute("data-level", "ok");
  });
  it("live ok node breathes", () => {
    render(<StatusChip node={{ id: "scanner", label: "Сканер COM3", level: "ok", live: true }} />);
    expect(screen.getByText("Сканер COM3").closest("[data-level]")!.querySelector(".animate-\\[kiosk-pulse_2s_infinite\\]")).toBeTruthy();
  });
  it("warn: amber pill with icon, label and detail", () => {
    render(<StatusChip node={{ id: "printer", label: "Принтер", level: "warn", detail: "нет ленты" }} />);
    const chip = screen.getByText(/Принтер/).closest("[data-level]")!;
    expect(chip).toHaveAttribute("data-level", "warn");
    expect(chip).toHaveClass("bg-kiosk-warn");
    expect(chip.textContent).toContain("нет ленты");
    expect(chip.querySelector("svg")).toBeTruthy(); // icon duplicates the color (WCAG 1.4.1)
  });
  it("error: red pill with icon", () => {
    render(<StatusChip node={{ id: "server", label: "Сервер", level: "error", detail: "нет связи" }} />);
    const chip = screen.getByText(/Сервер/).closest("[data-level]")!;
    expect(chip).toHaveClass("bg-kiosk-danger");
    expect(chip.querySelector("svg")).toBeTruthy();
  });
});
