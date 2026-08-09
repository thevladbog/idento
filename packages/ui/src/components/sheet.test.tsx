import { render, screen } from "@testing-library/react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "./sheet";

describe("Sheet", () => {
  it("omits the close button entirely when hideClose is set", () => {
    render(
      <Sheet open>
        <SheetContent side="bottom" closeLabel="Close" hideClose>
          <SheetHeader><SheetTitle>Checking in</SheetTitle></SheetHeader>
        </SheetContent>
      </Sheet>,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
  });
});
