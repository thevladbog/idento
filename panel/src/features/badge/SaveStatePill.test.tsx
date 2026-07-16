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

describe("SaveStatePill", () => {
  it("renders nothing for the null state", () => {
    const { container } = render(
      <SaveStatePill dirty={false} isPending={false} conflict={false} savedAt={null} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the Saving pill while pending", () => {
    render(<SaveStatePill dirty isPending conflict={false} savedAt={null} />);
    const pill = screen.getByTestId("badge-save-state-pill");
    expect(pill).toHaveAttribute("data-state", "saving");
    expect(pill).toHaveTextContent("Saving…");
  });

  it("renders the Unsaved changes pill while dirty", () => {
    render(<SaveStatePill dirty isPending={false} conflict={false} savedAt={null} />);
    const pill = screen.getByTestId("badge-save-state-pill");
    expect(pill).toHaveAttribute("data-state", "dirty");
    expect(pill).toHaveTextContent("Unsaved changes");
  });

  it("renders the Conflict pill", () => {
    render(<SaveStatePill dirty={false} isPending={false} conflict savedAt={null} />);
    const pill = screen.getByTestId("badge-save-state-pill");
    expect(pill).toHaveAttribute("data-state", "conflict");
    expect(pill).toHaveTextContent("Conflict");
  });

  it("renders the Saved pill with a formatted time", () => {
    render(<SaveStatePill dirty={false} isPending={false} conflict={false} savedAt="2026-07-16T12:34:00Z" />);
    const pill = screen.getByTestId("badge-save-state-pill");
    expect(pill).toHaveAttribute("data-state", "saved");
    expect(pill.textContent).toMatch(/^Saved · /);
  });
});
