import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { Button } from "./button";
import { ConfirmDialog } from "./confirm-dialog";

type HarnessProps = { onConfirm: () => void; destructive?: boolean } & (
  | { typedConfirmation?: undefined }
  | { typedConfirmation: string }
);

function Harness(props: HarnessProps) {
  const [open, setOpen] = useState(false);
  const common = {
    open,
    onOpenChange: setOpen,
    title: "Delete event",
    description: "This cannot be undone.",
    confirmLabel: "Delete event",
    cancelLabel: "Cancel",
    closeLabel: "Close",
    onConfirm: props.onConfirm,
    destructive: props.destructive,
  };
  return (
    <>
      <Button onClick={() => setOpen(true)}>Trigger</Button>
      {props.typedConfirmation !== undefined ? (
        <ConfirmDialog
          {...common}
          typedConfirmation={props.typedConfirmation}
          typedConfirmationLabel="Type partner-day-2026 to confirm"
        />
      ) : (
        <ConfirmDialog {...common} />
      )}
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
