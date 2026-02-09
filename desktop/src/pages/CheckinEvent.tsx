import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  CheckCircle,
  ScanLine,
  AlertTriangle,
  XCircle,
  Maximize,
  Minimize,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { agentGet, agentPost, checkAgentHealth } from "@/lib/agent";
import { toast } from "sonner";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { loadCheckinSettings, saveCheckinSettings } from "@/lib/checkinSettings";
import { renderMarkdownTemplate, getDefaultAttendeeTemplate } from "@/lib/markdownTemplate";
import jsQR from "jsqr";

type Attendee = {
  id: string;
  first_name: string;
  last_name: string;
  email?: string;
  company?: string;
  position?: string;
  checkin_status: boolean;
  checked_in_at?: string;
  code?: string;
  blocked?: boolean;
  block_reason?: string;
  custom_fields?: Record<string, unknown>;
};

type EventWithCustomFields = {
  id: string;
  name: string;
  custom_fields?: {
    attendeeTemplate?: string;
    badgeTypeField?: string;
  };
};

type ScanResultStatus = "success" | "warning" | "error";
type ScanResult = {
  status: ScanResultStatus;
  attendee?: Attendee;
  message: string;
};

const RESULT_AUTO_CLOSE_MS = 4000;

export default function CheckinEventPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { eventId } = useParams<{ eventId: string }>();
  const [event, setEvent] = useState<EventWithCustomFields | null>(null);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [agentConnected, setAgentConnected] = useState(false);
  const [polling, setPolling] = useState(false);
  const [scanCode, setScanCode] = useState("");
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [cameraDenied, setCameraDenied] = useState(false);
  const [forceScannerMode, setForceScannerMode] = useState(false);
  const resultTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationRef = useRef<number | null>(null);
  const handleScanCodeRef = useRef<(code: string) => void>(() => {});
  const printBadgeRef = useRef<(attendee: Attendee) => Promise<void>>(async () => {});
  const [titleTapCount, setTitleTapCount] = useState(0);
  const titleTapTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [checkinSettings, setCheckinSettings] = useState(loadCheckinSettings);
  const isScannerMode = checkinSettings.checkinMode === "scanner" || forceScannerMode;
  const isCameraMode = checkinSettings.checkinMode === "camera" && !forceScannerMode;

  useEffect(() => {
    if (!eventId) {
      setLoading(false);
      setLoadError(null);
      return;
    }
    let cancelled = false;
    setLoadError(null);
    api
      .get<EventWithCustomFields>(`/api/events/${eventId}`)
      .then((res) => {
        if (cancelled) return;
        setEvent(res.data);
        return api
          .get<Attendee[]>(`/api/events/${eventId}/attendees`)
          .then((attendeesRes) => {
            if (!cancelled) setAttendees(Array.isArray(attendeesRes.data) ? attendeesRes.data : []);
          })
          .catch((e) => {
            if (!cancelled) {
              const msg = e instanceof Error ? e.message : String(e);
              const context = `/api/events/${eventId}/attendees`;
              setLoadError(msg);
              toast.error(`Failed to load ${context}: ${msg}`);
              setAttendees([]);
            }
          });
      })
      .catch((e) => {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : String(e);
          const context = `/api/events/${eventId}`;
          setLoadError(msg);
          toast.error(`Failed to load ${context}: ${msg}`);
          setEvent(null);
          setAttendees([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  useEffect(() => {
    checkAgentHealth().then(setAgentConnected);
  }, []);

  useEffect(() => {
    if (!isScannerMode || !agentConnected || !eventId) return;
    setPolling(true);
    return () => setPolling(false);
  }, [isScannerMode, agentConnected, eventId]);

  // Media stream: request camera, attach to video, cleanup only when leaving camera or eventId changes.
  useEffect(() => {
    if (!isCameraMode || !eventId) return;
    setCameraDenied(false);
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        video.srcObject = stream;
        video.play().catch(() => {});
      })
      .catch(() => {
        if (!cancelled) setCameraDenied(true);
      });
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (video) video.srcObject = null;
    };
  }, [isCameraMode, eventId]);

  // Decode loop: run QR tick when no scan result; cancel only animation frame on result/unmount (stream stays).
  useEffect(() => {
    if (!isCameraMode || !eventId || scanResult) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      if (!streamRef.current) return;
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        const w = Math.min(video.videoWidth, 640);
        const h = Math.min(video.videoHeight, 640);
        canvas.width = w;
        canvas.height = h;
        ctx.drawImage(video, 0, 0, w, h);
        const imageData = ctx.getImageData(0, 0, w, h);
        const code = jsQR(imageData.data, w, h, { inversionAttempts: "attemptBoth" });
        if (code && code.data) {
          handleScanCodeRef.current(code.data.trim());
          return;
        }
      }
      animationRef.current = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelled = true;
      if (animationRef.current != null) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    };
  }, [isCameraMode, eventId, scanResult]);

  useEffect(() => {
    if (!polling || !agentConnected) return;
    const id = setInterval(async () => {
      try {
        const text = await agentGet("/scan/last");
        const data = JSON.parse(text) as { code?: string };
        if (data.code && data.code.trim()) {
          setScanCode(data.code.trim());
          setPolling(false);
          await agentPost("/scan/clear");
        }
      } catch {
        /* ignore */
      }
    }, 500);
    return () => clearInterval(id);
  }, [polling, agentConnected]);

  const lookupByCode = useCallback(
    (code: string): Attendee | undefined => {
      const c = code.toLowerCase();
      return attendees.find(
        (a) =>
          (a.code ?? "").toLowerCase() === c || (a.id ?? "").toLowerCase() === c
      );
    },
    [attendees]
  );

  useEffect(() => {
    handleScanCodeRef.current = (code: string) => {
      setScanCode("");
      const attendee = lookupByCode(code);
      if (!attendee) {
        setScanResult({ status: "error", message: t("notFound") });
        return;
      }
      if (attendee.blocked) {
        setScanResult({
          status: "error",
          attendee,
          message: attendee.block_reason || "Blocked",
        });
        return;
      }
      const isFirstCheckin = !attendee.checkin_status;
      api
        .put(`/api/attendees/${attendee.id}`, { checkin_status: true })
        .then(() => {
          setAttendees((prev) =>
            prev.map((a) =>
              a.id === attendee.id
                ? {
                    ...a,
                    checkin_status: true,
                    checked_in_at: new Date().toISOString(),
                  }
                : a
            )
          );
          setScanResult({
            status: isFirstCheckin ? "success" : "warning",
            attendee: {
              ...attendee,
              checkin_status: true,
              checked_in_at: attendee.checked_in_at || new Date().toISOString(),
            },
            message: isFirstCheckin ? t("checkIn") : t("alreadyCheckedIn"),
          });
          if (checkinSettings.printEnabled && !checkinSettings.manualPrint) {
            const updatedAttendee = {
              ...attendee,
              checkin_status: true,
              checked_in_at: attendee.checked_in_at || new Date().toISOString(),
            };
            printBadgeRef.current(updatedAttendee);
          }
        })
        .catch((e) => {
          setScanResult({
            status: "error",
            message: e instanceof Error ? e.message : t("checkinFailed"),
          });
        });
    };
  }, [lookupByCode, t, checkinSettings]);

  useEffect(() => {
    if (!scanCode) return;
    handleScanCodeRef.current(scanCode);
  }, [scanCode]);

  useEffect(() => {
    if (!scanResult) return;
    if (resultTimeoutRef.current) clearTimeout(resultTimeoutRef.current);
    resultTimeoutRef.current = setTimeout(() => {
      setScanResult(null);
      if (isScannerMode) setPolling(true);
      resultTimeoutRef.current = null;
    }, RESULT_AUTO_CLOSE_MS);
    return () => {
      if (resultTimeoutRef.current) clearTimeout(resultTimeoutRef.current);
    };
  }, [scanResult, isScannerMode]);

  const toggleFullscreen = async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      const fullscreen = await win.isFullscreen();
      await win.setFullscreen(!fullscreen);
      setIsFullscreen(!fullscreen);
    } catch {
      setIsFullscreen((v) => !v);
    }
  };

  const printBadge = useCallback(
    async (attendee: Attendee) => {
      if (!eventId || !attendee?.id) return;
      if (!agentConnected) {
        toast.error(t("agentNotConnected"));
        return;
      }
      try {
        let defaultName: string | null = null;
        try {
          const defaultText = await agentGet("/printers/default");
          const def = JSON.parse(defaultText) as { default?: string | null };
          defaultName = def.default ?? null;
        } catch {
          /* ignore */
        }
        if (!defaultName) {
          toast.error(t("noPrintersFound"));
          return;
        }
        const { data } = await api.post<{ zpl: string }>(
          `/api/events/${eventId}/badge-zpl`,
          { attendee_id: attendee.id }
        );
        if (!data?.zpl) {
          toast.error(t("printFailed"));
          return;
        }
        await agentPost(
          "/print",
          JSON.stringify({ printer_name: defaultName, zpl: data.zpl })
        );
        toast.success(t("badgePrinted"));
      } catch (e) {
        console.error("Print failed", e);
        toast.error(t("printFailed"));
      }
    },
    [eventId, agentConnected, t]
  );

  useEffect(() => {
    printBadgeRef.current = printBadge;
  }, [printBadge]);

  const closeResult = () => {
    setScanResult(null);
    if (isScannerMode) setPolling(true);
  };

  const handleTitleTap = () => {
    if (titleTapTimeoutRef.current) clearTimeout(titleTapTimeoutRef.current);
    const next = titleTapCount + 1;
    setTitleTapCount(next);
    if (next >= 5) {
      setTitleTapCount(0);
      navigate("/checkin");
      return;
    }
    titleTapTimeoutRef.current = setTimeout(() => setTitleTapCount(0), 2000);
  };

  useEffect(() => {
    return () => {
      if (titleTapTimeoutRef.current) {
        clearTimeout(titleTapTimeoutRef.current);
        titleTapTimeoutRef.current = null;
      }
    };
  }, []);

  const getBackgroundColor = () => {
    if (!scanResult) return "bg-background";
    switch (scanResult.status) {
      case "success":
        return "bg-green-500";
      case "warning":
        return "bg-yellow-500";
      case "error":
        return "bg-red-500";
      default:
        return "bg-background";
    }
  };

  const getResultIcon = () => {
    if (!scanResult) return null;
    switch (scanResult.status) {
      case "success":
        return <CheckCircle className="h-24 w-24 text-white" />;
      case "warning":
        return <AlertTriangle className="h-24 w-24 text-white" />;
      case "error":
        return <XCircle className="h-24 w-24 text-white" />;
      default:
        return null;
    }
  };

  const renderAttendeeContent = (attendee: Attendee) => {
    const template =
      event?.custom_fields?.attendeeTemplate ?? getDefaultAttendeeTemplate();
    const data: Record<string, unknown> = {
      ...(attendee.custom_fields ?? {}),
      first_name: attendee.first_name,
      last_name: attendee.last_name,
      email: attendee.email ?? "",
      company: attendee.company ?? "",
      position: attendee.position ?? "",
      code: attendee.code ?? "",
    };
    const text = renderMarkdownTemplate(template, data);
    return (
      <div className="mt-4 whitespace-pre-wrap rounded-lg bg-white/20 p-4 text-left text-white">
        {event?.custom_fields?.badgeTypeField &&
          attendee.custom_fields?.[event.custom_fields.badgeTypeField] != null && (
            <div className="mb-4 rounded border-2 border-white/50 bg-white/10 px-4 py-2">
              <div className="text-sm font-semibold uppercase opacity-90">
                {event.custom_fields.badgeTypeField}
              </div>
              <div className="text-2xl font-bold">
                {String(attendee.custom_fields[event.custom_fields.badgeTypeField])}
              </div>
            </div>
          )}
        <pre className="font-sans text-sm leading-relaxed">{text}</pre>
      </div>
    );
  };

  if (!eventId) {
    return (
      <div className="p-4">
        <Button variant="ghost" onClick={() => navigate("/checkin")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t("back")}
        </Button>
        <p className="mt-4 text-muted-foreground">{t("eventNotFound")}</p>
      </div>
    );
  }

  return (
    <div
      className={`min-h-screen transition-colors duration-300 ${scanResult ? getBackgroundColor() : "bg-background"}`}
    >
      <header className="flex items-center justify-between border-b border-border/50 bg-card/90 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-2">
          <div onClick={handleTitleTap} onKeyDown={(e) => e.key === "Enter" && handleTitleTap()} role="button" tabIndex={0} aria-label={t("navigateToCheckin")}>
            <h1 className="text-xl font-semibold">{event?.name ?? t("checkin")}</h1>
            <p className="text-sm text-muted-foreground">{t("checkinInterfaceDesc")}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="h-11 w-11"
            onClick={toggleFullscreen}
            title={t("fullscreen")}
          >
            {isFullscreen ? (
              <Minimize className="h-7 w-7" />
            ) : (
              <Maximize className="h-7 w-7" />
            )}
          </Button>
          <LanguageSwitcher />
        </div>
      </header>

      {loading ? (
        <div className="flex min-h-[60vh] items-center justify-center">
          <p className="text-muted-foreground">{t("loading")}</p>
        </div>
      ) : loadError ? (
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6">
          <p className="text-center text-destructive">{loadError}</p>
          <Button variant="outline" onClick={() => navigate("/checkin")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t("back")}
          </Button>
        </div>
      ) : scanResult ? (
        <div className="flex min-h-[calc(100vh-80px)] flex-col items-center justify-center p-6">
          <div className="flex flex-col items-center text-center">
            {getResultIcon()}
            <h2 className="mt-4 text-3xl font-bold text-white">{scanResult.message}</h2>
            {scanResult.attendee && renderAttendeeContent(scanResult.attendee)}
            <div className="mt-8 flex gap-4">
              {checkinSettings.printEnabled && checkinSettings.manualPrint && scanResult.attendee && (
                <Button
                  variant="secondary"
                  size="lg"
                  onClick={() => printBadge(scanResult.attendee!)}
                >
                  {t("print")}
                </Button>
              )}
              <Button variant="secondary" size="lg" onClick={closeResult}>
                {t("close")}
              </Button>
            </div>
          </div>
          <div className="fixed bottom-0 left-0 right-0 flex justify-center gap-8 border-t border-white/20 bg-black/20 py-3 text-sm text-white/90">
            <span className="flex items-center gap-2">
              <span className="h-4 w-4 rounded-full bg-green-400" />
              {t("firstCheckin")}
            </span>
            <span className="flex items-center gap-2">
              <span className="h-4 w-4 rounded-full bg-yellow-400" />
              {t("repeatCheckin")}
            </span>
            <span className="flex items-center gap-2">
              <span className="h-4 w-4 rounded-full bg-red-400" />
              {t("notFound")}
            </span>
          </div>
        </div>
      ) : isScannerMode ? (
        <div className="flex min-h-[calc(100vh-80px)] flex-col items-center justify-center p-6">
          <div className="flex flex-col items-center gap-6 text-center">
            <ScanLine className="h-24 w-24 text-muted-foreground" />
            <p className="text-xl font-medium text-foreground">{t("scanYourCode")}</p>
            {polling && (
              <p className="text-sm text-muted-foreground">{t("listeningForScan")}</p>
            )}
          </div>
        </div>
      ) : isCameraMode && cameraDenied ? (
        <div className="flex min-h-[calc(100vh-80px)] flex-col items-center justify-center gap-6 p-6 text-center">
          <p className="text-muted-foreground">{t("cameraPermissionDenied")}</p>
          <Button
            onClick={() => {
              const next = { ...checkinSettings, checkinMode: "scanner" as const };
              saveCheckinSettings(next);
              setCheckinSettings(next);
              setForceScannerMode(true);
            }}
          >
            {t("switchToScanner")}
          </Button>
        </div>
      ) : isCameraMode ? (
        <div className="flex min-h-[calc(100vh-80px)] flex-col items-center justify-center p-6">
          <div className="relative aspect-square w-full max-w-[min(500px,80vw)] overflow-hidden rounded-lg border-4 border-primary bg-muted">
            <video
              ref={videoRef}
              className="h-full w-full object-cover"
              playsInline
              muted
            />
            <canvas ref={canvasRef} className="hidden" />
          </div>
          <p className="mt-4 text-sm text-muted-foreground">{t("scanYourCode")}</p>
        </div>
      ) : null}
    </div>
  );
}
