// P4.3 Task 7 -- AgentCard: board 5a (connected/legacy) and 5d (agent down)
// agent identity card. Exercised directly against `UseAgentInfoResult`
// shapes (not through useAgentInfo/MSW) -- this component's own state
// machine over `state`/`info`/`cachedInfo`/`refetch` is the unit under
// test; EquipmentPage.test.tsx covers the real hook wiring end-to-end.
import { render, screen } from "@testing-library/react";
import { AgentCard } from "./AgentCard";
import type { AgentInfo } from "../../shared/agent/agentClient";
import type { UseAgentInfoResult } from "../../shared/agent/useAgentInfo";
import "../../shared/i18n";

const INFO: AgentInfo = {
  machine_id: "mach-1",
  hostname: "REG-DESK-01",
  version: "1.9.0",
  uptime_seconds: 3 * 3600 + 12 * 60,
};

function result(overrides: Partial<UseAgentInfoResult>): UseAgentInfoResult {
  return {
    state: "checking",
    info: null,
    cachedInfo: null,
    refetch: vi.fn(),
    ...overrides,
  };
}

describe("AgentCard", () => {
  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test", AGENT_URL: "http://agent.test" };
  });

  it("connected: shows the agent title, a Connected pill, and a meta line with version + hostname + an uptime fragment", () => {
    render(<AgentCard agent={result({ state: "connected", info: INFO })} />);

    expect(screen.getByText("Idento Agent — this computer")).toBeInTheDocument();
    expect(screen.getByText("Print agent connected")).toBeInTheDocument();
    expect(screen.getByText(/v1\.9\.0/)).toBeInTheDocument();
    expect(screen.getByText(/REG-DESK-01/)).toBeInTheDocument();
    expect(screen.getByText(/uptime 3 h 12 m/)).toBeInTheDocument();
  });

  it("connected_legacy: shows a live-only Connected pill + the update hint, with no version/hostname meta (info is null)", () => {
    render(<AgentCard agent={result({ state: "connected_legacy", info: null, cachedInfo: INFO })} />);

    expect(screen.getByText("Print agent connected")).toBeInTheDocument();
    expect(screen.getByText("Update the agent to save devices to your organization")).toBeInTheDocument();
    expect(screen.queryByText(/v1\.9\.0/)).not.toBeInTheDocument();
    expect(screen.queryByText(/uptime/)).not.toBeInTheDocument();
  });

  it("connected: joins only non-empty meta segments -- a blank hostname must not leave a dangling '· ·' gap", () => {
    render(<AgentCard agent={result({ state: "connected", info: { ...INFO, hostname: "" } })} />);

    expect(screen.getByText("agent.test · v1.9.0 · uptime 3 h 12 m")).toBeInTheDocument();
    expect(screen.queryByText(/·\s*·/)).not.toBeInTheDocument();
  });

  it("checking: maps to AgentStatus's stale state with the checking pill text", () => {
    render(<AgentCard agent={result({ state: "checking" })} />);

    expect(screen.getByText("Checking for the print agent…")).toBeInTheDocument();
    expect(screen.getByTestId("equipment-agent-card").querySelector('[data-state="stale"]')).not.toBeNull();
  });

  describe("disconnected (board 5d)", () => {
    it("shows the down title, Disconnected pill, hint, start steps, auto-retry caption, and a working Retry button", () => {
      const refetch = vi.fn();
      render(<AgentCard agent={result({ state: "disconnected", refetch })} />);

      expect(screen.getByText("Agent not reachable")).toBeInTheDocument();
      expect(screen.getByText("Print agent unreachable")).toBeInTheDocument();
      expect(screen.getByText("Printing and scanning are unavailable on this computer until it's running.")).toBeInTheDocument();
      expect(screen.getByText(/system tray/)).toBeInTheDocument();
      expect(screen.getByText("auto-retry in 8 s")).toBeInTheDocument();

      const retryButton = screen.getByRole("button", { name: "Retry connection" });
      retryButton.click();
      expect(refetch).toHaveBeenCalledTimes(1);
    });

    it("defaults the download link to the GitHub releases page when AGENT_DOWNLOAD_URL is unset", () => {
      render(<AgentCard agent={result({ state: "disconnected" })} />);

      expect(screen.getByRole("link", { name: "Download the agent" })).toHaveAttribute(
        "href",
        "https://github.com/thevladbog/idento/releases",
      );
    });

    it("uses window.__ENV__.AGENT_DOWNLOAD_URL for the download link when configured", () => {
      window.__ENV__ = {
        API_URL: "http://api.test",
        AGENT_URL: "http://agent.test",
        AGENT_DOWNLOAD_URL: "https://internal.example.com/agent",
      };
      render(<AgentCard agent={result({ state: "disconnected" })} />);

      expect(screen.getByRole("link", { name: "Download the agent" })).toHaveAttribute(
        "href",
        "https://internal.example.com/agent",
      );
    });
  });
});
