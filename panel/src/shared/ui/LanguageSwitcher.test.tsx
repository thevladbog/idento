import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LanguageSwitcher } from "./LanguageSwitcher";
import i18n from "../i18n";

describe("LanguageSwitcher", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("opens a menu with EN and RU options", async () => {
    const user = userEvent.setup();
    render(<LanguageSwitcher />);
    await user.click(screen.getByRole("button"));
    expect(await screen.findByRole("menuitem", { name: "EN" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "RU" })).toBeInTheDocument();
  });

  it("syncs document.documentElement.lang when the language changes", async () => {
    const user = userEvent.setup();
    render(<LanguageSwitcher />);
    await user.click(screen.getByRole("button"));
    await user.click(await screen.findByRole("menuitem", { name: "RU" }));
    expect(document.documentElement.lang).toBe("ru");
  });
});
