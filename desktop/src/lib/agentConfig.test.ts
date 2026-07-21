import { afterEach, describe, expect, it } from "vitest";
import {
  getAgentExternalConfig,
  getAgentMode,
  getAgentTarget,
  setAgentExternalConfig,
  setAgentMode,
} from "./agentConfig";

afterEach(() => {
  localStorage.clear();
});

describe("getAgentMode / setAgentMode", () => {
  it("defaults to embedded", () => {
    expect(getAgentMode()).toBe("embedded");
  });

  it("round-trips external", () => {
    setAgentMode("external");
    expect(getAgentMode()).toBe("external");
  });

  it("treats any other stored value as embedded", () => {
    localStorage.setItem("idento_agent_mode", "bogus");
    expect(getAgentMode()).toBe("embedded");
  });
});

describe("setAgentExternalConfig / getAgentExternalConfig", () => {
  it("trims whitespace and strips a trailing slash from the URL", () => {
    setAgentExternalConfig("  http://192.168.1.50:12345/  ", "  tok  ");
    expect(getAgentExternalConfig()).toEqual({ baseUrl: "http://192.168.1.50:12345", token: "tok" });
  });

  it("returns empty strings when nothing has been saved yet", () => {
    expect(getAgentExternalConfig()).toEqual({ baseUrl: "", token: "" });
  });
});

describe("getAgentTarget", () => {
  it("returns null in embedded mode even if external fields are set", () => {
    setAgentExternalConfig("http://192.168.1.50:12345", "tok");
    expect(getAgentTarget()).toBeNull();
  });

  it("returns null in external mode when the token is missing", () => {
    setAgentMode("external");
    setAgentExternalConfig("http://192.168.1.50:12345", "");
    expect(getAgentTarget()).toBeNull();
  });

  it("returns null in external mode when the URL is missing", () => {
    setAgentMode("external");
    setAgentExternalConfig("", "tok");
    expect(getAgentTarget()).toBeNull();
  });

  it("returns the target in external mode with both fields set", () => {
    setAgentMode("external");
    setAgentExternalConfig("http://192.168.1.50:12345", "tok");
    expect(getAgentTarget()).toEqual({ base_url: "http://192.168.1.50:12345", token: "tok" });
  });
});
