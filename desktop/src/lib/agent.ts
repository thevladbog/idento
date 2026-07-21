/**
 * Agent API: when running in Tauri, use invoke to proxy requests to the local agent (avoids CORS).
 * In browser dev, call localhost:12345 directly (agent must be running and CORS allows origin).
 *
 * Every call resolves the current agent target via agentConfig.ts: "embedded"
 * mode (default) sends `target: null` -- the Rust side (and, in the browser-dev
 * fallback below, the hardcoded FALLBACK_AGENT_URL) treats that as the bundled
 * sidecar at 127.0.0.1:12345 using the locally-persisted token. "external"
 * mode sends the configured { base_url, token } instead.
 */
import { getAgentTarget } from "./agentConfig";

const FALLBACK_AGENT_URL = "http://localhost:12345";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI__" in window;
}

export async function agentGet(path: string): Promise<string> {
  const target = getAgentTarget();
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("agent_request", { method: "GET", path, body: null, target });
  }
  const base = target?.base_url ?? FALLBACK_AGENT_URL;
  const headers = target ? { Authorization: `Bearer ${target.token}` } : undefined;
  const res = await fetch(`${base}${path}`, { headers });
  if (!res.ok) throw new Error(`Agent error: ${res.status}`);
  return res.text();
}

export async function agentPost(path: string, body?: string): Promise<string> {
  const target = getAgentTarget();
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("agent_request", { method: "POST", path, body: body ?? null, target });
  }
  // The agent requires Content-Type: application/json on every mutating request,
  // so set it unconditionally (even for body-less POSTs).
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (target) headers.Authorization = `Bearer ${target.token}`;
  const res = await fetch(`${target?.base_url ?? FALLBACK_AGENT_URL}${path}`, {
    method: "POST",
    headers,
    body,
  });
  if (!res.ok) throw new Error(`Agent error: ${res.status}`);
  return res.text();
}

export async function checkAgentHealth(): Promise<boolean> {
  try {
    const text = await agentGet("/health");
    return text.includes("running") || text.includes("Idento");
  } catch {
    return false;
  }
}

// Atomic read+clear of the agent's scan buffer (agent/openapi.yaml's
// POST /scan/consume) -- unlike the older GET /scan/last + POST /scan/clear
// pair, a scan arriving between a separate read and clear can never be lost.
export async function consumeLastScan(): Promise<{ code: string }> {
  const text = await agentPost("/scan/consume");
  const data = JSON.parse(text) as { code?: string } | null;
  return { code: data?.code ?? "" };
}
