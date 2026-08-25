import { render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { GuardDialog } from "./GuardDialog";
import "../../shared/i18n";

// The guard's full Discard/Keep/Save FLOW semantics live in
// BadgeEditorPage.test.tsx (the mode-branching owner). This file owns the
// dialog's own focus contract.
describe("GuardDialog initial focus", () => {
  function renderGuard() {
    const handlers = { onDiscard: vi.fn(), onKeep: vi.fn(), onSave: vi.fn() };
    render(
      <GuardDialog
        open
        busy={false}
        saveLabel="Save & leave"
        saveDisabled={false}
        {...handlers}
      />,
    );
    return handlers;
  }

  it("opens with focus on the safe Keep-editing action, not the destructive Discard", async () => {
    renderGuard();
    // Radix's default puts focus on the first tabbable element, which is the
    // DESTRUCTIVE "Discard changes" button here -- one accidental Enter and
    // the operator's unsaved work is gone. The dialog's passive-dismiss
    // semantics (Escape / X / overlay) already mean "keep editing", so the
    // initially-focused action must match that safest interpretation.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Keep editing" })).toHaveFocus(),
    );
    expect(screen.getByRole("button", { name: "Discard changes" })).not.toHaveFocus();
  });
});
