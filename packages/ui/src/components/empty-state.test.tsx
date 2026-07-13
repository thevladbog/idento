import { render, screen } from "@testing-library/react";
import { Users } from "lucide-react";
import { Button } from "./button";
import { EmptyState } from "./empty-state";
import { Skeleton } from "./skeleton";

describe("EmptyState", () => {
  it("renders icon, title, description and actions", () => {
    render(
      <EmptyState
        icon={Users}
        title="No attendees yet"
        description="Import your guest list from a CSV."
        actions={<Button>Import CSV</Button>}
      />,
    );
    expect(screen.getByText("No attendees yet")).toBeInTheDocument();
    expect(screen.getByText("Import your guest list from a CSV.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import CSV" })).toBeInTheDocument();
  });
});

describe("Skeleton", () => {
  it("renders a pulsing token-based placeholder", () => {
    const { container } = render(<Skeleton className="h-4 w-32" />);
    expect(container.firstChild).toHaveClass("animate-pulse", "bg-muted");
  });
});
