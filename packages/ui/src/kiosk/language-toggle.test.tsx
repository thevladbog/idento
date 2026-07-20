import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LanguageToggle } from "./language-toggle";

describe("LanguageToggle", () => {
  it("marks the active option and switches on click", async () => {
    const onChange = vi.fn();
    render(<LanguageToggle value="ru" options={[{ value: "ru", label: "РУС" }, { value: "en", label: "ENG" }]} onChange={onChange} />);
    expect(screen.getByRole("radio", { name: "РУС" })).toBeChecked();
    await userEvent.click(screen.getByRole("radio", { name: "ENG" }));
    expect(onChange).toHaveBeenCalledWith("en");
  });
});
