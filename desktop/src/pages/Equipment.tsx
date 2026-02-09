import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import QRCode from "qrcode";
import { Printer, ScanLine, PlusCircle, CheckCircle, Trash2, Star, Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { checkAgentHealth, agentGet, agentPost } from "@/lib/agent";
import { clearSession } from "@/lib/api";
import {
  loadCheckinSettings,
  saveCheckinSettings,
  type KioskCheckinSettings,
} from "@/lib/checkinSettings";
import { toast } from "sonner";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

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
  const [agentConnected, setAgentConnected] = useState(false);
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

  const [checkinSettings, setCheckinSettings] = useState<KioskCheckinSettings>(() => loadCheckinSettings());
  const persistCheckinSettings = (next: KioskCheckinSettings) => {
    setCheckinSettings(next);
    saveCheckinSettings(next);
  };

  const fetchEquipmentData = useCallback(async () => {
    const [printersText, scannersText, portsText, defaultText] = await Promise.all([
      agentGet("/printers"),
      agentGet("/scanners"),
      agentGet("/scanners/ports").catch(() => "[]"),
      agentGet("/printers/default").catch(() => "{}"),
    ]);
    let defaultPrinter: string | null = null;
    try {
      const def = JSON.parse(defaultText) as { default?: string | null };
      defaultPrinter = def.default ?? null;
    } catch {
      /* ignore */
    }
    let availablePorts: { port_name: string }[] = [];
    try {
      const ports = JSON.parse(portsText) as { port_name: string }[];
      availablePorts = Array.isArray(ports) ? ports : [];
    } catch {
      /* ignore */
    }
    return {
      printers: parsePrinters(printersText),
      scanners: parseScanners(scannersText),
      availablePorts,
      defaultPrinter,
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
      } catch {
        if (!cancelled) {
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
    <div className="min-h-screen bg-background p-4">
      <header className="mb-6 flex items-center justify-between border-b pb-4">
        <h1 className="text-2xl font-semibold">{t("equipmentSettings")}</h1>
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <Button variant="outline" size="sm" onClick={() => navigate("/connection")}>
            {t("serverUrl")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate("/checkin")}>
            {t("checkin")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              clearSession();
              navigate("/login");
            }}
          >
            {t("logout")}
          </Button>
        </div>
      </header>

      {loading ? (
        <p className="text-muted-foreground">{t("loading")}</p>
      ) : !agentConnected ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("agentNotConnected")}</CardTitle>
            <CardDescription>{t("agentNotConnectedDesc")}</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Printer className="h-5 w-5" />
                {t("printers")}
              </CardTitle>
              <CardDescription>{t("printersCount", { count: printers.length })}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ul className="space-y-1 text-sm">
                {printers.length === 0 ? (
                  <li className="text-muted-foreground">{t("noPrintersFound")}</li>
                ) : (
                  printers.map((p) => (
                    <li key={p.name} className="flex items-center justify-between gap-2 rounded px-2 py-1">
                      <span className="flex items-center gap-2">
                        {p.name}{p.type === "network" ? ` (${t("network")})` : ""}
                        {defaultPrinter === p.name && (
                          <span title={t("defaultPrinter")}>
                          <Star className="h-4 w-4 fill-amber-500 text-amber-500" />
                        </span>
                        )}
                      </span>
                      <div className="flex items-center gap-1">
                        {defaultPrinter !== p.name && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 shrink-0 px-2 text-muted-foreground hover:text-foreground"
                            onClick={() => setDefaultPrinterAction(p.name)}
                            title={t("setAsDefault")}
                          >
                            {t("setAsDefault")}
                          </Button>
                        )}
                        {p.type === "network" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 shrink-0 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => removeNetworkPrinter(p.name)}
                            title={t("removePrinter")}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </li>
                  ))
                )}
              </ul>
              <div className="grid gap-2 rounded border p-3 sm:grid-cols-4">
                <div className="space-y-1">
                  <Label>{t("name")}</Label>
                  <Input
                    placeholder={t("printerNamePlaceholder")}
                    value={networkName}
                    onChange={(e) => setNetworkName(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label>{t("ip")}</Label>
                  <Input
                    placeholder={t("printerIpPlaceholder")}
                    value={networkIP}
                    onChange={(e) => setNetworkIP(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label>{t("port")}</Label>
                  <Input
                    placeholder={t("printerPortPlaceholder")}
                    value={networkPort}
                    onChange={(e) => setNetworkPort(e.target.value)}
                  />
                </div>
                <div className="flex items-end">
                  <Button onClick={addNetworkPrinter} className="w-full">
                    <PlusCircle className="mr-1 h-4 w-4" />
                    {t("addNetworkPrinter")}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ScanLine className="h-5 w-5" />
                {t("scanners")}
              </CardTitle>
              <CardDescription>{t("scannersCount", { count: scanners.length })}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ul className="list-inside list-disc space-y-1 text-sm">
                {scanners.length === 0 ? (
                  <li className="text-muted-foreground">{t("noScannersConfigured")}</li>
                ) : (
                  scanners.map((s) => <li key={s}>{s}</li>)
                )}
              </ul>
              <div className="space-y-3">
                {availablePorts.length > 0 && (
                  <div className="space-y-1">
                    <Label>{t("availableComPorts")}</Label>
                    <select
                      className="flex h-9 w-full max-w-xs rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      value={scannerPort}
                      onChange={(e) => setScannerPort(e.target.value)}
                    >
                      <option value="">— {t("orEnterPort")} —</option>
                      {availablePorts.map((p) => (
                        <option key={p.port_name} value={p.port_name}>
                          {p.port_name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-[200px] space-y-1">
                    <Label>{availablePorts.length > 0 ? t("orEnterPort") : t("portPlaceholder")}</Label>
                    <Input
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
                  </div>
                  <Button onClick={addScanner}>
                    <PlusCircle className="mr-1 h-4 w-4" />
                    {t("addScanner")}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">{t("checkinSettings")}</CardTitle>
              <CardDescription>{t("checkinSettingsDesc")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>{t("checkinMode")}</Label>
                <div className="flex gap-2">
                  <Button
                    variant={checkinSettings.checkinMode === "camera" ? "default" : "outline"}
                    size="sm"
                    onClick={() => persistCheckinSettings({ ...checkinSettings, checkinMode: "camera" })}
                  >
                    <Camera className="mr-1 h-4 w-4" />
                    {t("checkinModeCamera")}
                  </Button>
                  <Button
                    variant={checkinSettings.checkinMode === "scanner" ? "default" : "outline"}
                    size="sm"
                    onClick={() => persistCheckinSettings({ ...checkinSettings, checkinMode: "scanner" })}
                  >
                    <ScanLine className="mr-1 h-4 w-4" />
                    {t("checkinModeScanner")}
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t("printLabels")}</Label>
                <div className="flex gap-2">
                  <Button
                    variant={!checkinSettings.printEnabled ? "default" : "outline"}
                    size="sm"
                    onClick={() => persistCheckinSettings({ ...checkinSettings, printEnabled: false })}
                  >
                    Off
                  </Button>
                  <Button
                    variant={checkinSettings.printEnabled ? "default" : "outline"}
                    size="sm"
                    onClick={() => persistCheckinSettings({ ...checkinSettings, printEnabled: true })}
                  >
                    On
                  </Button>
                </div>
                {checkinSettings.printEnabled && (
                  <div className="flex gap-2 pt-1">
                    <Button
                      variant={!checkinSettings.manualPrint ? "default" : "outline"}
                      size="sm"
                      onClick={() => persistCheckinSettings({ ...checkinSettings, manualPrint: false })}
                    >
                      {t("printLabelsAuto")}
                    </Button>
                    <Button
                      variant={checkinSettings.manualPrint ? "default" : "outline"}
                      size="sm"
                      onClick={() => persistCheckinSettings({ ...checkinSettings, manualPrint: true })}
                    >
                      {t("printLabelsManual")}
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("testScanner")}</CardTitle>
              <CardDescription>{t("testScannerDesc")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {testResult === "idle" && (
                <Button onClick={startScannerTest}>{t("startScannerTest")}</Button>
              )}
              {testResult === "waiting" && (
                <div className="flex flex-wrap items-start gap-4">
                  {testQRImage && (
                    <div>
                      <img src={testQRImage} alt="Test QR" className="rounded border" width={200} height={200} />
                      <p className="mt-2 text-sm text-muted-foreground">{t("scanThisCode")}</p>
                    </div>
                  )}
                  <div>
                    <Button variant="outline" onClick={endScannerTest}>
                      {t("cancel")}
                    </Button>
                  </div>
                </div>
              )}
              {testResult === "success" && (
                <div className="flex items-center gap-2 text-green-600">
                  <CheckCircle className="h-5 w-5" />
                  <span>{t("scannerTestPassed")}</span>
                  <Button variant="outline" size="sm" onClick={endScannerTest}>
                    {t("done")}
                  </Button>
                </div>
              )}
              {testResult === "timeout" && (
                <div className="flex items-center gap-2 text-amber-600">
                  <span>{t("scannerTestTimedOut")}</span>
                  <Button variant="outline" size="sm" onClick={endScannerTest}>
                    {t("done")}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
