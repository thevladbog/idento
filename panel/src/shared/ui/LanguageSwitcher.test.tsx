import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LanguageSwitcher } from "./LanguageSwitcher";
import "../i18n";

describe("LanguageSwitcher", () => {
  it("opens a menu with EN and RU options", async () => {
    const user = userEvent.setup();
    render(<LanguageSwitcher />);
    await user.click(screen.getByRole("button"));
    expect(await screen.findByRole("menuitem", { name: "EN" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "RU" })).toBeInTheDocument();
  });
});
