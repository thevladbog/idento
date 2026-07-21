import { afterEach, describe, expect, it, vi } from "vitest";
import { consumeLastScan } from "./agent";

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
