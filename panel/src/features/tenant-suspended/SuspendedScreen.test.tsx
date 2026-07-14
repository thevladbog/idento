import { render, screen } from "@testing-library/react";
import { SuspendedScreen } from "./SuspendedScreen";
import "../../shared/i18n";

describe("SuspendedScreen", () => {
  it("renders the paused-account copy with contact support and sign out actions", () => {
    render(<SuspendedScreen />);
    expect(screen.getByText("Your account is paused")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Contact support" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });
});
