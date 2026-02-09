import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Printer, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { agentApi } from "@/lib/agent";
import { loadEventFonts } from "@/lib/fonts";
import { generateZPL, type BadgeElement } from "@/utils/zpl";
import type { Attendee } from "@/types";
import { toast } from "sonner";

interface PrintBadgeDialogProps {
  attendee: Attendee;
  eventId?: string;
  template?: {
    width_mm: number;
    height_mm: number;
    dpi: 203 | 300;
    elements: BadgeElement[];
  };
  trigger?: React.ReactNode;
}

export function PrintBadgeDialog({
  attendee,
  eventId,
  template,
  trigger,
}: PrintBadgeDialogProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [printers, setPrinters] = useState<string[]>([]);
  const [selectedPrinter, setSelectedPrinter] = useState<string>("");
  const [isAgentConnected, setIsAgentConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);

  // Default template if none provided
  const defaultTemplate = {
    width_mm: 80,
    height_mm: 50,
    dpi: 203 as const,
    elements: [
      {
        id: "name",
        type: "text" as const,
        x: 5,
        y: 5,
        width: 50,
        height: 10,
        fontSize: 18,
        source: "first_name",
        align: "left" as const,
        bold: true,
        maxLines: 1,
      },
      {
        id: "company",
        type: "text" as const,
        x: 5,
        y: 18,
        width: 50,
        height: 8,
        fontSize: 12,
        source: "company",
        align: "left" as const,
        maxLines: 1,
      },
      {
        id: "qr",
        type: "qrcode" as const,
        x: 58,
        y: 5,
        width: 20,
        height: 20,
        source: "code",
      },
    ],
  };

  const activeTemplate = template || defaultTemplate;

  // Log template info for debugging
  useEffect(() => {
    if (isOpen) {
      console.log("PrintBadgeDialog - Template Info:", {
        hasTemplate: !!template,
        template: template,
        activeTemplate: activeTemplate,
      });
    }
  }, [isOpen, template, activeTemplate]);

  const checkAgent = async () => {
    setIsLoading(true);
    const healthy = await agentApi.checkHealth();
    setIsAgentConnected(healthy);
    if (healthy) {
      const printerList = await agentApi.getPrinters();
      const printerNames = printerList.map((p) => p.name);
      setPrinters(printerNames);
      if (printerNames.length > 0) {
        const defaultName = await agentApi.getDefaultPrinter();
        const initial =
          defaultName && printerNames.includes(defaultName)
            ? defaultName
            : printerNames[0];
        setSelectedPrinter(initial);
      }
    }
    setIsLoading(false);
  };

  useEffect(() => {
    if (isOpen) {
      checkAgent();
      // Load custom fonts for this event
      if (eventId) {
        loadEventFonts(eventId);
      }
    }
  }, [isOpen, eventId]);

  const handlePrint = async () => {
    if (!selectedPrinter) return;

    setIsPrinting(true);
    try {
      // Prepare attendee data including custom fields
      const attendeeData = {
        first_name: attendee.first_name,
        last_name: attendee.last_name,
        email: attendee.email,
        company: attendee.company || "",
        position: attendee.position || "",
        code: attendee.code,
        ...(attendee.custom_fields || {}),
      };

      // Generate ZPL from template
      const zpl = await generateZPL(
        {
          widthMM: activeTemplate.width_mm,
          heightMM: activeTemplate.height_mm,
          dpi: activeTemplate.dpi,
        },
        activeTemplate.elements,
        attendeeData
      );

      await agentApi.print({
        printer_name: selectedPrinter,
        zpl: zpl,
      });

      setIsOpen(false);
      toast.success(t("badgeSentToPrinter"));
    } catch (error) {
      console.error("Print failed", error);
      toast.error(t("printFailedCheckLogs"));
    } finally {
      setIsPrinting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="ghost" size="icon" title={t("printBadge")}>
            <Printer className="h-4 w-4" />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("printBadge")}</DialogTitle>
          <DialogDescription>
            {t("printBadgeFor")} {attendee.first_name} {attendee.last_name}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="py-6 text-center text-muted-foreground">
            {t("connectingAgent")}
          </div>
        ) : !isAgentConnected ? (
          <div className="py-4 text-center">
            <p className="text-destructive mb-4">{t("agentNotFound")}</p>
            <p className="text-sm text-muted-foreground mb-4">
              {t("agentNotFoundDesc")}
            </p>
            <Button variant="outline" onClick={checkAgent}>
              <RefreshCw className="mr-2 h-4 w-4" /> {t("retry")}
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">{t("printer")}</Label>
              <div className="col-span-3">
                <Select
                  value={selectedPrinter}
                  onValueChange={setSelectedPrinter}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("selectPrinter")} />
                  </SelectTrigger>
                  <SelectContent>
                    {printers.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="rounded-md bg-muted p-4 text-xs font-mono">
              {t("previewData")}
              <br />
              {attendee.first_name} {attendee.last_name}
              <br />
              {attendee.company}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setIsOpen(false)}>
            {t("cancel")}
          </Button>
          <Button
            onClick={handlePrint}
            disabled={!isAgentConnected || !selectedPrinter || isPrinting}
          >
            {isPrinting ? t("printing") : t("print")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
