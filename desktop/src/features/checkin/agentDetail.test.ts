import { afterEach, describe, expect, it } from "vitest";
import { setAgentExternalConfig } from "../../lib/agentConfig";
import { formatAgentDetail } from "./agentDetail";

afterEach(() => {
  localStorage.clear();
});

describe("formatAgentDetail", () => {
  it("returns undefined when there is nothing to show", () => {
    expect(formatAgentDetail("embedded", undefined, undefined)).toBeUndefined();
  });

  it("shows the version and embedded port", () => {
    expect(formatAgentDetail("embedded", "1.4.0", 12345)).toBe("v1.4.0 · :12345");
  });

  it("shows just the version when the embedded port is unknown", () => {
    expect(formatAgentDetail("embedded", "1.4.0", undefined)).toBe("v1.4.0");
  });

  it("shows the external host:port instead of the embedded port", () => {
    setAgentExternalConfig("http://192.168.1.50:12345", "tok");
    expect(formatAgentDetail("external", "1.4.0", undefined)).toBe("v1.4.0 · 192.168.1.50:12345");
  });

  it("falls back to just the version when the external URL is malformed", () => {
    setAgentExternalConfig("not-a-url", "tok");
    expect(formatAgentDetail("external", "1.4.0", undefined)).toBe("v1.4.0");
  });
});
