// Mounted once at the app root (see App.tsx), regardless of route. Spawns
// the embedded agent sidecar on boot unless the operator has switched to
// "external" mode (Equipment's toggle calls spawn_agent/stop_agent
// directly on a live switch instead of waiting for this effect to
// re-run -- see Task 6), and keeps the restart supervisor
// (useAgentSupervisor) alive for the whole session.
import { useEffect } from "react";
import { getAgentMode } from "../lib/agentConfig";
import { useAgentSupervisor } from "../features/checkin/useAgentSupervisor";

export function AgentLifecycle() {
  useAgentSupervisor();

  useEffect(() => {
    if (getAgentMode() !== "embedded") return;
    (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("spawn_agent");
      } catch {
        // Not running under Tauri (e.g. `vite dev` in a plain browser), or
        // the bundled sidecar binary is missing in this dev build -- the
        // existing agent-health chip already surfaces "agent unreachable"
        // to the operator either way.
      }
    })();
  }, []);

  return null;
}
