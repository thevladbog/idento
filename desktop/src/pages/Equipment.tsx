import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import QRCode from "qrcode";
import { Printer, ScanLine, PlusCircle, CheckCircle, Trash2, Star } from "lucide-react";
import { PreflightShell, KioskButton, KioskInput } from "@idento/ui/kiosk";
import { checkAgentHealth, agentGet, agentPost } from "@/lib/agent";
import {
  type AgentMode,
  getAgentExternalConfig,
  getAgentMode,
  setAgentExternalConfig,
  setAgentMode,
} from "@/lib/agentConfig";
import { useRegisterStation } from "@/features/checkin/hooks";
import { usePreflightSteps } from "@/features/preflight/steps";
import { toast } from "sonner";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { UpdateChip } from "@/components/UpdateChip";

type PrinterEntry = { name: string; type?: string };
type ScannerEntry = string | { name: string; port_name?: string };

function parsePrinters(text: string): PrinterEntry[] {
  try {
    const data = JSON.parse(text);
    if (!Array.isArray(data)) return [];
    return data.map((p: { name?: string; type?: string } | string) =>
      typeof p === "string" ? { name: p } : { name: p.name ?? String(p), type: p.type }
    );
  } catch {
    return [];
  }
}

function parseScanners(text: string): string[] {
  try {
    const data = JSON.parse(text);
    if (!Array.isArray(data)) return [];
    return data.map((s: ScannerEntry) => (typeof s === "string" ? s : s.name ?? s.port_name ?? String(s)));
  } catch {
    return [];
  }
}

export default function EquipmentPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { eventId } = useParams<{ eventId: string }>();
  const steps = usePreflightSteps();
  const [agentConnected, setAgentConnected] = useState(false);
  const [agentUnauthorized, setAgentUnauthorized] = useState(false);
  const [printers, setPrinters] = useState<PrinterEntry[]>([]);
  const [scanners, setScanners] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const [networkName, setNetworkName] = useState("");
  const [networkIP, setNetworkIP] = useState("");
  const [networkPort, setNetworkPort] = useState("9100");
  const [scannerPort, setScannerPort] = useState("");
  const [availablePorts, setAvailablePorts] = useState<{ port_name: string }[]>([]);
  const [defaultPrinter, setDefaultPrinter] = useState<string | null>(null);

  const [testCode, setTestCode] = useState("");
  const [testQRImage, setTestQRImage] = useState("");
  const [testResult, setTestResult] = useState<"idle" | "waiting" | "success" | "fail" | "timeout">("idle");
  const [testPolling, setTestPolling] = useState(false);
  const scannerTestTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stationIdKey = `idento_station_id:${eventId}`;
  const [stationName, setStationName] = useState("");
  const [stationId, setStationId] = useState<string | null>(() => localStorage.getItem(stationIdKey));
  const registerStation = useRegisterStation(eventId!);
  const [agentMode, setAgentModeState] = useState<AgentMode>(getAgentMode);
  const [externalUrl, setExternalUrl] = useState(() => getAgentExternalConfig().baseUrl);
  const [externalToken, setExternalToken] = useState(() => getAgentExternalConfig().token);

  const registerStationAction = async () => {
    if (!stationName.trim()) return;
    try {
      const station = await registerStation.mutateAsync({ name: stationName.trim() });
      localStorage.setItem(stationIdKey, station.id);
      setStationId(station.id);
      toast.success(t("stationRegistered"));
    } catch {
      toast.error(t("stationRegisterFailed"));
    }
  };

  // Deliberately NOT shared with the mount effect above (which guards its
  // setState calls with a `cancelled` flag for a fast unmount mid-fetch):
  // this function only ever runs from a direct user action (toggling the
  // mode, clicking Save), where an unmount-mid-flight is a much rarer race
  // than during the initial page-load effect, so the extra guard isn't
  // worth threading through a shared helper here.
  const reconnectAgent = async () => {
    setLoading(true);
    setAgentUnauthorized(false);
    const ok = await checkAgentHealth();
    setAgentConnected(ok);
    if (!ok) {
      setPrinters([]);
      setScanners([]);
      setAvailablePorts([]);
      setDefaultPrinter(null);
      setLoading(false);
      return;
    }
    try {
      const data = await fetchEquipmentData();
      setPrinters(data.printers);
      setScanners(data.scanners);
      setAvailablePorts(data.availablePorts);
      setDefaultPrinter(data.defaultPrinter);
    } catch (e) {
      // /health ignores the token, so a mistyped external token still shows
      // "connected" here -- but the very first real endpoint call (this one)
      // 401s. Surface that distinctly instead of silently emptying the lists.
      if (e instanceof Error && e.message.includes("401")) {
        setAgentUnauthorized(true);
      }
      setPrinters([]);
      setScanners([]);
      setAvailablePorts([]);
      setDefaultPrinter(null);
    }
    setLoading(false);
  };

  const switchAgentMode = async (mode: AgentMode) => {
    if (mode === agentMode) return;
    setAgentMode(mode);
    setAgentModeState(mode);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke(mode === "embedded" ? "spawn_agent" : "stop_agent");
    } catch {
      // Not running under Tauri (browser dev) -- nothing to spawn/stop.
    }
    await reconnectAgent();
  };

  const saveExternalConfig = async () => {
    if (!externalUrl.trim() || !externalToken.trim()) return;
    setAgentExternalConfig(externalUrl, externalToken);
    toast.success(t("save"));
    await reconnectAgent();
  };

  const fetchEquipmentData = useCallback(async () => {
    const [printersText, scannersText, portsText, defaultText] = await Promise.all([
      agentGet("/printers"),
      agentGet("/scanners"),
      agentGet("/scanners/ports").catch(() => "[]"),
      agentGet("/printers/default").catch(() => "{}"),
    ]);
    let parsedDefault: string | null = null;
    try {
      const def = JSON.parse(defaultText) as { default?: string | null };
      parsedDefault = def.default ?? null;
    } catch {
      /* ignore */
    }
    let parsedPorts: { port_name: string }[] = [];
    try {
      const ports = JSON.parse(portsText) as { port_name: string }[];
      parsedPorts = Array.isArray(ports) ? ports : [];
    } catch {
      /* ignore */
    }
    return {
      printers: parsePrinters(printersText),
      scanners: parseScanners(scannersText),
      availablePorts: parsedPorts,
      defaultPrinter: parsedDefault,
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!agentConnected) return;
    try {
      const data = await fetchEquipmentData();
      setPrinters(data.printers);
      setScanners(data.scanners);
      setAvailablePorts(data.availablePorts);
      setDefaultPrinter(data.defaultPrinter);
    } catch {
      setPrinters([]);
      setScanners([]);
      setAvailablePorts([]);
      setDefaultPrinter(null);
    }
  }, [agentConnected, fetchEquipmentData]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ok = await checkAgentHealth();
      if (cancelled) return;
      setAgentConnected(ok);
      if (!ok) {
        setLoading(false);
        return;
      }
      try {
        const data = await fetchEquipmentData();
        if (!cancelled) {
          setPrinters(data.printers);
          setScanners(data.scanners);
          setAvailablePorts(data.availablePorts);
          setDefaultPrinter(data.defaultPrinter);
        }
      } catch (e) {
        if (!cancelled) {
          if (e instanceof Error && e.message.includes("401")) {
            setAgentUnauthorized(true);
          }
          setPrinters([]);
          setScanners([]);
          setAvailablePorts([]);
          setDefaultPrinter(null);
        }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchEquipmentData]);

  const addNetworkPrinter = async () => {
    if (!networkName.trim() || !networkIP.trim()) {
      toast.error(t("nameAndIpRequired"));
      return;
    }
    try {
      const port = parseInt(networkPort, 10) || 9100;
      await agentPost(
        "/printers/add",
        JSON.stringify({ name: networkName.trim(), ip: networkIP.trim(), port })
      );
      toast.success(t("printerAdded"));
      setNetworkName("");
      setNetworkIP("");
      setNetworkPort("9100");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("failedToAddPrinter"));
    }
  };

  const removeNetworkPrinter = async (name: string) => {
    try {
      await agentPost("/printers/remove", JSON.stringify({ name }));
      toast.success(t("printerRemoved"));
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("failedToRemovePrinter"));
    }
  };

  const setDefaultPrinterAction = async (name: string) => {
    try {
      await agentPost("/printers/default", JSON.stringify({ default: name }));
      setDefaultPrinter(name);
      toast.success(t("defaultPrinterSet"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("failedToSetDefaultPrinter"));
    }
  };

  const addScanner = async () => {
    if (!scannerPort.trim()) {
      toast.error(t("portNameRequired"));
      return;
    }
    try {
      await agentPost("/scanners/add", JSON.stringify({ port_name: scannerPort.trim() }));
      toast.success(t("scannerAdded"));
      setScannerPort("");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("failedToAddScanner"));
    }
  };

  const startScannerTest = useCallback(async () => {
    if (scannerTestTimeoutRef.current) {
      clearTimeout(scannerTestTimeoutRef.current);
      scannerTestTimeoutRef.current = null;
    }
    const code = `TEST-${Date.now()}`;
    setTestCode(code);
    setTestResult("waiting");
    setTestPolling(true);
    scannerTestTimeoutRef.current = setTimeout(() => {
      scannerTestTimeoutRef.current = null;
      setTestPolling(false);
      setTestResult("timeout");
    }, 60_000);
    try {
      const dataUrl = await QRCode.toDataURL(code, { width: 200 });
      setTestQRImage(dataUrl);
    } catch {
      setTestQRImage("");
    }
    try {
      await agentPost("/scan/clear");
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!testPolling || testResult !== "waiting" || !testCode) return;
    const id = setInterval(async () => {
      try {
        const text = await agentGet("/scan/last");
        const data = JSON.parse(text) as { code?: string };
        if (data.code && data.code.trim() === testCode.trim()) {
          if (scannerTestTimeoutRef.current) {
            clearTimeout(scannerTestTimeoutRef.current);
            scannerTestTimeoutRef.current = null;
          }
          setTestResult("success");
          setTestPolling(false);
        }
      } catch {
        /* ignore */
      }
    }, 500);
    return () => clearInterval(id);
  }, [testPolling, testResult, testCode]);

  const endScannerTest = () => {
    if (scannerTestTimeoutRef.current) {
      clearTimeout(scannerTestTimeoutRef.current);
      scannerTestTimeoutRef.current = null;
    }
    setTestPolling(false);
    setTestResult("idle");
    setTestCode("");
    setTestQRImage("");
  };

  useEffect(() => {
    return () => {
      if (scannerTestTimeoutRef.current) {
        clearTimeout(scannerTestTimeoutRef.current);
        scannerTestTimeoutRef.current = null;
      }
    };
  }, []);

  return (
    <PreflightShell
      steps={steps}
      activeIndex={3}
      banner={<UpdateChip />}
      footer={
        <div className="flex items-center gap-3">
          {t("language")}: <LanguageSwitcher />
        </div>
      }
    >
      <div className="flex flex-col gap-6">
        {/* NEW: agent connection mode (embedded/external) */}
        <section className="rounded-2xl border border-kiosk-border-2 bg-kiosk-surface-2 p-6">
          <div className="font-bold text-kiosk-text">{t("agentConnectionTitle")}</div>
          <div className="mt-3 flex gap-3">
            {(["embedded", "external"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={agentMode === value}
                className={`flex-1 rounded-xl border-2 p-4 text-left ${
                  agentMode === value
                    ? "border-kiosk-brand bg-kiosk-brand/10 text-kiosk-text"
                    : "border-kiosk-border-2 text-kiosk-text-3"
                }`}
                onClick={() => switchAgentMode(value)}
              >
                {value === "embedded" ? t("agentModeEmbedded") : t("agentModeExternal")}
              </button>
            ))}
          </div>
          {agentMode === "external" && (
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <KioskInput
                placeholder={t("agentExternalUrlPlaceholder")}
                value={externalUrl}
                onChange={(e) => setExternalUrl(e.target.value)}
              />
              <KioskInput
                type="password"
                placeholder={t("agentExternalTokenPlaceholder")}
                value={externalToken}
                onChange={(e) => setExternalToken(e.target.value)}
              />
              <KioskButton
                size="md"
                onClick={saveExternalConfig}
                disabled={!externalUrl.trim() || !externalToken.trim()}
              >
                {t("save")}
              </KioskButton>
            </div>
          )}
          {agentUnauthorized && <p className="mt-3 text-kiosk-danger-soft">{t("agentUnauthorized")}</p>}
        </section>

        {loading ? (
          <p className="text-kiosk-text-3">{t("loading")}</p>
        ) : !agentConnected ? (
          <div className="rounded-2xl border border-kiosk-border-2 bg-kiosk-surface-2 p-8">
            <div className="kiosk-type-verdict-title" style={{ fontSize: "calc(var(--kiosk-fs-verdict-title) * 0.7)" }}>
              {t("agentNotConnected")}
            </div>
            <p className="mt-2 text-kiosk-text-3">{t("agentNotConnectedDesc")}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
          {/* Printers card -- unchanged content, restyled container */}
          <section className="rounded-2xl border border-kiosk-border-2 bg-kiosk-surface-2 p-6">
            <div className="flex items-center gap-2 font-bold text-kiosk-text">
              <Printer className="size-5" />
              {t("printers")}
            </div>
            <p className="mt-1 text-kiosk-text-3" style={{ fontSize: "var(--kiosk-fs-chrome)" }}>
              {t("printersCount", { count: printers.length })}
            </p>
            <ul className="mt-4 space-y-1" style={{ fontSize: "var(--kiosk-fs-chrome)" }}>
              {printers.length === 0 ? (
                <li className="text-kiosk-text-3">{t("noPrintersFound")}</li>
              ) : (
                printers.map((p) => (
                  <li key={p.name} className="flex items-center justify-between gap-2 rounded px-2 py-1 text-kiosk-text-2">
                    <span className="flex items-center gap-2">
                      {p.name}
                      {p.type === "network" ? ` (${t("network")})` : ""}
                      {defaultPrinter === p.name && (
                        <span title={t("defaultPrinter")}>
                          <Star className="size-4 fill-kiosk-warn text-kiosk-warn" />
                        </span>
                      )}
                    </span>
                    <div className="flex items-center gap-1">
                      {defaultPrinter !== p.name && (
                        <button
                          type="button"
                          className="rounded px-2 py-1 text-kiosk-text-3 hover:text-kiosk-text"
                          onClick={() => setDefaultPrinterAction(p.name)}
                        >
                          {t("setAsDefault")}
                        </button>
                      )}
                      {p.type === "network" && (
                        <button
                          type="button"
                          className="rounded p-1 text-kiosk-danger-soft hover:opacity-80"
                          onClick={() => removeNetworkPrinter(p.name)}
                          title={t("removePrinter")}
                        >
                          <Trash2 className="size-4" />
                        </button>
                      )}
                    </div>
                  </li>
                ))
              )}
            </ul>
            <div className="mt-4 grid gap-2 rounded-xl border border-kiosk-border-2 p-3 sm:grid-cols-4">
              <KioskInput placeholder={t("printerNamePlaceholder")} value={networkName} onChange={(e) => setNetworkName(e.target.value)} />
              <KioskInput placeholder={t("printerIpPlaceholder")} value={networkIP} onChange={(e) => setNetworkIP(e.target.value)} />
              <KioskInput placeholder={t("printerPortPlaceholder")} value={networkPort} onChange={(e) => setNetworkPort(e.target.value)} />
              <KioskButton size="md" onClick={addNetworkPrinter}>
                <PlusCircle className="mr-1 size-4" />
                {t("addNetworkPrinter")}
              </KioskButton>
            </div>
          </section>

          {/* Scanners card -- unchanged content, restyled container */}
          <section className="rounded-2xl border border-kiosk-border-2 bg-kiosk-surface-2 p-6">
            <div className="flex items-center gap-2 font-bold text-kiosk-text">
              <ScanLine className="size-5" />
              {t("scanners")}
            </div>
            <p className="mt-1 text-kiosk-text-3" style={{ fontSize: "var(--kiosk-fs-chrome)" }}>
              {t("scannersCount", { count: scanners.length })}
            </p>
            <ul className="mt-4 list-inside list-disc space-y-1 text-kiosk-text-2" style={{ fontSize: "var(--kiosk-fs-chrome)" }}>
              {scanners.length === 0 ? <li className="text-kiosk-text-3">{t("noScannersConfigured")}</li> : scanners.map((s) => <li key={s}>{s}</li>)}
            </ul>
            <div className="mt-4 flex flex-wrap items-end gap-2">
              <KioskInput
                placeholder="COM3"
                value={scannerPort}
                onChange={(e) => setScannerPort(e.target.value)}
                list="scanner-ports"
              />
              {availablePorts.length > 0 && (
                <datalist id="scanner-ports">
                  {availablePorts.map((p) => (
                    <option key={p.port_name} value={p.port_name} />
                  ))}
                </datalist>
              )}
              <KioskButton size="md" onClick={addScanner}>
                <PlusCircle className="mr-1 size-4" />
                {t("addScanner")}
              </KioskButton>
            </div>
          </section>

          {/* NEW: station registration */}
          <section className="rounded-2xl border border-kiosk-border-2 bg-kiosk-surface-2 p-6">
            <div className="font-bold text-kiosk-text">{t("stationName")}</div>
            {stationId ? (
              <p className="mt-3 flex items-center gap-2 text-kiosk-ok">
                <span aria-hidden className="size-3 rounded-full bg-kiosk-ok" />
                {t("stationRegistered")}
              </p>
            ) : (
              <div className="mt-3 flex gap-3">
                <KioskInput
                  placeholder={t("stationNamePlaceholder")}
                  value={stationName}
                  onChange={(e) => setStationName(e.target.value)}
                />
                <KioskButton size="md" onClick={registerStationAction} disabled={!stationName.trim()}>
                  {t("stationRegister")}
                </KioskButton>
              </div>
            )}
          </section>

          {/* Scanner test card -- unchanged content, restyled container */}
          <section className="rounded-2xl border border-kiosk-border-2 bg-kiosk-surface-2 p-6">
            <div className="font-bold text-kiosk-text">{t("testScanner")}</div>
            <p className="mt-1 text-kiosk-text-3" style={{ fontSize: "var(--kiosk-fs-chrome)" }}>
              {t("testScannerDesc")}
            </p>
            <div className="mt-4">
              {testResult === "idle" && <KioskButton size="md" onClick={startScannerTest}>{t("startScannerTest")}</KioskButton>}
              {testResult === "waiting" && (
                <div className="flex flex-wrap items-start gap-4">
                  {testQRImage && (
                    <div>
                      <img src={testQRImage} alt="Test QR" className="rounded-xl border border-kiosk-border-2" width={200} height={200} />
                      <p className="mt-2 text-kiosk-text-3" style={{ fontSize: "var(--kiosk-fs-chrome)" }}>{t("scanThisCode")}</p>
                    </div>
                  )}
                  <KioskButton size="md" variant="outline" onClick={endScannerTest}>{t("cancel")}</KioskButton>
                </div>
              )}
              {testResult === "success" && (
                <div className="flex items-center gap-2 text-kiosk-ok">
                  <CheckCircle className="size-5" />
                  <span>{t("scannerTestPassed")}</span>
                  <KioskButton size="md" variant="outline" onClick={endScannerTest}>{t("done")}</KioskButton>
                </div>
              )}
              {testResult === "timeout" && (
                <div className="flex items-center gap-2 text-kiosk-warn">
                  <span>{t("scannerTestTimedOut")}</span>
                  <KioskButton size="md" variant="outline" onClick={endScannerTest}>{t("done")}</KioskButton>
                </div>
              )}
            </div>
          </section>

          <KioskButton
            disabled={!stationId}
            onClick={() => navigate(`/checkin/${eventId}/mode`)}
          >
            {t("continueButton")}
          </KioskButton>
        </div>
      )}
      </div>
    </PreflightShell>
  );
}
