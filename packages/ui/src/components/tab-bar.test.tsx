import { render, screen } from "@testing-library/react";
import { Activity } from "lucide-react";
import { TabBar, TabBarItem } from "./tab-bar";

describe("TabBar", () => {
  it("renders a labelled nav landmark with its items", () => {
    render(
      <TabBar label="Event sections">
        <a href="/monitor" aria-current="page" className="flex flex-1">
          <TabBarItem icon={Activity} label="Monitor" active />
        </a>
      </TabBar>,
    );
    expect(screen.getByRole("navigation", { name: "Event sections" })).toBeInTheDocument();
    expect(screen.getByText("Monitor")).toBeInTheDocument();
  });

  it("shows the attention dot only when badge is set", () => {
    const { rerender } = render(<TabBarItem icon={Activity} label="Monitor" />);
    expect(screen.queryByTestId("tab-bar-badge")).not.toBeInTheDocument();
    rerender(<TabBarItem icon={Activity} label="Monitor" badge />);
    expect(screen.getByTestId("tab-bar-badge")).toBeInTheDocument();
  });

  it("marks the active item with the success tone", () => {
    render(<TabBarItem icon={Activity} label="Monitor" active />);
    expect(screen.getByText("Monitor").parentElement).toHaveClass("text-success");
  });
});
