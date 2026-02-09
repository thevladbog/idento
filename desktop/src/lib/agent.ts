/**
 * Agent API: when running in Tauri, use invoke to proxy requests to the local agent (avoids CORS).
 * In browser dev, call localhost:12345 directly (agent must be running and CORS allows origin).
 */

const FALLBACK_AGENT_URL = "http://localhost:12345";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI__" in window;
}

export async function agentGet(path: string): Promise<string> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("agent_request", { method: "GET", path, body: null });
  }
  const res = await fetch(`${FALLBACK_AGENT_URL}${path}`);
  if (!res.ok) throw new Error(`Agent error: ${res.status}`);
  return res.text();
}

export async function agentPost(path: string, body?: string): Promise<string> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("agent_request", { method: "POST", path, body: body ?? null });
  }
  const res = await fetch(`${FALLBACK_AGENT_URL}${path}`, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
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
