// Mounted once at the app root (see App.tsx), regardless of route. Spawns
// the embedded agent sidecar on boot unless the operator has switched to
// "external" mode (Equipment's toggle calls spawn_agent/stop_agent
// directly on a live switch instead of waiting for this effect to
// re-run -- see Task 6), and keeps the restart supervisor
// (useAgentSupervisor) alive for the whole session.
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { getAgentMode } from "../lib/agentConfig";
import { useAgentSupervisor } from "../features/checkin/useAgentSupervisor";

const SELF_SERVICE_PATH = /^\/checkin\/[^/]+\/self$/;

export function AgentLifecycle() {
  useAgentSupervisor();
  const location = useLocation();

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

  // Unconditional (except for one guard below), independent of agent mode:
  // releases any stale Rust-side lockdown left over from a hard
  // `window.location.href` redirect (e.g. the api.ts 401 interceptor) that
  // tore down SelfServicePage's document before its unmount cleanup could
  // run exit_lockdown. This effect re-fires on every fresh webview boot --
  // including the redirect-driven reload, since that reload re-executes the
  // whole React tree from scratch. On a truly first-ever boot it's a
  // harmless no-op: LockdownState already defaults to false and the window
  // is already unlocked.
  //
  // Guard: skip entirely if the boot itself landed directly on the
  // self-service route (e.g. a plain webview reload while already on
  // /checkin/:eventId/self, not the redirect-to-/login scenario above) --
  // otherwise this effect's exit_lockdown races SelfServicePage's own
  // enter_lockdown call, and if this one resolves last, the kiosk ends up
  // showing the self-service screen with no lockdown engaged at all.
  useEffect(() => {
    if (SELF_SERVICE_PATH.test(location.pathname)) return;
    (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("exit_lockdown");
      } catch (error) {
        console.error("exit_lockdown failed (AgentLifecycle boot):", error);
      }
    })();
    // Deliberately checks location.pathname only once, at this component's
    // one-time app-root mount (a fresh webview boot) -- not reactively on
    // every later client-side navigation, which would reintroduce the same
    // race against a genuine later SelfServicePage mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
