import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { DatePicker } from "./date-picker";

// Finds the calendar day CELL by its `data-day="YYYY-MM-DD"` attribute
// (react-day-picker sets this on every gridcell regardless of locale) and
// returns the button inside it — locale-independent, unlike matching the
// day button's localized `aria-label`.
function dayButton(iso: string): HTMLElement {
  const cell = document.querySelector(`[data-day="${iso}"]`);
  if (!cell) throw new Error(`No calendar cell rendered for ${iso}`);
  const button = cell.querySelector("button");
  if (!button) throw new Error(`No day button rendered for ${iso}`);
  return button as HTMLElement;
}

describe("DatePicker", () => {
  it("shows the placeholder when value is empty", () => {
    render(<DatePicker value="" onValueChange={() => {}} placeholder="Pick a date" />);
    expect(screen.getByRole("button", { name: "Pick a date" })).toBeInTheDocument();
  });

  it("shows the formatted date when a value is set", () => {
    render(<DatePicker value="2026-03-14" onValueChange={() => {}} placeholder="Pick a date" />);
    expect(screen.getByRole("button", { name: "March 14th, 2026" })).toBeInTheDocument();
  });

  it("anchors the open calendar to the value's LOCAL month (not shifted a day earlier by UTC parsing) and calls onValueChange with the clicked day's YYYY-MM-DD", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<DatePicker value="2026-03-01" onValueChange={onValueChange} placeholder="Pick a date" />);

    await user.click(screen.getByRole("button", { name: "March 1st, 2026" }));
    // `new Date("2026-03-01")` (UTC-parsed) rendered with a local formatter
    // west of UTC would show February, not March — this pins the correct,
    // LOCAL-parsed anchor month.
    expect(await screen.findByText("March 2026")).toBeInTheDocument();

    await user.click(dayButton("2026-03-14"));
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith("2026-03-14");
  });

  // The load-bearing test: date-fns `parse(value, "yyyy-MM-dd", new Date())`
  // (LOCAL) in, `format(picked, "yyyy-MM-dd")` (LOCAL) out — never
  // `new Date(iso)`/`toISOString()` (UTC) — must round-trip the exact same
  // calendar day regardless of the runner's timezone. Proven here under a
  // timezone BEHIND UTC (a UTC-parse/local-render mismatch would otherwise
  // silently roll the date back a day).
  it("round-trips a picked day to the identical YYYY-MM-DD under a timezone behind UTC (America/Los_Angeles)", async () => {
    const originalTz = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      const user = userEvent.setup();
      const onValueChange = vi.fn();
      render(<DatePicker value="2026-03-01" onValueChange={onValueChange} placeholder="Pick a date" />);

      await user.click(screen.getByRole("button", { name: "March 1st, 2026" }));
      expect(await screen.findByText("March 2026")).toBeInTheDocument();

      await user.click(dayButton("2026-03-14"));
      expect(onValueChange).toHaveBeenCalledExactlyOnceWith("2026-03-14");
    } finally {
      process.env.TZ = originalTz;
    }
  });

  // Same proof under a timezone AHEAD of UTC (a UTC-parse/local-render
  // mismatch east of UTC would roll the date forward a day instead).
  it("round-trips a picked day to the identical YYYY-MM-DD under a timezone ahead of UTC (Pacific/Kiritimati, UTC+14)", async () => {
    const originalTz = process.env.TZ;
    process.env.TZ = "Pacific/Kiritimati";
    try {
      const user = userEvent.setup();
      const onValueChange = vi.fn();
      render(<DatePicker value="2026-03-01" onValueChange={onValueChange} placeholder="Pick a date" />);

      await user.click(screen.getByRole("button", { name: "March 1st, 2026" }));
      expect(await screen.findByText("March 2026")).toBeInTheDocument();

      await user.click(dayButton("2026-03-14"));
      expect(onValueChange).toHaveBeenCalledExactlyOnceWith("2026-03-14");
    } finally {
      process.env.TZ = originalTz;
    }
  });

  it("renders Russian month names in the calendar header when locale=ru", async () => {
    const user = userEvent.setup();
    render(
      <DatePicker value="2026-03-01" onValueChange={() => {}} locale="ru" placeholder="Выберите дату" />,
    );

    await user.click(screen.getByRole("button", { name: "1 марта 2026 г." }));
    expect(await screen.findByText("март 2026")).toBeInTheDocument();
  });

  it("closes the popover after a day is picked", async () => {
    const user = userEvent.setup();
    render(<DatePicker value="2026-03-01" onValueChange={() => {}} placeholder="Pick a date" />);

    await user.click(screen.getByRole("button", { name: "March 1st, 2026" }));
    expect(await screen.findByText("March 2026")).toBeInTheDocument();

    await user.click(dayButton("2026-03-14"));
    expect(screen.queryByText("March 2026")).not.toBeInTheDocument();
  });

  it("does not open when disabled", async () => {
    const user = userEvent.setup();
    render(<DatePicker value="" onValueChange={() => {}} placeholder="Pick a date" disabled />);

    const trigger = screen.getByRole("button", { name: "Pick a date" });
    expect(trigger).toBeDisabled();
    await user.click(trigger);
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
  });

  // A native `<input type="date">` can be cleared directly (backspace, the
  // browser's built-in ✕); the popover-driven picker has no equivalent
  // gesture, so `clearLabel` opts a consumer into an explicit clear
  // affordance that round-trips to the same empty-string contract.
  describe("clearLabel", () => {
    it("renders no clear affordance when clearLabel is omitted, even with a value set", () => {
      render(<DatePicker value="2026-03-14" onValueChange={() => {}} placeholder="Pick a date" />);
      expect(screen.queryByRole("button", { name: "Clear" })).not.toBeInTheDocument();
    });

    it("renders no clear affordance when the value is empty", () => {
      render(<DatePicker value="" onValueChange={() => {}} placeholder="Pick a date" clearLabel="Clear" />);
      expect(screen.queryByRole("button", { name: "Clear" })).not.toBeInTheDocument();
    });

    it("calls onValueChange('') when the clear affordance is clicked, without opening the calendar", async () => {
      const user = userEvent.setup();
      const onValueChange = vi.fn();
      render(
        <DatePicker value="2026-03-14" onValueChange={onValueChange} placeholder="Pick a date" clearLabel="Clear" />,
      );

      await user.click(screen.getByRole("button", { name: "Clear" }));
      expect(onValueChange).toHaveBeenCalledExactlyOnceWith("");
      expect(screen.queryByRole("grid")).not.toBeInTheDocument();
    });

    it("hides the clear affordance when disabled", () => {
      render(
        <DatePicker
          value="2026-03-14"
          onValueChange={() => {}}
          placeholder="Pick a date"
          clearLabel="Clear"
          disabled
        />,
      );
      expect(screen.queryByRole("button", { name: "Clear" })).not.toBeInTheDocument();
    });

    // Regression: the popover unmounts its Calendar on close, so a naive
    // `defaultMonth={selected}` would jump back to *today's* month on
    // reopen once `value` goes empty via Clear — instead of staying where
    // the user was, which is what a controlled re-select flow needs.
    it("reopens anchored to the last non-empty selected month after Clear, not today's month", async () => {
      const user = userEvent.setup();
      function Controlled() {
        const [value, setValue] = React.useState("2026-03-14");
        return <DatePicker value={value} onValueChange={setValue} placeholder="Pick a date" clearLabel="Clear" />;
      }
      render(<Controlled />);

      await user.click(screen.getByRole("button", { name: "Clear" }));
      await user.click(screen.getByRole("button", { name: "Pick a date" }));
      expect(await screen.findByText("March 2026")).toBeInTheDocument();
    });
  });
});
