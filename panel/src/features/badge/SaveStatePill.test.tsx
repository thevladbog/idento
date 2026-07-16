import { render, screen } from "@testing-library/react";
import { computeSaveState, SaveStatePill } from "./SaveStatePill";
import "../../shared/i18n";

describe("computeSaveState", () => {
  it("returns null for a freshly-loaded, never-edited-or-saved template", () => {
    expect(computeSaveState({ dirty: false, isPending: false, conflict: false, savedAt: null })).toBeNull();
  });

  it("returns 'dirty' once edited", () => {
    expect(computeSaveState({ dirty: true, isPending: false, conflict: false, savedAt: null })).toBe("dirty");
  });

  it("returns 'saved' once clean with a savedAt timestamp", () => {
    expect(computeSaveState({ dirty: false, isPending: false, conflict: false, savedAt: "2026-07-16T12:00:00Z" })).toBe(
      "saved",
    );
  });

  it("'isPending' outranks 'dirty' and 'conflict' — the pill shows Saving mid-flight even though dirty stays true underneath", () => {
    expect(computeSaveState({ dirty: true, isPending: true, conflict: false, savedAt: null })).toBe("saving");
    expect(computeSaveState({ dirty: true, isPending: true, conflict: true, savedAt: null })).toBe("saving");
  });

  it("'conflict' outranks 'dirty' — a 409'd save stays Conflict, not Unsaved, even though dirty is still true", () => {
    expect(computeSaveState({ dirty: true, isPending: false, conflict: true, savedAt: null })).toBe("conflict");
  });

  it("'dirty' outranks a stale 'savedAt' — editing again after a save must not still read as Saved", () => {
    expect(computeSaveState({ dirty: true, isPending: false, conflict: false, savedAt: "2026-07-16T12:00:00Z" })).toBe(
      "dirty",
    );
  });
});

// Codex round (Fix 5): SaveStatePill is now a thin wrapper around
// @idento/ui's shared StatusPill instead of a hand-rolled pill. These tests
// assert the rendered StatusPill's SEMANTICS — its `data-status`, visible
// label text, and which lucide icon it renders (lucide-react stamps a
// `lucide-<kebab-name>` class on every icon's own `<svg>`, e.g. "Loader2" ->
// "lucide-loader-circle" — a stable, non-fragile way to assert which icon
// rendered without depending on StatusPill's internal DOM structure) —
// rather than the OLD pill's own hand-rolled className/icon wiring. The
// `data-testid="badge-save-state-pill"` + `data-state="..."` attributes stay
// on an outer wrapper `<span>` (not StatusPill's own `data-status`, which
// carries the STATUS name like "in_progress", not the SAVE state like
// "dirty") specifically so BadgeEditorPage.test.tsx's many existing
// `data-state` assertions keep working untouched.
describe("SaveStatePill", () => {
  it("renders nothing for the null state", () => {
    const { container } = render(<SaveStatePill dirty={false} isPending={false} conflict={false} savedAt={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the Saving pill via StatusPill's 'empty' status (muted, per board 4c), with a spinning Loader2 icon", () => {
    const { container } = render(<SaveStatePill dirty isPending conflict={false} savedAt={null} />);
    const wrapper = screen.getByTestId("badge-save-state-pill");
    expect(wrapper).toHaveAttribute("data-state", "saving");
    expect(wrapper).toHaveTextContent("Saving…");
    const statusPill = wrapper.querySelector("[data-status]");
    expect(statusPill).toHaveAttribute("data-status", "empty");
    // "empty" doesn't auto-spin its icon (only "in_progress" does, in
    // StatusPill's own code) — the spin here comes from this explicit
    // `[&_svg]:animate-spin` override class on the StatusPill wrapper (a
    // literal DOM class we CAN assert in jsdom; the actual visual spin it
    // produces via the CSS cascade is a browser-only effect, not something
    // jsdom's non-CSS DOM renders/computes).
    expect(statusPill).toHaveClass("[&_svg]:animate-spin");
    expect(container.querySelector("svg")).toHaveClass("lucide-loader-circle");
  });

  it("renders the Unsaved changes pill via StatusPill's 'in_progress' status (warning colors), with a non-spinning Pencil icon override", () => {
    const { container } = render(<SaveStatePill dirty isPending={false} conflict={false} savedAt={null} />);
    const wrapper = screen.getByTestId("badge-save-state-pill");
    expect(wrapper).toHaveAttribute("data-state", "dirty");
    expect(wrapper).toHaveTextContent("Unsaved changes");
    const statusPill = wrapper.querySelector("[data-status]");
    expect(statusPill).toHaveAttribute("data-status", "in_progress");
    // "in_progress"'s own default icon is Loader2 (a spinner) — overridden to
    // a static Pencil (reads as "unsaved edits") so "Unsaved changes" never
    // visually claims a save is already in flight; that reading belongs to
    // "saving" above. StatusPill unconditionally adds a literal
    // `animate-spin` class to WHICHEVER icon renders under "in_progress"
    // (packages/ui/src/components/status-pill.tsx) — that class is still
    // present on the icon in the DOM (asserted below), but this `className`
    // override adds `[&_svg]:animate-none` on the wrapper, a class+element
    // descendant selector that outranks the icon's own single-class
    // `animate-spin` on CSS specificity alone (same idiom as BulkBar.tsx's
    // `[&_svg]:size-4` override) and neutralizes the spin visually in a real
    // browser — not something jsdom's non-CSS rendering can assert directly.
    expect(statusPill).toHaveClass("[&_svg]:animate-none");
    const icon = container.querySelector("svg");
    expect(icon).toHaveClass("lucide-pencil");
    expect(icon).toHaveClass("animate-spin");
  });

  it("renders the Conflict pill via StatusPill's 'error' status", () => {
    const { container } = render(<SaveStatePill dirty={false} isPending={false} conflict savedAt={null} />);
    const wrapper = screen.getByTestId("badge-save-state-pill");
    expect(wrapper).toHaveAttribute("data-state", "conflict");
    expect(wrapper).toHaveTextContent("Conflict");
    expect(wrapper.querySelector("[data-status]")).toHaveAttribute("data-status", "error");
    expect(container.querySelector("svg")).toHaveClass("lucide-circle-alert");
  });

  it("renders the Saved pill via StatusPill's 'ready' status, with a formatted time", () => {
    const { container } = render(
      <SaveStatePill dirty={false} isPending={false} conflict={false} savedAt="2026-07-16T12:34:00Z" />,
    );
    const wrapper = screen.getByTestId("badge-save-state-pill");
    expect(wrapper).toHaveAttribute("data-state", "saved");
    expect(wrapper.textContent).toMatch(/^Saved · /);
    expect(wrapper.querySelector("[data-status]")).toHaveAttribute("data-status", "ready");
    expect(container.querySelector("svg")).toHaveClass("lucide-circle-check");
  });
});
