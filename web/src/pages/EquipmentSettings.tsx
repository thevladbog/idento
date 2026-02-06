import { useEffect, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import QRCode from "qrcode";
import { Layout } from "@/components/Layout";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Printer,
  Camera,
  Wifi,
  Bluetooth,
  Usb,
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertTriangle,
  ScanLine,
} from "lucide-react";
import { agentApi } from "@/lib/agent";
import { toast } from "sonner";

interface PrinterDevice {
  name: string;
  type: "usb" | "bluetooth" | "network";
  status: "connected" | "disconnected";
  model?: string;
}

export default function EquipmentSettingsPage() {
  const { t } = useTranslation();
  const [printers, setPrinters] = useState<PrinterDevice[]>([]);
  const [selectedPrinter, setSelectedPrinter] = useState<string>("");
  const [agentStatus, setAgentStatus] = useState<"connected" | "disconnected">(
    "disconnected"
  );
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Scanner settings
  const [scanners, setScanners] = useState<string[]>([]);
  const [scannerType, setScannerType] = useState<
    "camera" | "usb" | "bluetooth"
  >("camera");
  const [cameraPermission, setCameraPermission] = useState<
    "granted" | "denied" | "prompt"
  >("prompt");

  // Network printer settings
  const [networkPrinterIP, setNetworkPrinterIP] = useState("");
  const [networkPrinterPort, setNetworkPrinterPort] = useState("9100");

  // COM Scanner settings
  const [comScannerPort, setComScannerPort] = useState("");
  const [selectedScanner, setSelectedScanner] = useState<string>("");
  const [availablePorts, setAvailablePorts] = useState<string[]>([]);
  const [isLoadingPorts, setIsLoadingPorts] = useState(false);

  // Scanner test
  const [isTestingScanner, setIsTestingScanner] = useState(false);
  const [testQRCode, setTestQRCode] = useState<string>("");
  const [testQRImage, setTestQRImage] = useState<string>("");
  const [testResult, setTestResult] = useState<
    "waiting" | "success" | "fail" | null
  >(null);
  const testIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    checkAgentStatus();
    checkCameraPermission();
    loadSavedNetworkPrinters();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once on mount
  }, []);

  const loadSavedNetworkPrinters = async () => {
    try {
      const savedPrinters = JSON.parse(
        localStorage.getItem("network_printers") || "[]"
      );
      if (savedPrinters.length > 0 && agentStatus === "connected") {
        for (const printer of savedPrinters) {
          try {
            await agentApi.addNetworkPrinter(
              printer.name,
              printer.ip,
              printer.port
            );
          } catch (error) {
            console.error(`Failed to restore printer ${printer.name}`, error);
          }
        }
      }
    } catch (error) {
      console.error("Failed to load saved printers", error);
    }
  };

  const checkAgentStatus = async () => {
    try {
      await agentApi.checkHealth();
      setAgentStatus("connected");
      fetchPrinters();
      fetchScanners();
      fetchAvailablePorts();
    } catch {
      setAgentStatus("disconnected");
    }
  };

  const fetchPrinters = async () => {
    try {
      const printerList = await agentApi.getPrinters();
      setPrinters(
        printerList.map((name: string) => ({
          name,
          type: name.includes("Serial")
            ? ("usb" as const)
            : ("network" as const),
          status: "connected" as const,
        }))
      );
      if (printerList.length > 0) {
        setSelectedPrinter(printerList[0]);
      }
    } catch (error) {
      console.error("Failed to fetch printers", error);
    }
  };

  const fetchScanners = async () => {
    try {
      const scannerList = await agentApi.getScanners();
      setScanners(scannerList);
    } catch (error) {
      console.error("Failed to fetch scanners", error);
    }
  };

  const checkCameraPermission = async () => {
    if (navigator.permissions) {
      try {
        const result = await navigator.permissions.query({
          name: "camera" as PermissionName,
        });
        setCameraPermission(result.state as "granted" | "denied" | "prompt");
      } catch (error) {
        console.error("Failed to check camera permission", error);
      }
    }
  };

  const requestCameraPermission = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach((track) => track.stop());
      setCameraPermission("granted");
    } catch {
      setCameraPermission("denied");
    }
  };

  const handleRefreshPrinters = async () => {
    setIsRefreshing(true);
    await checkAgentStatus();
    setTimeout(() => setIsRefreshing(false), 1000);
  };

  const handleTestPrint = async () => {
    if (!selectedPrinter) {
      toast.error(t("selectPrinterFirst"));
      return;
    }

    try {
      // Simple test ZPL for testing printer
      const testZPL = `^XA
^FO50,50^ADN,36,20^FDTest Print^FS
^FO50,100^ADN,18,10^FDIdento Agent^FS
^FO50,150^BQN,2,5^FDQA,TEST123^FS
^XZ`;

      await agentApi.print({
        printer_name: selectedPrinter,
        zpl: testZPL,
      });
      toast.success(t("testPrintSent"));
    } catch {
      toast.error(t("testPrintFailed"));
    }
  };

  const saveNetworkPrinter = async () => {
    if (!networkPrinterIP) {
      toast.error(t("ipAddressRequired"));
      return;
    }

    const printerName = `Network_${networkPrinterIP.replace(/\./g, "_")}`;
    const port = parseInt(networkPrinterPort) || 9100;

    try {
      // Add printer to agent
      await agentApi.addNetworkPrinter(printerName, networkPrinterIP, port);

      // Save to localStorage for persistence
      const savedPrinters = JSON.parse(
        localStorage.getItem("network_printers") || "[]"
      );
      savedPrinters.push({ name: printerName, ip: networkPrinterIP, port });
      localStorage.setItem("network_printers", JSON.stringify(savedPrinters));

      // Update local state
      const newPrinter: PrinterDevice = {
        name: printerName,
        type: "network",
        status: "connected",
      };
      setPrinters([...printers, newPrinter]);
      setSelectedPrinter(printerName);

      // Clear form
      setNetworkPrinterIP("");
      setNetworkPrinterPort("9100");

      toast.success(t("printerAdded"));
    } catch (error) {
      console.error("Failed to add network printer", error);
      toast.error(t("failedToAddPrinter"));
    }
  };

  const fetchAvailablePorts = async () => {
    setIsLoadingPorts(true);
    try {
      const ports = await agentApi.getAvailablePorts();
      const validPorts = Array.isArray(ports) ? ports : [];
      setAvailablePorts(validPorts);
      if (validPorts.length > 0 && !comScannerPort) {
        setComScannerPort(validPorts[0]);
      }
    } catch (error) {
      console.error("Failed to fetch available ports", error);
      setAvailablePorts([]);
    } finally {
      setIsLoadingPorts(false);
    }
  };

  const addComScanner = async () => {
    if (!comScannerPort) {
      toast.error(t("portNameRequired"));
      return;
    }

    try {
      await agentApi.addComScanner(comScannerPort);
      toast.success(t("scannerAdded"));
      setComScannerPort("");
      await fetchScanners();
      await fetchAvailablePorts(); // Refresh available ports
    } catch (error) {
      console.error("Failed to add COM scanner", error);
      toast.error(t("failedToAddScanner"));
    }
  };

  const generateTestCode = () => {
    return `TEST-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
  };

  const startScannerTest = async () => {
    if (!selectedScanner) {
      toast.error(t("selectScannerFirst"));
      return;
    }

    const code = generateTestCode();
    setTestQRCode(code);
    setTestResult("waiting");
    setIsTestingScanner(true);

    // Generate QR code image
    try {
      const qrImage = await QRCode.toDataURL(code, {
        width: 300,
        margin: 2,
        color: {
          dark: "#000000",
          light: "#ffffff",
        },
      });
      setTestQRImage(qrImage);
    } catch (error) {
      console.error("Failed to generate QR code", error);
    }

    // Poll for scan result
    let attempts = 0;
    const maxAttempts = 60; // 30 seconds (500ms intervals)

    testIntervalRef.current = setInterval(async () => {
      attempts++;

      try {
        const lastScan = await agentApi.getLastScan();
        if (lastScan && lastScan.code === code) {
          setTestResult("success");
          toast.success(t("scannerTestSuccess"));
          if (testIntervalRef.current) {
            clearInterval(testIntervalRef.current);
          }
          await agentApi.clearLastScan();
        } else if (attempts >= maxAttempts) {
          setTestResult("fail");
          toast.error(t("scannerTestTimeout"));
          if (testIntervalRef.current) {
            clearInterval(testIntervalRef.current);
          }
        }
      } catch (error) {
        console.error("Error checking scan", error);
      }
    }, 500);
  };

  const closeScannerTest = () => {
    if (testIntervalRef.current) {
      clearInterval(testIntervalRef.current);
    }
    setIsTestingScanner(false);
    setTestQRCode("");
    setTestQRImage("");
    setTestResult(null);
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">{t("equipmentSettings")}</h1>
          <p className="text-muted-foreground">{t("equipmentSettingsDesc")}</p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Printers Section */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Printer className="w-5 h-5" />
                {t("printers")}
              </CardTitle>
              <CardDescription>{t("printersDesc")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Agent Status */}
              <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                <span className="text-sm font-medium">{t("agentStatus")}</span>
                <div className="flex items-center gap-2">
                  {agentStatus === "connected" ? (
                    <>
                      <CheckCircle className="w-4 h-4 text-green-600" />
                      <span className="text-sm text-green-600">
                        {t("connected")}
                      </span>
                    </>
                  ) : (
                    <>
                      <XCircle className="w-4 h-4 text-red-600" />
                      <span className="text-sm text-red-600">
                        {t("disconnected")}
                      </span>
                    </>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleRefreshPrinters}
                    disabled={isRefreshing}
                  >
                    <RefreshCw
                      className={`w-4 h-4 ${
                        isRefreshing ? "animate-spin" : ""
                      }`}
                    />
                  </Button>
                </div>
              </div>

              {/* Printer Selection */}
              <div className="space-y-2">
                <Label>{t("selectPrinter")}</Label>
                <Select
                  value={selectedPrinter}
                  onValueChange={setSelectedPrinter}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("noPrintersFound")} />
                  </SelectTrigger>
                  <SelectContent>
                    {printers.map((printer) => (
                      <SelectItem key={printer.name} value={printer.name}>
                        <div className="flex items-center gap-2">
                          {printer.type === "usb" && (
                            <Usb className="w-4 h-4" />
                          )}
                          {printer.type === "bluetooth" && (
                            <Bluetooth className="w-4 h-4" />
                          )}
                          {printer.type === "network" && (
                            <Wifi className="w-4 h-4" />
                          )}
                          {printer.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Printer List */}
              {printers.length > 0 && (
                <div className="space-y-2">
                  <Label>{t("availablePrinters")}</Label>
                  <div className="space-y-2">
                    {printers.map((printer) => (
                      <div
                        key={printer.name}
                        className="flex items-center justify-between p-3 border rounded-lg"
                      >
                        <div className="flex items-center gap-3">
                          {printer.type === "usb" && (
                            <Usb className="w-5 h-5 text-muted-foreground" />
                          )}
                          {printer.type === "bluetooth" && (
                            <Bluetooth className="w-5 h-5 text-muted-foreground" />
                          )}
                          {printer.type === "network" && (
                            <Wifi className="w-5 h-5 text-muted-foreground" />
                          )}
                          <div>
                            <div className="font-medium">{printer.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {printer.type.toUpperCase()}
                            </div>
                          </div>
                        </div>
                        <div
                          className={`w-2 h-2 rounded-full ${
                            printer.status === "connected"
                              ? "bg-green-500"
                              : "bg-red-500"
                          }`}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Test Print */}
              <Button
                onClick={handleTestPrint}
                variant="outline"
                className="w-full"
                disabled={!selectedPrinter}
              >
                <Printer className="mr-2 w-4 h-4" />
                {t("testPrint")}
              </Button>

              {/* Add Network Printer */}
              <div className="pt-4 border-t space-y-3">
                <Label>{t("addNetworkPrinter")}</Label>
                <div className="space-y-2">
                  <Input
                    placeholder={t("ipAddress")}
                    value={networkPrinterIP}
                    onChange={(e) => setNetworkPrinterIP(e.target.value)}
                  />
                  <Input
                    placeholder={t("port")}
                    value={networkPrinterPort}
                    onChange={(e) => setNetworkPrinterPort(e.target.value)}
                  />
                  <Button
                    onClick={saveNetworkPrinter}
                    variant="outline"
                    className="w-full"
                  >
                    {t("add")}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Scanners Section */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Camera className="w-5 h-5" />
                {t("scanners")}
              </CardTitle>
              <CardDescription>{t("scannersDesc")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Scanner Type */}
              <div className="space-y-2">
                <Label>{t("scannerType")}</Label>
                <Select
                  value={scannerType}
                  onValueChange={(v: string) =>
                    setScannerType(v as "camera" | "usb" | "bluetooth")
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="camera">
                      <div className="flex items-center gap-2">
                        <Camera className="w-4 h-4" />
                        {t("deviceCamera")}
                      </div>
                    </SelectItem>
                    <SelectItem value="usb">
                      <div className="flex items-center gap-2">
                        <Usb className="w-4 h-4" />
                        {t("usbScanner")}
                      </div>
                    </SelectItem>
                    <SelectItem value="bluetooth">
                      <div className="flex items-center gap-2">
                        <Bluetooth className="w-4 h-4" />
                        {t("bluetoothScanner")}
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Camera Permission */}
              {scannerType === "camera" && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                    <span className="text-sm font-medium">
                      {t("cameraPermission")}
                    </span>
                    <div className="flex items-center gap-2">
                      {cameraPermission === "granted" ? (
                        <>
                          <CheckCircle className="w-4 h-4 text-green-600" />
                          <span className="text-sm text-green-600">
                            {t("granted")}
                          </span>
                        </>
                      ) : cameraPermission === "denied" ? (
                        <>
                          <XCircle className="w-4 h-4 text-red-600" />
                          <span className="text-sm text-red-600">
                            {t("denied")}
                          </span>
                        </>
                      ) : (
                        <>
                          <AlertTriangle className="w-4 h-4 text-yellow-600" />
                          <span className="text-sm text-yellow-600">
                            {t("notRequested")}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {cameraPermission !== "granted" && (
                    <Button
                      onClick={requestCameraPermission}
                      variant="outline"
                      className="w-full"
                    >
                      {t("requestCameraAccess")}
                    </Button>
                  )}
                </div>
              )}

              {/* Add COM Scanner */}
              {scannerType === "usb" && agentStatus === "connected" && (
                <div className="pt-4 border-t space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>{t("addComScanner")}</Label>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={fetchAvailablePorts}
                      disabled={isLoadingPorts}
                    >
                      <RefreshCw
                        className={`w-4 h-4 ${
                          isLoadingPorts ? "animate-spin" : ""
                        }`}
                      />
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {availablePorts.length > 0 ? (
                      <Select
                        value={comScannerPort}
                        onValueChange={setComScannerPort}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={t("selectPort")} />
                        </SelectTrigger>
                        <SelectContent>
                          {availablePorts.map((port) => (
                            <SelectItem key={port} value={port}>
                              <div className="flex items-center gap-2">
                                <Usb className="w-4 h-4" />
                                {port}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <div className="p-3 bg-muted rounded-lg text-sm text-muted-foreground text-center">
                        {isLoadingPorts
                          ? t("loadingPorts")
                          : t("noPortsDetected")}
                      </div>
                    )}
                    <Button
                      onClick={addComScanner}
                      variant="outline"
                      className="w-full"
                      disabled={!comScannerPort || isLoadingPorts}
                    >
                      {t("add")}
                    </Button>
                  </div>
                </div>
              )}

              {/* COM Scanners List */}
              {scanners.length > 0 && (
                <div className="space-y-3 pt-4 border-t">
                  <Label>{t("detectedScanners")}</Label>
                  <div className="space-y-2">
                    {scanners.map((scannerName) => (
                      <div
                        key={scannerName}
                        className="flex items-center justify-between p-3 border rounded-lg"
                      >
                        <div className="flex items-center gap-3">
                          <Usb className="w-5 h-5 text-muted-foreground" />
                          <div>
                            <div className="font-medium">{scannerName}</div>
                            <div className="text-xs text-muted-foreground">
                              COM/Serial
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-green-500" />
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setSelectedScanner(scannerName);
                              startScannerTest();
                            }}
                          >
                            <ScanLine className="w-4 h-4 mr-1" />
                            {t("test")}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Instructions */}
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>{t("instructions")}</CardTitle>
          </CardHeader>
          <CardContent className="prose prose-sm max-w-none">
            <h4>{t("printerSetup")}</h4>
            <ul>
              <li>{t("printerSetupStep1")}</li>
              <li>{t("printerSetupStep2")}</li>
              <li>{t("printerSetupStep3")}</li>
            </ul>
            <h4 className="mt-4">{t("scannerSetup")}</h4>
            <ul>
              <li>{t("scannerSetupStep1")}</li>
              <li>{t("scannerSetupStep2")}</li>
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* Scanner Test Dialog */}
      <Dialog open={isTestingScanner} onOpenChange={closeScannerTest}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("testScanner")}</DialogTitle>
            <DialogDescription>{t("testScannerDesc")}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col items-center space-y-4 py-4">
            {testQRImage && (
              <div className="border-4 border-primary rounded-lg p-4 bg-white">
                <img
                  src={testQRImage}
                  alt="Test QR Code"
                  className="w-64 h-64"
                />
              </div>
            )}

            <div className="text-center space-y-2">
              <div className="text-sm text-muted-foreground">
                {t("testCode")}:{" "}
                <code className="bg-muted px-2 py-1 rounded font-mono">
                  {testQRCode}
                </code>
              </div>

              {testResult === "waiting" && (
                <div className="flex items-center justify-center gap-2 text-primary">
                  <RefreshCw className="w-5 h-5 animate-spin" />
                  <span>{t("waitingForScan")}</span>
                </div>
              )}

              {testResult === "success" && (
                <div className="flex items-center justify-center gap-2 text-green-600">
                  <CheckCircle className="w-6 h-6" />
                  <span className="font-semibold">{t("scanSuccess")}</span>
                </div>
              )}

              {testResult === "fail" && (
                <div className="flex items-center justify-center gap-2 text-red-600">
                  <XCircle className="w-6 h-6" />
                  <span className="font-semibold">{t("scanFailed")}</span>
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={closeScannerTest}>
              {t("close")}
            </Button>
            {testResult && (
              <Button
                onClick={() => {
                  closeScannerTest();
                  setTimeout(() => startScannerTest(), 100);
                }}
              >
                {t("tryAgain")}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
