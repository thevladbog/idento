// Persists the operator's choice of agent connection: "embedded" (default --
// Tauri spawns/manages the bundled sidecar on 127.0.0.1:12345) or "external"
// (a standalone agent already running elsewhere, reached over the network --
// see agent/dist/'s systemd install). Mirrors config.ts's
// getBackendUrl/setBackendUrl localStorage pattern.
export type AgentMode = "embedded" | "external";

const MODE_KEY = "idento_agent_mode";
const EXTERNAL_URL_KEY = "idento_agent_external_url";
const EXTERNAL_TOKEN_KEY = "idento_agent_external_token";

export interface AgentTarget {
  base_url: string;
  token: string;
}

export function getAgentMode(): AgentMode {
  try {
    return localStorage.getItem(MODE_KEY) === "external" ? "external" : "embedded";
  } catch {
    return "embedded";
  }
}

export function setAgentMode(mode: AgentMode): void {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // ignore (storage unavailable, QuotaExceededError, etc.)
  }
}

export function setAgentExternalConfig(baseUrl: string, token: string): void {
  try {
    localStorage.setItem(EXTERNAL_URL_KEY, baseUrl.trim().replace(/\/$/, ""));
    localStorage.setItem(EXTERNAL_TOKEN_KEY, token.trim());
  } catch {
    // ignore
  }
}

export function getAgentExternalConfig(): { baseUrl: string; token: string } {
  try {
    return {
      baseUrl: localStorage.getItem(EXTERNAL_URL_KEY)?.trim() ?? "",
      token: localStorage.getItem(EXTERNAL_TOKEN_KEY)?.trim() ?? "",
    };
  } catch {
    return { baseUrl: "", token: "" };
  }
}

// Returns the target to hand to agent_request/fetch when in external mode
// AND both fields are non-empty; null in every other case (embedded mode,
// or external mode with incomplete config -- callers fall back to the
// embedded/localhost path rather than sending a half-configured request).
export function getAgentTarget(): AgentTarget | null {
  if (getAgentMode() !== "external") return null;
  const { baseUrl, token } = getAgentExternalConfig();
  if (!baseUrl || !token) return null;
  return { base_url: baseUrl, token };
}
