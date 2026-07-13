import { render, screen } from "@testing-library/react";
import { AGENT_STATES, AgentStatus } from "./agent-status";

describe("AgentStatus", () => {
  it("covers the three states", () => {
    expect(AGENT_STATES).toEqual(["connected", "stale", "disconnected"]);
  });

  it.each(AGENT_STATES)("renders %s with title, detail and an icon", (state) => {
    const { container } = render(
      <AgentStatus state={state} title={`title-${state}`} detail={`detail-${state}`} />,
    );
    expect(screen.getByText(`title-${state}`)).toBeInTheDocument();
    expect(screen.getByText(`detail-${state}`)).toBeInTheDocument();
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.firstChild).toHaveAttribute("data-state", state);
  });

  it("renders an action slot", () => {
    render(<AgentStatus state="disconnected" title="Agent disconnected" action={<button>Retry</button>} />);
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
