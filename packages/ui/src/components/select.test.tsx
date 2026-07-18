import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Label } from "./label";
import { Select } from "./select";

describe("Select", () => {
  it("is reachable by its label", () => {
    render(
      <>
        <Label htmlFor="zone">Zone</Label>
        <Select id="zone">
          <option value="a">Alpha</option>
        </Select>
      </>,
    );
    expect(screen.getByLabelText("Zone")).toBeInTheDocument();
  });

  it("renders its options and reflects the selected value", () => {
    render(
      <Select aria-label="Zone" defaultValue="b">
        <option value="a">Alpha</option>
        <option value="b">Beta</option>
      </Select>,
    );
    expect(screen.getByRole("combobox", { name: "Zone" })).toHaveValue("b");
  });

  it("fires onChange with the newly picked option", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Select aria-label="Zone" onChange={onChange}>
        <option value="a">Alpha</option>
        <option value="b">Beta</option>
      </Select>,
    );
    await user.selectOptions(screen.getByRole("combobox", { name: "Zone" }), "b");
    expect(onChange).toHaveBeenCalled();
    expect(screen.getByRole("combobox", { name: "Zone" })).toHaveValue("b");
  });

  it("applies variant classes from tokens", () => {
    render(
      <Select aria-label="Status filter" variant="pill">
        <option value="a">Alpha</option>
      </Select>,
    );
    expect(screen.getByRole("combobox", { name: "Status filter" })).toHaveClass("rounded-full");
  });

  it("is disabled when disabled", () => {
    render(
      <Select aria-label="Zone" disabled>
        <option value="a">Alpha</option>
      </Select>,
    );
    expect(screen.getByRole("combobox", { name: "Zone" })).toBeDisabled();
  });
});
