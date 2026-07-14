import { render, screen } from "@testing-library/react";
import { PlaceholderPage } from "./PlaceholderPage";
import "../i18n";

describe("PlaceholderPage", () => {
  it("renders the given title and the coming-soon note", () => {
    render(<PlaceholderPage titleKey="navTeam" />);
    expect(screen.getByRole("heading", { name: "Team" })).toBeInTheDocument();
    expect(screen.getByText("This section is coming in a later phase.")).toBeInTheDocument();
  });
});
