import { beforeEach, describe, expect, it } from "vitest";
import type { AgentInfo } from "./agentClient";
import { readCachedAgentInfo, writeCachedAgentInfo } from "./agentInfoCache";

const INFO: AgentInfo = {
  machine_id: "mach-abc123",
  hostname: "kiosk-07",
  version: "1.4.0",
  uptime_seconds: 3600,
};

describe("agentInfoCache", () => {
  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test", AGENT_URL: "http://agent.test" };
    localStorage.clear();
  });

  it("returns null before anything has been cached", () => {
    expect(readCachedAgentInfo()).toBeNull();
  });

  it("round-trips a written value through read", () => {
    writeCachedAgentInfo(INFO);
    expect(readCachedAgentInfo()).toEqual(INFO);
  });

  it("returns null and removes the key when the stored value is malformed JSON", () => {
    localStorage.setItem("idento.agent-info.http://agent.test", "{not-json");
    expect(readCachedAgentInfo()).toBeNull();
    expect(localStorage.getItem("idento.agent-info.http://agent.test")).toBeNull();
  });

  // Board 5d: the hub must keep showing THIS computer's last-known identity
  // while its agent is down -- but a shared panel machine can point at a
  // different AGENT_URL between sessions (or in tests), so the cache must
  // never leak one agent's identity into another's key.
  it("keys the cache by the agent base URL -- a write under one URL is invisible under another", () => {
    writeCachedAgentInfo(INFO);
    expect(readCachedAgentInfo()).toEqual(INFO);

    window.__ENV__ = { API_URL: "http://api.test", AGENT_URL: "http://other-agent.test" };
    expect(readCachedAgentInfo()).toBeNull();

    window.__ENV__ = { API_URL: "http://api.test", AGENT_URL: "http://agent.test" };
    expect(readCachedAgentInfo()).toEqual(INFO);
  });
});
