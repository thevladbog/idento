import { render, screen } from "@testing-library/react";
import { KioskButton } from "./kiosk-button";
import { KioskInput } from "./kiosk-input";

describe("KioskButton", () => {
  it("primary uses brand background", () => {
    render(<KioskButton>Продолжить</KioskButton>);
    expect(screen.getByRole("button", { name: "Продолжить" })).toHaveClass("bg-kiosk-brand");
  });
  it("outline and disabled states", () => {
    render(
      <KioskButton variant="outline" disabled>
        Назад
      </KioskButton>,
    );
    const b = screen.getByRole("button", { name: "Назад" });
    expect(b).toHaveClass("border-kiosk-outline");
    expect(b).toBeDisabled();
  });
});

describe("KioskInput", () => {
  it("renders a large input; mono adds font-mono", () => {
    render(<KioskInput mono aria-label="Адрес сервера" defaultValue="https://checkin.local" />);
    const i = screen.getByRole("textbox", { name: "Адрес сервера" });
    expect(i).toHaveClass("font-mono");
    expect(i).toHaveValue("https://checkin.local");
  });
});
