import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "./button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "./dialog";

function TestDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>Open</Button>
      </DialogTrigger>
      <DialogContent closeLabel="Close">
        <DialogHeader>
          <DialogTitle>Remove Igor from staff?</DialogTitle>
          <DialogDescription>His QR login stops working.</DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}

function TestDialogNoClose() {
  return (
    <Dialog open>
      <DialogContent closeLabel="Close" hideClose>
        <DialogHeader>
          <DialogTitle>Import in progress</DialogTitle>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}

describe("Dialog", () => {
  it("opens on trigger click and renders content with a close button", async () => {
    const user = userEvent.setup();
    render(<TestDialog />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Remove Igor from staff?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("omits the close button entirely when hideClose is set", () => {
    render(<TestDialogNoClose />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    render(<TestDialog />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("uses the dark-in-both-themes overlay token, not text-derived foreground", async () => {
    const user = userEvent.setup();
    const { baseElement } = render(<TestDialog />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    const overlay = baseElement.querySelector('[class*="bg-overlay"]');
    expect(overlay).not.toBeNull();
    expect(baseElement.querySelector('[class*="bg-foreground/40"]')).toBeNull();
  });
});
