import { api } from "../../shared/api/http";

// Blob -> save-to-disk side effect (temporary anchor click). Mirrors
// attendees/exportCsv.ts's downloadCsv mechanics but takes an already-built
// Blob so it can carry authed bytes (PNG or CSV) fetched from the API rather
// than a client-built string. Never navigates or window.open()s.
function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

// filenameStem reduces a printer display name to an ASCII filename stem,
// falling back to the id when nothing printable survives (e.g. a fully
// Cyrillic name) — the client-side twin of the backend's slugForFilename,
// needed because a manual anchor download ignores the server's
// Content-Disposition filename.
function filenameStem(name: string, deviceId: string): string {
  const slug = name.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || deviceId;
}

// downloadPrinterPairingQr fetches one network printer's pairing-QR PNG
// through the authed api client (Bearer token via http.ts middleware) and
// saves it. Throws ApiError (errors middleware) on a non-2xx response.
export async function downloadPrinterPairingQr(deviceId: string, displayName: string): Promise<void> {
  const { data } = await api.GET("/api/equipment/devices/{device_id}/pairing-qr.png", {
    params: { path: { device_id: deviceId } },
    parseAs: "blob",
  });
  if (!data) throw new Error("Empty pairing-QR response");
  saveBlob(data, `${filenameStem(displayName, deviceId)}-pairing-qr.png`);
}

// downloadPrinterPairingCsv fetches the tenant's network-printer pairing CSV
// (all printers) through the authed api client and saves it.
export async function downloadPrinterPairingCsv(): Promise<void> {
  const { data } = await api.GET("/api/equipment/printers/pairing-export.csv", {
    parseAs: "blob",
  });
  if (!data) throw new Error("Empty pairing-CSV response");
  saveBlob(data, "printers-pairing.csv");
}
