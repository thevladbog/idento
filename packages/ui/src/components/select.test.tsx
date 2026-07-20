import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "./select";

function Basic({ onValueChange = () => {} }: { onValueChange?: (v: string) => void }) {
  return (
    <Select onValueChange={onValueChange}>
      <SelectTrigger><SelectValue placeholder="Pick" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="a">Alpha</SelectItem>
        <SelectItem value="b">Beta</SelectItem>
      </SelectContent>
    </Select>
  );
}

it("opens the listbox and selects an item via keyboard/click", async () => {
  const onValueChange = vi.fn();
  render(<Basic onValueChange={onValueChange} />);
  const trigger = screen.getByRole("combobox");
  await userEvent.click(trigger);
  await userEvent.click(await screen.findByRole("option", { name: "Beta" }));
  expect(onValueChange).toHaveBeenCalledWith("b");
});

it("shows the placeholder when no value is set", () => {
  render(<Basic />);
  expect(screen.getByText("Pick")).toBeInTheDocument();
});

it("renders a disabled item that can't be chosen", async () => {
  render(
    <Select><SelectTrigger><SelectValue placeholder="p" /></SelectTrigger>
      <SelectContent><SelectItem value="x" disabled>X</SelectItem></SelectContent>
    </Select>,
  );
  await userEvent.click(screen.getByRole("combobox"));
  expect(await screen.findByRole("option", { name: "X" })).toHaveAttribute("aria-disabled", "true");
});
