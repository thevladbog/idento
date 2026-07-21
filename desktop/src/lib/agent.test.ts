import { afterEach, describe, expect, it, vi } from "vitest";
import { setAgentExternalConfig, setAgentMode } from "./agentConfig";
import { agentGet, agentPost, consumeLastScan } from "./agent";

describe("consumeLastScan", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("POSTs /scan/consume and returns the code", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ code: "EVT-123", time: "2026-07-21T00:00:00Z" })),
    } as Response);

    const result = await consumeLastScan();

    expect(result).toEqual({ code: "EVT-123" });
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:12345/scan/consume",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("returns an empty code when the buffer was empty", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ code: "", time: "0001-01-01T00:00:00Z" })),
    } as Response);

    expect(await consumeLastScan()).toEqual({ code: "" });
  });
});

describe("agentGet / agentPost with an external target configured", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("agentGet sends the external base URL and bearer token", async () => {
    setAgentMode("external");
    setAgentExternalConfig("http://192.168.1.50:12345", "tok-123");
    vi.spyOn(global, "fetch").mockResolvedValue({ ok: true, text: () => Promise.resolve("ok") } as Response);

    await agentGet("/health");

    expect(global.fetch).toHaveBeenCalledWith(
      "http://192.168.1.50:12345/health",
      expect.objectContaining({ headers: { Authorization: "Bearer tok-123" } }),
    );
  });

  it("agentPost sends the external base URL, bearer token, and JSON content-type", async () => {
    setAgentMode("external");
    setAgentExternalConfig("http://192.168.1.50:12345", "tok-123");
    vi.spyOn(global, "fetch").mockResolvedValue({ ok: true, text: () => Promise.resolve("{}") } as Response);

    await agentPost("/print", "{}");

    expect(global.fetch).toHaveBeenCalledWith(
      "http://192.168.1.50:12345/print",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer tok-123" },
        body: "{}",
      }),
    );
  });
});
