import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { startMswServer } from "../../test/msw";
import { downloadPrinterPairingCsv, downloadPrinterPairingQr } from "./pairingExport";

startMswServer(
  http.get("http://api.test/api/equipment/devices/:deviceId/pairing-qr.png", () =>
    HttpResponse.arrayBuffer(new Uint8Array([137, 80, 78, 71]).buffer, {
      headers: { "Content-Type": "image/png" },
    }),
  ),
  http.get(
    "http://api.test/api/equipment/printers/pairing-export.csv",
    () =>
      new HttpResponse("﻿name,machine\nEntrance,kiosk-1\n", {
        headers: { "Content-Type": "text/csv" },
      }),
  ),
);

describe("pairingExport", () => {
  let downloadName = "";

  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test", AGENT_URL: "http://agent.test" };
    localStorage.clear();
    localStorage.setItem("token", "jwt-test");
    downloadName = "";
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloadName = this.download;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("downloads a pairing QR PNG named from the display name", async () => {
    await downloadPrinterPairingQr("dev-123", "Entrance");
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect((URL.createObjectURL as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBeInstanceOf(Blob);
    expect(downloadName).toBe("Entrance-pairing-qr.png");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock");
  });

  it("falls back to the device id for an all-Cyrillic name", async () => {
    await downloadPrinterPairingQr("dev-xyz", "Зал А");
    expect(downloadName).toBe("dev-xyz-pairing-qr.png");
  });

  it("downloads the pairing CSV", async () => {
    await downloadPrinterPairingCsv();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(downloadName).toBe("printers-pairing.csv");
  });
});
