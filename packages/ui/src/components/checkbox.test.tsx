import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { Checkbox } from "./checkbox";

function Controlled({ onCheckedChange = () => {} }: { onCheckedChange?: (checked: boolean) => void }) {
  const [checked, setChecked] = React.useState(false);
  return (
    <Checkbox
      aria-label="Accept"
      checked={checked}
      onCheckedChange={(next) => {
        setChecked(next === true);
        onCheckedChange(next === true);
      }}
    />
  );
}

describe("Checkbox", () => {
  it("renders as role=checkbox, unchecked by default", () => {
    render(<Checkbox aria-label="Accept" checked={false} onCheckedChange={() => {}} />);
    const box = screen.getByRole("checkbox", { name: "Accept" });
    expect(box).not.toBeChecked();
  });

  it("toggles via click, firing onCheckedChange(true) then onCheckedChange(false)", async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Controlled onCheckedChange={onCheckedChange} />);
    const box = screen.getByRole("checkbox", { name: "Accept" });

    await user.click(box);
    expect(onCheckedChange).toHaveBeenNthCalledWith(1, true);
    expect(box).toBeChecked();

    await user.click(box);
    expect(onCheckedChange).toHaveBeenNthCalledWith(2, false);
    expect(box).not.toBeChecked();
  });

  it("toggles via the keyboard (space) once focused", async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Controlled onCheckedChange={onCheckedChange} />);
    const box = screen.getByRole("checkbox", { name: "Accept" });

    box.focus();
    await user.keyboard(" ");
    expect(onCheckedChange).toHaveBeenCalledWith(true);
    expect(box).toBeChecked();
  });

  it("blocks toggling when disabled", async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Checkbox aria-label="Accept" checked={false} disabled onCheckedChange={onCheckedChange} />);
    const box = screen.getByRole("checkbox", { name: "Accept" });

    expect(box).toBeDisabled();
    await user.click(box);
    expect(onCheckedChange).not.toHaveBeenCalled();
  });

  it("merges a custom className onto the root", () => {
    render(<Checkbox aria-label="Accept" checked={false} onCheckedChange={() => {}} className="my-extra" />);
    expect(screen.getByRole("checkbox", { name: "Accept" })).toHaveClass("my-extra");
  });
});
