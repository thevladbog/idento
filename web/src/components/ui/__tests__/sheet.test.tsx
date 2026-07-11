import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "../sheet"
import "../../../i18n"

describe("Sheet", () => {
  it("renders its content with title and description when open", () => {
    render(
      <Sheet open onOpenChange={() => {}}>
        <SheetContent side="right">
          <SheetHeader>
            <SheetTitle>Archive Acme Conf Group</SheetTitle>
            <SheetDescription>Starts a 30-day retention clock.</SheetDescription>
          </SheetHeader>
        </SheetContent>
      </Sheet>
    )
    expect(screen.getByText("Archive Acme Conf Group")).toBeInTheDocument()
    expect(screen.getByText("Starts a 30-day retention clock.")).toBeInTheDocument()
    expect(screen.getByText("Close")).toBeInTheDocument()
  })

  it("applies right-side positioning classes by default", () => {
    render(
      <Sheet open onOpenChange={() => {}}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Right-side sheet</SheetTitle>
          </SheetHeader>
        </SheetContent>
      </Sheet>
    )
    const content = screen.getByText("Right-side sheet").closest('[role="dialog"]')
    expect(content?.className).toContain("right-0")
  })
})
