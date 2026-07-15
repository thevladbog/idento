import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AttendeeTable } from "./AttendeeTable";
import "../../shared/i18n";
import type { components } from "../../shared/api/schema";

type Attendee = components["schemas"]["Attendee"];

function makeAttendee(overrides: Partial<Attendee> = {}): Attendee {
  return {
    id: "a1",
    event_id: "evt-1",
    first_name: "Ada",
    last_name: "Lovelace",
    email: "ada@example.com",
    company: "Analytical Engines",
    position: "Engineer",
    code: "PD-0107",
    checkin_status: false,
    printed_count: 0,
    blocked: false,
    packet_delivered: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const ADA = makeAttendee({ id: "a1" });

// Task/Fix 2 (a11y): the row opens the attendee drawer on click, but must
// also be reachable and activatable via keyboard, and keyboard activation of
// the row must not interfere with the checkbox/row-menu's own independent
// focus and activation.
describe("AttendeeTable row keyboard accessibility", () => {
  it("tabs to a row and activates it with Enter", async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    render(
      <AttendeeTable
        rows={[ADA]}
        selected={new Set()}
        onToggle={vi.fn()}
        onToggleAll={vi.fn()}
        onRowClick={onRowClick}
      />,
    );

    await user.tab(); // header "select all" checkbox
    await user.tab(); // the row itself (it precedes its own checkbox child in source/tab order)
    const row = screen.getByRole("button", { name: "Open Ada Lovelace" });
    expect(row).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(onRowClick).toHaveBeenCalledWith("a1");
  });

  it("tabs to a row and activates it with Space, without scrolling the page", async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    render(
      <AttendeeTable
        rows={[ADA]}
        selected={new Set()}
        onToggle={vi.fn()}
        onToggleAll={vi.fn()}
        onRowClick={onRowClick}
      />,
    );

    const row = screen.getByRole("button", { name: "Open Ada Lovelace" });
    row.focus();
    await user.keyboard(" ");
    expect(onRowClick).toHaveBeenCalledWith("a1");
  });

  it("keeps the checkbox and row-menu button independently focusable, and neither their click nor their keyboard activation also triggers onRowClick", async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    const onToggle = vi.fn();
    render(
      <AttendeeTable
        rows={[ADA]}
        selected={new Set()}
        onToggle={onToggle}
        onToggleAll={vi.fn()}
        onRowClick={onRowClick}
      />,
    );

    const checkbox = screen.getByRole("checkbox", { name: "Select Ada Lovelace" });
    await user.click(checkbox);
    expect(onToggle).toHaveBeenCalledWith("a1");
    expect(onRowClick).not.toHaveBeenCalled();

    const menuButton = screen.getByRole("button", { name: "More actions for Ada Lovelace" });
    menuButton.focus();
    expect(menuButton).toHaveFocus();
  });

  it("does not trigger onRowClick when Enter/Space is pressed while the checkbox has focus", async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    const onToggle = vi.fn();
    render(
      <AttendeeTable
        rows={[ADA]}
        selected={new Set()}
        onToggle={onToggle}
        onToggleAll={vi.fn()}
        onRowClick={onRowClick}
      />,
    );

    const checkbox = screen.getByRole("checkbox", { name: "Select Ada Lovelace" });
    checkbox.focus();
    await user.keyboard(" ");

    expect(onToggle).toHaveBeenCalledWith("a1");
    expect(onRowClick).not.toHaveBeenCalled();
  });
});
