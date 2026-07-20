import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RadioGroup, RadioGroupItem } from "./radio-group";

function Basic({ onValueChange = () => {}, value }: { onValueChange?: (v: string) => void; value?: string }) {
  return (
    <RadioGroup aria-label="Role" value={value} onValueChange={onValueChange}>
      <RadioGroupItem value="staff" aria-label="Staff" />
      <RadioGroupItem value="manager" aria-label="Manager" />
    </RadioGroup>
  );
}

describe("RadioGroup", () => {
  it("renders role=radiogroup with role=radio items", () => {
    render(<Basic />);
    expect(screen.getByRole("radiogroup", { name: "Role" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
  });

  it("selects an item via click, firing onValueChange(value)", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<Basic onValueChange={onValueChange} />);

    await user.click(screen.getByRole("radio", { name: "Manager" }));
    expect(onValueChange).toHaveBeenCalledWith("manager");
  });

  it("reflects the selected value via aria-checked", () => {
    render(<Basic value="staff" />);
    expect(screen.getByRole("radio", { name: "Staff" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Manager" })).not.toBeChecked();
  });

  it("moves selection with the arrow keys, firing onValueChange", async () => {
    const onValueChange = vi.fn();
    render(<Basic value="staff" onValueChange={onValueChange} />);

    const staff = screen.getByRole("radio", { name: "Staff" });
    staff.focus();
    // Radix's roving-focus-group defers the actual focus move to the next
    // item via a macrotask (`setTimeout`) so it lands after React's commit;
    // fireEvent.keyDown (deliberately with no paired keyUp, unlike
    // userEvent.keyboard) keeps the "an arrow key is down" flag it reads
    // true until that deferred focus() actually lands.
    fireEvent.keyDown(staff, { key: "ArrowDown" });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(onValueChange).toHaveBeenCalledWith("manager");
  });

  it("blocks selection when disabled", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <RadioGroup aria-label="Role" onValueChange={onValueChange}>
        <RadioGroupItem value="staff" aria-label="Staff" disabled />
      </RadioGroup>,
    );
    const item = screen.getByRole("radio", { name: "Staff" });
    expect(item).toBeDisabled();
    await user.click(item);
    expect(onValueChange).not.toHaveBeenCalled();
  });
});
