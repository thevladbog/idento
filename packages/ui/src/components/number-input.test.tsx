import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { Label } from "./label";
import { NumberInput } from "./number-input";

function Controlled({
  initial = 5,
  onValueChange = () => {},
  ...rest
}: {
  initial?: number | "";
  onValueChange?: (v: number | "") => void;
  step?: number;
  min?: number;
  max?: number;
  showSteppers?: boolean;
  disabled?: boolean;
}) {
  const [value, setValue] = React.useState<number | "">(initial);
  return (
    <NumberInput
      aria-label="Quantity"
      // Consumer-supplied stepper labels — the primitive itself carries no
      // i18n; the tests below pass explicit names so the button queries read
      // clearly, and a dedicated test covers the label-less (symbol-name) case.
      decrementLabel="Decrease"
      incrementLabel="Increase"
      value={value}
      onValueChange={(v) => {
        setValue(v);
        onValueChange(v);
      }}
      {...rest}
    />
  );
}

describe("NumberInput", () => {
  it("uses the visible +/− glyph as the stepper accessible name when no label is given (no hardcoded English)", () => {
    render(<NumberInput aria-label="Qty" value={1} onValueChange={() => {}} />);
    // With decrementLabel/incrementLabel omitted, the button's accessible name
    // is its text content — locale-neutral, never an English "Increase"/"Decrease".
    expect(screen.getByRole("button", { name: "−" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Increase" })).not.toBeInTheDocument();
  });

  it("is reachable by its label and renders the current value", () => {
    render(
      <>
        <Label htmlFor="qty">Quantity</Label>
        <NumberInput id="qty" value={5} onValueChange={() => {}} />
      </>,
    );
    expect(screen.getByLabelText("Quantity")).toHaveValue(5);
  });

  it("clicking + increments by step and fires onValueChange(value + step)", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<Controlled initial={5} step={2} onValueChange={onValueChange} />);

    await user.click(screen.getByRole("button", { name: "Increase" }));

    expect(onValueChange).toHaveBeenCalledWith(7);
    expect(screen.getByLabelText("Quantity")).toHaveValue(7);
  });

  it("clicking − decrements by step and fires onValueChange(value - step)", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<Controlled initial={5} step={2} onValueChange={onValueChange} />);

    await user.click(screen.getByRole("button", { name: "Decrease" }));

    expect(onValueChange).toHaveBeenCalledWith(3);
    expect(screen.getByLabelText("Quantity")).toHaveValue(3);
  });

  it("clamps the + stepper at max", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<Controlled initial={9} max={10} onValueChange={onValueChange} />);

    await user.click(screen.getByRole("button", { name: "Increase" }));
    expect(onValueChange).toHaveBeenLastCalledWith(10);

    await user.click(screen.getByRole("button", { name: "Increase" }));
    expect(onValueChange).toHaveBeenLastCalledWith(10);
  });

  it("clamps the − stepper at min", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<Controlled initial={1} min={0} onValueChange={onValueChange} />);

    await user.click(screen.getByRole("button", { name: "Decrease" }));
    expect(onValueChange).toHaveBeenLastCalledWith(0);

    await user.click(screen.getByRole("button", { name: "Decrease" }));
    expect(onValueChange).toHaveBeenLastCalledWith(0);
  });

  it("typing a number fires onValueChange with the numeric value", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<Controlled initial="" onValueChange={onValueChange} />);

    await user.type(screen.getByLabelText("Quantity"), "42");

    expect(onValueChange).toHaveBeenLastCalledWith(42);
  });

  it("clearing the field fires onValueChange('')", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<Controlled initial={5} onValueChange={onValueChange} />);

    await user.clear(screen.getByLabelText("Quantity"));

    expect(onValueChange).toHaveBeenLastCalledWith("");
  });

  // Browsers let `<input type="number">` hold intermediate strings ("-",
  // "1e", ".") that aren't valid numbers yet while the user is actively
  // typing — `e.target.value` reflects that raw, unsanitized string (this is
  // why `Number(raw)` on it is NaN). jsdom's own `.value` setter, unlike a
  // real browser's live-typing state, immediately sanitizes any invalid
  // number string back to "" — so `fireEvent.change(el, { target: { value:
  // raw } })` can't reproduce the bug here (jsdom hides it before our
  // onChange even runs). Overriding the `value` getter directly on the node
  // stands in for that real-browser raw value without going through jsdom's
  // sanitizing setter, so the guard is exercised the same way it would be
  // by an actual keystroke.
  function setRawValue(input: HTMLInputElement, raw: string) {
    Object.defineProperty(input, "value", { configurable: true, get: () => raw });
  }

  it.each(["-", "1e", "."])(
    "typing the intermediate invalid value %j fires onValueChange('') rather than NaN",
    (raw) => {
      const onValueChange = vi.fn();
      render(<Controlled initial={5} onValueChange={onValueChange} />);

      const input = screen.getByLabelText("Quantity") as HTMLInputElement;
      setRawValue(input, raw);
      fireEvent.input(input, { bubbles: true });

      expect(onValueChange).toHaveBeenLastCalledWith("");
      expect(onValueChange).not.toHaveBeenCalledWith(NaN);
    },
  );

  it("showSteppers={false} hides the +/- buttons", () => {
    render(<Controlled initial={5} showSteppers={false} />);

    expect(screen.queryByRole("button", { name: "Increase" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Decrease" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Quantity")).toBeInTheDocument();
  });

  it("disables the steppers when the input is disabled", () => {
    render(<Controlled initial={5} disabled />);

    expect(screen.getByRole("button", { name: "Increase" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Decrease" })).toBeDisabled();
    expect(screen.getByLabelText("Quantity")).toBeDisabled();
  });

  it("suppresses the native spinner via the webkit/firefox spinner-hiding class", () => {
    render(<Controlled initial={5} />);

    const input = screen.getByLabelText("Quantity");
    expect(input.className).toContain("[appearance:textfield]");
    expect(input.className).toContain("[&::-webkit-outer-spin-button]:appearance-none");
    expect(input.className).toContain("[&::-webkit-inner-spin-button]:appearance-none");
  });

  it("merges a custom className onto the input", () => {
    render(
      <NumberInput aria-label="Quantity" value={5} onValueChange={() => {}} className="my-extra" />,
    );
    expect(screen.getByLabelText("Quantity")).toHaveClass("my-extra");
  });
});
