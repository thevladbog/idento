import {
  fireEvent, render, screen, within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { PreviewPicker, type PreviewPickerProps } from "./PreviewPicker";
import type { components } from "../../shared/api/schema";
import "../../shared/i18n";

type Attendee = components["schemas"]["Attendee"];

function makeAttendee(overrides: Partial<Attendee> = {}): Attendee {
  return {
    id: "a1",
    event_id: "evt-1",
    first_name: "Zoe",
    last_name: "Zephyr",
    email: "zoe@example.com",
    company: "Acme",
    position: "Engineer",
    code: "PD-0001",
    checkin_status: false,
    printed_count: 0,
    blocked: false,
    packet_delivered: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

// `open`/`onOpenChange` are controlled props (see PreviewPicker.tsx's own
// doc comment on `open` for why BadgeEditorPage needs to own this state
// rather than the component managing it internally) -- this harness plays
// the parent's role so every existing dropdown-interaction test (click to
// open, select an option, type a search) still behaves exactly like the
// real, fully-controlled component.
function renderPicker(overrides: Partial<Omit<PreviewPickerProps, "open" | "onOpenChange">> = {}) {
  const onSearchChange = vi.fn();
  const onSelect = vi.fn();
  const onOpenChange = vi.fn();

  function Harness() {
    const [open, setOpen] = React.useState(false);
    const props: PreviewPickerProps = {
      mode: "attendee",
      attendee: makeAttendee(),
      options: [makeAttendee()],
      search: "",
      onSearchChange,
      onSelect,
      listError: false,
      ...overrides,
      open,
      onOpenChange: (next) => {
        onOpenChange(next);
        setOpen(next);
      },
    };
    return <PreviewPicker {...props} />;
  }

  render(<Harness />);
  return { onSearchChange, onSelect, onOpenChange };
}

describe("PreviewPicker", () => {
  it("shows the current attendee's full name on the trigger", () => {
    renderPicker({ attendee: makeAttendee({ first_name: "Zoe", last_name: "Zephyr" }) });

    expect(screen.getByRole("button", { name: "Zoe Zephyr" })).toBeInTheDocument();
  });

  it("sample mode shows the sample persona's name and the labeled Sample data pill", () => {
    renderPicker({ mode: "sample", attendee: undefined });

    expect(screen.getByRole("button", { name: "Анна Петрова" })).toBeInTheDocument();
    expect(screen.getByText("Sample data")).toBeInTheDocument();
  });

  it("attendee mode with no error shows neither the sample pill nor the error note", () => {
    renderPicker({ mode: "attendee", listError: false });

    expect(screen.queryByText("Sample data")).not.toBeInTheDocument();
    expect(screen.queryByText(/Couldn't load attendees/)).not.toBeInTheDocument();
  });

  it("shows the list-error note when listError is true, distinct from the plain sample label", () => {
    renderPicker({ mode: "sample", attendee: undefined, listError: true });

    expect(screen.getByText("Sample data")).toBeInTheDocument();
    expect(screen.getByText("Couldn't load attendees — showing sample data.")).toBeInTheDocument();
  });

  it("opening the dropdown lists every option by full name", async () => {
    const user = userEvent.setup();
    renderPicker({
      options: [
        makeAttendee({ id: "a1", first_name: "Zoe", last_name: "Zephyr" }),
        makeAttendee({ id: "a2", first_name: "Max", last_name: "Muster" }),
      ],
    });

    await user.click(screen.getByRole("button", { name: "Zoe Zephyr" }));

    expect(screen.getByRole("menuitem", { name: "Zoe Zephyr" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Max Muster" })).toBeInTheDocument();
  });

  it("shows a no-results message instead of an empty menu when options is empty", async () => {
    const user = userEvent.setup();
    renderPicker({ options: [] });

    await user.click(screen.getByRole("button", { name: "Zoe Zephyr" }));

    expect(screen.getByText("No attendees match your search.")).toBeInTheDocument();
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
  });

  it("clicking an option calls onSelect with that exact attendee", async () => {
    const user = userEvent.setup();
    const max = makeAttendee({ id: "a2", first_name: "Max", last_name: "Muster" });
    const { onSelect } = renderPicker({
      options: [makeAttendee({ id: "a1", first_name: "Zoe", last_name: "Zephyr" }), max],
    });

    await user.click(screen.getByRole("button", { name: "Zoe Zephyr" }));
    await user.click(screen.getByRole("menuitem", { name: "Max Muster" }));

    expect(onSelect).toHaveBeenCalledWith(max);
  });

  it("typing into the search box calls onSearchChange with the raw value (debouncing is the hook's job, not this component's)", async () => {
    const user = userEvent.setup();
    const { onSearchChange } = renderPicker();

    await user.click(screen.getByRole("button", { name: "Zoe Zephyr" }));
    const input = screen.getByRole("searchbox", { name: "Search attendees" });
    fireEvent.change(input, { target: { value: "ana" } });

    expect(onSearchChange).toHaveBeenCalledWith("ana");
  });

  it("the search input's value reflects the `search` prop", async () => {
    const user = userEvent.setup();
    renderPicker({ search: "ana" });

    await user.click(screen.getByRole("button", { name: "Zoe Zephyr" }));

    expect(screen.getByRole("searchbox", { name: "Search attendees" })).toHaveValue("ana");
  });

  it("scopes the option list to the dropdown content (not e.g. the pill/label text)", async () => {
    const user = userEvent.setup();
    renderPicker({
      mode: "sample",
      attendee: undefined,
      options: [makeAttendee({ id: "a1", first_name: "Zoe", last_name: "Zephyr" })],
    });

    await user.click(screen.getByRole("button", { name: "Анна Петрова" }));
    const menu = screen.getByRole("menu");

    expect(within(menu).getByRole("menuitem", { name: "Zoe Zephyr" })).toBeInTheDocument();
  });

  // BadgeEditorPage's own page-level Escape (dirty-guard) listener gates on
  // this exact `onOpenChange` callback (lifted up, not internal state -- a
  // DropdownMenu isn't a Dialog, so it needs its OWN explicit open-state
  // check) to avoid ALSO popping the guard dialog when an operator presses
  // Escape only to close this picker. These two tests pin down the
  // open/close SIGNAL this component reports, independent of that page.
  describe("open/onOpenChange (drives BadgeEditorPage's Escape-guard gating)", () => {
    it("reports open=true via onOpenChange when the trigger is clicked", async () => {
      const user = userEvent.setup();
      const { onOpenChange } = renderPicker();

      await user.click(screen.getByRole("button", { name: "Zoe Zephyr" }));

      expect(onOpenChange).toHaveBeenCalledWith(true);
    });

    it("reports open=false via onOpenChange when Escape closes the dropdown", async () => {
      const user = userEvent.setup();
      const { onOpenChange } = renderPicker();

      await user.click(screen.getByRole("button", { name: "Zoe Zephyr" }));
      expect(screen.getByRole("menu")).toBeInTheDocument();
      onOpenChange.mockClear();

      await user.keyboard("{Escape}");

      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });
  });
});
