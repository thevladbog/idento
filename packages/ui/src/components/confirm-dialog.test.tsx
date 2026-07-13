import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { Button } from "./button";
import { ConfirmDialog } from "./confirm-dialog";

function Harness(props: { typedConfirmation?: string; onConfirm: () => void; destructive?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Trigger</Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete event"
        description="This cannot be undone."
        confirmLabel="Delete event"
        cancelLabel="Cancel"
        closeLabel="Close"
        typedConfirmationLabel="Type partner-day-2026 to confirm"
        {...props}
      />
    </>
  );
}

describe("ConfirmDialog tier 1 (plain)", () => {
  it("fires onConfirm on click", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    await user.click(screen.getByRole("button", { name: "Trigger" }));
    await user.click(screen.getByRole("button", { name: "Delete event" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("cancel closes without confirming", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    await user.click(screen.getByRole("button", { name: "Trigger" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("ConfirmDialog tier 2 (typed)", () => {
  it("keeps confirm disabled until the exact string is typed", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} typedConfirmation="partner-day-2026" destructive />);
    await user.click(screen.getByRole("button", { name: "Trigger" }));

    const confirm = screen.getByRole("button", { name: "Delete event" });
    expect(confirm).toBeDisabled();

    await user.type(screen.getByLabelText("Type partner-day-2026 to confirm"), "partner-day");
    expect(confirm).toBeDisabled();

    await user.type(screen.getByLabelText("Type partner-day-2026 to confirm"), "-2026");
    expect(confirm).toBeEnabled();

    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
