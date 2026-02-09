import { useState, useRef, useEffect } from "react";
import { useParams, useOutletContext } from "react-router-dom";
import { Stage, Layer, Rect, Text as KonvaText, Group } from "react-konva";
import { useTranslation } from "react-i18next";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Save,
  Type,
  QrCode as QrCodeIcon,
  Trash2,
  Square,
  Code,
  Download,
} from "lucide-react";
import { getAvailableFonts, loadEventFonts } from "@/lib/fonts";
import { generateZPL, type BadgeElement, type ZPLConfig } from "@/utils/zpl";
import type { Event } from "@/types";
import { toast } from "sonner";
import { agentApi } from "@/lib/agent";

interface EventContext {
  event: Event | null;
  reloadEvent: () => void;
}

export default function BadgeTemplateEditorV2() {
  const { t } = useTranslation();
  const { eventId } = useParams<{ eventId: string }>();
  const { reloadEvent } = useOutletContext<EventContext>();

  // Template settings
  const [widthMM, setWidthMM] = useState(80);
  const [heightMM, setHeightMM] = useState(50);
  const [dpi, setDpi] = useState<203 | 300>(203);

  // Canvas settings (for visual editor - 3mm = 12px)
  const SCALE = 4; // 1mm = 4px for editor

  const [elements, setElements] = useState<BadgeElement[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [event, setEvent] = useState<Event | null>(null);
  const [fieldSchema, setFieldSchema] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [showZPL, setShowZPL] = useState(false);
  const [zplOutput, setZPLOutput] = useState("");
  const [customFonts, setCustomFonts] = useState<string[]>([]);
  const [showFontsDialog, setShowFontsDialog] = useState(false);
  const [showPrinterSelectDialog, setShowPrinterSelectDialog] = useState(false);
  const [printers, setPrinters] = useState<string[]>([]);
  const [selectedPrinter, setSelectedPrinter] = useState<string>("");
  const [fontsNote, setFontsNote] = useState("");
  const [availableFontsList, setAvailableFontsList] = useState<string[]>([]);

  const stageRef = useRef(null);

  useEffect(() => {
    if (eventId) {
      loadEventAndTemplate();
      // Load fonts for this event
      loadEventFonts(eventId).then(() => {
        getAvailableFonts(eventId).then(setAvailableFontsList);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load when eventId changes
  }, [eventId]);

  const loadEventAndTemplate = async () => {
    try {
      const eventRes = await api.get<Event>(`/api/events/${eventId}`);
      setEvent(eventRes.data);

      // Load field schema - always include standard fields + CSV fields
      const standardFields = [
        "code",
        "first_name",
        "last_name",
        "email",
        "company",
        "position",
      ];
      const csvFields = eventRes.data.field_schema || [];

      // Merge and deduplicate
      const allFields = [...new Set([...standardFields, ...csvFields])];
      setFieldSchema(allFields);

      // Load existing template
      if (eventRes.data.custom_fields?.badgeTemplate) {
        const template = eventRes.data.custom_fields.badgeTemplate as { elements?: BadgeElement[]; width_mm?: number; height_mm?: number; dpi?: number };
        if (template.elements) setElements(template.elements);
        if (template.width_mm) setWidthMM(template.width_mm);
        if (template.height_mm) setHeightMM(template.height_mm);
        if (template.dpi) setDpi(template.dpi as 203 | 300);
      }
    } catch (error) {
      console.error("Failed to load event", error);
    }
  };

  const addTextField = () => {
    const newElement: BadgeElement = {
      id: `text-${Date.now()}`,
      type: "text",
      x: 10,
      y: 10,
      width: 60, // mm - text zone width
      height: 8, // mm - text zone height
      fontSize: 12,
      source: "first_name",
      align: "left",
      valign: "top",
      fontFamily: "A",
      rotation: 0,
      bold: false,
      maxLines: 1,
    };
    setElements([...elements, newElement]);
    setSelectedId(newElement.id);
  };

  const addQRCode = () => {
    const newElement: BadgeElement = {
      id: `qr-${Date.now()}`,
      type: "qrcode",
      x: widthMM - 25,
      y: 10,
      width: 20,
      height: 20,
      source: "code",
    };
    setElements([...elements, newElement]);
    setSelectedId(newElement.id);
  };

  const addBarcode = () => {
    const newElement: BadgeElement = {
      id: `barcode-${Date.now()}`,
      type: "barcode",
      x: 10,
      y: heightMM - 15,
      width: 60,
      height: 10,
      source: "code",
    };
    setElements([...elements, newElement]);
    setSelectedId(newElement.id);
  };

  const addLine = () => {
    const newElement: BadgeElement = {
      id: `line-${Date.now()}`,
      type: "line",
      x: 5,
      y: 25,
      width: widthMM - 10,
      height: 0.5,
    };
    setElements([...elements, newElement]);
    setSelectedId(newElement.id);
  };

  const addBox = () => {
    const newElement: BadgeElement = {
      id: `box-${Date.now()}`,
      type: "box",
      x: 5,
      y: 5,
      width: widthMM - 10,
      height: heightMM - 10,
    };
    setElements([...elements, newElement]);
    setSelectedId(newElement.id);
  };

  const handleDragEnd = (e: { target: { x(): number; y(): number } }, id: string) => {
    const newX = Math.round((e.target.x() / SCALE) * 10) / 10;
    const newY = Math.round((e.target.y() / SCALE) * 10) / 10;

    setElements(
      elements.map((el) => (el.id === id ? { ...el, x: newX, y: newY } : el))
    );
  };

  const updateElement = (id: string, updates: Partial<BadgeElement>) => {
    setElements(
      elements.map((el) => (el.id === id ? { ...el, ...updates } : el))
    );
  };

  const deleteElement = () => {
    if (selectedId) {
      setElements(elements.filter((el) => el.id !== selectedId));
      setSelectedId(null);
    }
  };

  const handleSave = async () => {
    if (!eventId || !event) return;

    setIsSaving(true);
    try {
      const template = {
        width_mm: widthMM,
        height_mm: heightMM,
        dpi: dpi,
        elements: elements,
      };

      console.log("Saving badge template:", template);

      await api.put(`/api/events/${eventId}`, {
        ...event,
        custom_fields: {
          ...event.custom_fields,
          badgeTemplate: template,
        },
      });

      console.log("Template saved successfully");

      // Reload event to get updated template
      await loadEventAndTemplate();

      // Also reload event in parent context
      if (reloadEvent) {
        reloadEvent();
      }

      toast.success(t("templateSaved"));
    } catch (error) {
      console.error("Failed to save template", error);
      toast.error(t("templateSaveFailed"));
    } finally {
      setIsSaving(false);
    }
  };

  const loadFonts = async () => {
    try {
      // First, load printers from agent
      const printerList = await agentApi.getPrinters();
      if (printerList && printerList.length > 0) {
        setPrinters(printerList);
        setSelectedPrinter(printerList[0]);
        setShowPrinterSelectDialog(true);
      } else {
        // Fallback to general reference
        const fontsData = await agentApi.getFonts();
        if (fontsData) {
          setCustomFonts(fontsData.custom_examples);
          setFontsNote(fontsData.note);
          setShowFontsDialog(true);
        } else {
          toast.error(t("agentNotAvailable"));
        }
      }
    } catch (error) {
      console.error("Failed to load fonts", error);
      toast.error(t("failedToLoadFonts"));
    }
  };

  const queryPrinterFonts = async () => {
    if (!selectedPrinter) {
      toast.error(t("selectPrinterFirst"));
      return;
    }

    try {
      const printerFonts = await agentApi.getPrinterFonts(selectedPrinter);
      if (printerFonts) {
        // Combine resident and loaded fonts for display
        const allFonts = [
          ...(printerFonts.resident_fonts || []),
          ...(printerFonts.loaded_fonts_examples || []),
        ];
        setCustomFonts(allFonts);

        // Build complete note with all information
        let fullNote = printerFonts.note;
        if (printerFonts.instructions) {
          fullNote += "\n\n" + printerFonts.instructions;
        }
        if (printerFonts.warning) {
          fullNote += "\n\n⚠️ " + printerFonts.warning;
        }

        setFontsNote(fullNote);
        setShowPrinterSelectDialog(false);
        setShowFontsDialog(true);

        if (printerFonts.query_method === "printed") {
          toast.success(t("queryPrintedOnLabel"), { duration: 5000 });
        } else {
          toast.success(t("fontsLoadedFromPrinter"));
        }
      } else {
        toast.error(t("failedToQueryPrinter"));
      }
    } catch (error) {
      console.error("Failed to query printer fonts", error);
      toast.error(t("failedToQueryPrinter"));
    }
  };

  const previewZPL = async () => {
    const config: ZPLConfig = { widthMM, heightMM, dpi };
    const sampleData = {
      code: "ABC123XYZ",
      first_name: "John",
      last_name: "Doe",
      email: "john.doe@example.com",
      company: "Acme Corporation",
      position: "CEO",
    };

    const zpl = await generateZPL(config, elements, sampleData);
    setZPLOutput(zpl);
    setShowZPL(true);
  };

  const copyZPL = () => {
    navigator.clipboard.writeText(zplOutput);
    toast.success(t("copiedToClipboard"));
  };

  const selectedElement = elements.find((el) => el.id === selectedId);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">{t("badgeTemplateEditor")}</h2>
          <p className="text-muted-foreground">
            {t("badgeTemplateEditorDesc")}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={previewZPL}>
            <Code className="mr-2 h-4 w-4" /> {t("previewZPL")}
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            <Save className="mr-2 h-4 w-4" />{" "}
            {isSaving ? t("saving") : t("save")}
          </Button>
        </div>
      </div>

      {/* Canvas - Full Width */}
      <div>
        <Card>
          <CardHeader>
            <CardTitle>
              {t("badgePreview")} ({widthMM}mm × {heightMM}mm @ {dpi} DPI)
            </CardTitle>
          </CardHeader>
          <CardContent className="flex justify-center items-center bg-slate-50 dark:bg-slate-800/50 p-8 min-h-[500px]">
            <div
              style={{
                border: "2px dashed #cbd5e1",
                background: "white",
                boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                borderRadius: "4px",
              }}
            >
              <Stage
                width={widthMM * SCALE}
                height={heightMM * SCALE}
                ref={stageRef}
                onMouseDown={(e) => {
                  const clickedOnEmpty = e.target === e.target.getStage();
                  if (clickedOnEmpty) {
                    setSelectedId(null);
                  }
                }}
              >
                <Layer>
                  {elements.map((el) => {
                    const isSelected = el.id === selectedId;

                    if (el.type === "text") {
                      return (
                        <Group key={el.id}>
                          {/* Text zone background */}
                          {el.width && (
                            <Rect
                              x={el.x * SCALE}
                              y={el.y * SCALE}
                              width={el.width * SCALE}
                              height={(el.height || 8) * SCALE}
                              fill={
                                isSelected
                                  ? "rgba(0,146,70,0.1)"
                                  : "transparent"
                              }
                              stroke={isSelected ? "#009246" : "#ccc"}
                              strokeWidth={1}
                              dash={[5, 5]}
                              draggable
                              onDragEnd={(e) => handleDragEnd(e, el.id)}
                              onClick={() => setSelectedId(el.id)}
                            />
                          )}
                          <KonvaText
                            x={el.x * SCALE}
                            y={el.y * SCALE}
                            width={el.width ? el.width * SCALE : undefined}
                            height={el.height ? el.height * SCALE : undefined}
                            text={
                              el.source && fieldSchema.includes(el.source)
                                ? `{{${el.source}}}`
                                : el.text || "Text"
                            }
                            fontSize={el.fontSize || 12}
                            fontStyle={el.bold ? "bold" : "normal"}
                            align={el.align || "left"}
                            verticalAlign={el.valign || "top"}
                            fill="black"
                            listening={false}
                          />
                        </Group>
                      );
                    }

                    if (el.type === "qrcode") {
                      return (
                        <Rect
                          key={el.id}
                          x={el.x * SCALE}
                          y={el.y * SCALE}
                          width={(el.width || 20) * SCALE}
                          height={(el.height || 20) * SCALE}
                          fill={isSelected ? "rgba(0,146,70,0.2)" : "#333"}
                          stroke={isSelected ? "#009246" : "#666"}
                          strokeWidth={2}
                          draggable
                          onDragEnd={(e) => handleDragEnd(e, el.id)}
                          onClick={() => setSelectedId(el.id)}
                        />
                      );
                    }

                    if (el.type === "barcode") {
                      return (
                        <Rect
                          key={el.id}
                          x={el.x * SCALE}
                          y={el.y * SCALE}
                          width={(el.width || 40) * SCALE}
                          height={(el.height || 10) * SCALE}
                          fill={
                            isSelected ? "rgba(0,146,70,0.1)" : "transparent"
                          }
                          stroke={isSelected ? "#009246" : "#333"}
                          strokeWidth={1}
                          dash={[2, 2]}
                          draggable
                          onDragEnd={(e) => handleDragEnd(e, el.id)}
                          onClick={() => setSelectedId(el.id)}
                        />
                      );
                    }

                    if (el.type === "line") {
                      return (
                        <Rect
                          key={el.id}
                          x={el.x * SCALE}
                          y={el.y * SCALE}
                          width={(el.width || 10) * SCALE}
                          height={2}
                          fill={isSelected ? "#009246" : "#000"}
                          draggable
                          onDragEnd={(e) => handleDragEnd(e, el.id)}
                          onClick={() => setSelectedId(el.id)}
                        />
                      );
                    }

                    if (el.type === "box") {
                      return (
                        <Rect
                          key={el.id}
                          x={el.x * SCALE}
                          y={el.y * SCALE}
                          width={(el.width || 10) * SCALE}
                          height={(el.height || 10) * SCALE}
                          fill="transparent"
                          stroke={isSelected ? "#009246" : "#000"}
                          strokeWidth={2}
                          draggable
                          onDragEnd={(e) => handleDragEnd(e, el.id)}
                          onClick={() => setSelectedId(el.id)}
                        />
                      );
                    }

                    return null;
                  })}
                </Layer>
              </Stage>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Properties Panel - Below Canvas */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Label Settings */}
        <div>
          {/* Label Settings */}
          <Card>
            <CardHeader>
              <CardTitle>{t("labelSettings")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label>{t("widthMm")}</Label>
                <Input
                  type="number"
                  value={widthMM}
                  onChange={(e) => setWidthMM(Number(e.target.value))}
                  min={10}
                  max={200}
                />
              </div>
              <div>
                <Label>{t("heightMm")}</Label>
                <Input
                  type="number"
                  value={heightMM}
                  onChange={(e) => setHeightMM(Number(e.target.value))}
                  min={10}
                  max={200}
                />
              </div>
              <div>
                <Label>{t("resolution")}</Label>
                <Select
                  value={String(dpi)}
                  onValueChange={(v: string) => setDpi(Number(v) as 203 | 300)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="203">
                      203 DPI ({t("standard")})
                    </SelectItem>
                    <SelectItem value="300">
                      300 DPI ({t("highQuality")})
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Add Elements */}
        <div>
          <Card>
            <CardHeader>
              <CardTitle>{t("addElements")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button
                onClick={addTextField}
                variant="outline"
                className="w-full justify-start"
              >
                <Type className="mr-2 h-4 w-4" /> {t("textField")}
              </Button>
              <Button
                onClick={addQRCode}
                variant="outline"
                className="w-full justify-start"
              >
                <QrCodeIcon className="mr-2 h-4 w-4" /> {t("qrCode")}
              </Button>
              <Button
                onClick={addBarcode}
                variant="outline"
                className="w-full justify-start"
              >
                <Code className="mr-2 h-4 w-4" /> {t("barcode")}
              </Button>
              <Button
                onClick={addLine}
                variant="outline"
                className="w-full justify-start"
              >
                ─ {t("line")}
              </Button>
              <Button
                onClick={addBox}
                variant="outline"
                className="w-full justify-start"
              >
                <Square className="mr-2 h-4 w-4" /> {t("rectangle")}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Element Properties */}
        <div>
          {selectedElement ? (
            <Card>
              <CardHeader>
                <CardTitle>{t("elementProperties")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-sm text-muted-foreground">
                  {t("type")}:{" "}
                  <span className="font-semibold">{selectedElement.type}</span>
                </div>

                {/* Position */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label>X (mm)</Label>
                    <Input
                      type="number"
                      value={selectedElement.x}
                      onChange={(e) =>
                        updateElement(selectedId!, {
                          x: Number(e.target.value),
                        })
                      }
                      step="0.1"
                    />
                  </div>
                  <div>
                    <Label>Y (mm)</Label>
                    <Input
                      type="number"
                      value={selectedElement.y}
                      onChange={(e) =>
                        updateElement(selectedId!, {
                          y: Number(e.target.value),
                        })
                      }
                      step="0.1"
                    />
                  </div>
                </div>

                {/* Size */}
                {(selectedElement.type === "text" ||
                  selectedElement.type === "qrcode" ||
                  selectedElement.type === "barcode" ||
                  selectedElement.type === "box") && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label>{t("widthMm")}</Label>
                      <Input
                        type="number"
                        value={selectedElement.width || 0}
                        onChange={(e) =>
                          updateElement(selectedId!, {
                            width: Number(e.target.value),
                          })
                        }
                        step="0.1"
                      />
                    </div>
                    <div>
                      <Label>{t("heightMm")}</Label>
                      <Input
                        type="number"
                        value={selectedElement.height || 0}
                        onChange={(e) =>
                          updateElement(selectedId!, {
                            height: Number(e.target.value),
                          })
                        }
                        step="0.1"
                      />
                    </div>
                  </div>
                )}

                {selectedElement.type === "line" && (
                  <div>
                    <Label>{t("lengthMm")}</Label>
                    <Input
                      type="number"
                      value={selectedElement.width || 0}
                      onChange={(e) =>
                        updateElement(selectedId!, {
                          width: Number(e.target.value),
                        })
                      }
                      step="0.1"
                    />
                  </div>
                )}

                {/* Text Properties */}
                {selectedElement.type === "text" && (
                  <>
                    <div>
                      <Label>{t("dataSource")}</Label>
                      <Select
                        value={selectedElement.source}
                        onValueChange={(value: string) =>
                          updateElement(selectedId!, { source: value })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={t("selectField")} />
                        </SelectTrigger>
                        <SelectContent>
                          {fieldSchema.map((field) => (
                            <SelectItem key={field} value={field}>
                              {field}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label>{t("fontSize")} (pt)</Label>
                      <Input
                        type="number"
                        value={selectedElement.fontSize || 12}
                        onChange={(e) =>
                          updateElement(selectedId!, {
                            fontSize: Number(e.target.value),
                          })
                        }
                        min="6"
                        max="72"
                      />
                    </div>

                    <div>
                      <Label>{t("font")}</Label>
                      <Select
                        value={selectedElement.fontFamily || "A"}
                        onValueChange={(value: string) =>
                          updateElement(selectedId!, {
                            fontFamily: value as "0" | "A" | "B" | "D" | "E",
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="0">
                            Самый маленький (9×5)
                          </SelectItem>
                          <SelectItem value="A">Маленький (11×9)</SelectItem>
                          <SelectItem value="B">Средний (17×10)</SelectItem>
                          <SelectItem value="D">Большой (21×13)</SelectItem>
                          <SelectItem value="E">
                            Очень большой (28×15)
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground mt-1">
                        ⚠️ Только латиница. Для кириллицы используйте поле ниже.
                      </p>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <Label>{t("customFontLabelCyrillic")}</Label>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={loadFonts}
                          className="h-6 text-xs"
                        >
                          <Download className="mr-1 h-3 w-3" /> {t("getFonts")}
                        </Button>
                      </div>
                      <Input
                        type="text"
                        value={selectedElement.customFont || ""}
                        onChange={(e) =>
                          updateElement(selectedId!, {
                            customFont: e.target.value,
                          })
                        }
                        placeholder="Arial, Times New Roman, Courier..."
                      />
                      <div className="text-xs text-muted-foreground mt-2 space-y-2">
                        <p>
                          ✅{" "}
                          <strong>
                            Кириллица автоматически поддерживается!
                          </strong>
                        </p>
                        <p>
                          Текст с кириллицей рендерится как изображение с
                          системным шрифтом.
                        </p>
                        <p>{t("customFontAppliesToAllText")}</p>

                        <details className="bg-muted/50 rounded-md p-2">
                          <summary className="cursor-pointer font-medium text-foreground hover:text-primary">
                            📖 Доступные шрифты ({availableFontsList.length})
                          </summary>
                          <div className="mt-2 space-y-2 pl-2 border-l-2 border-primary/30">
                            <div>
                              <p className="font-medium text-foreground mb-1">
                                Выберите шрифт:
                              </p>
                              <div className="flex flex-wrap gap-1">
                                {availableFontsList.map((font) => (
                                  <button
                                    key={font}
                                    type="button"
                                    onClick={() =>
                                      updateElement(selectedId!, {
                                        customFont: font,
                                      })
                                    }
                                    className="px-2 py-0.5 text-xs bg-muted hover:bg-primary hover:text-primary-foreground rounded transition-colors"
                                    style={{ fontFamily: font }}
                                  >
                                    {font}
                                  </button>
                                ))}
                              </div>
                            </div>

                            <div>
                              <p className="font-medium text-foreground">
                                ➕ Добавить свой шрифт:
                              </p>
                              <p className="ml-2">
                                Перейдите в{" "}
                                <a
                                  href="/equipment"
                                  className="text-primary underline"
                                >
                                  Настройки оборудования
                                </a>{" "}
                                → Шрифты для этикеток
                              </p>
                            </div>

                            <div>
                              <p className="font-medium text-foreground">
                                ⚠️ Важно:
                              </p>
                              <p>
                                Шрифт должен быть загружен в браузере до печати.
                                Системные шрифты работают всегда.
                              </p>
                            </div>
                          </div>
                        </details>

                        <p className="text-amber-600 dark:text-amber-400">
                          💡 Оставьте пустым — будет использован Arial
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label>{t("horizontalAlign")}</Label>
                        <Select
                          value={selectedElement.align || "left"}
                          onValueChange={(value: string) =>
                            updateElement(selectedId!, {
                              align: value as "left" | "center" | "right",
                            })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="left">
                              {t("alignLeft")}
                            </SelectItem>
                            <SelectItem value="center">
                              {t("alignCenter")}
                            </SelectItem>
                            <SelectItem value="right">
                              {t("alignRight")}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>{t("verticalAlign")}</Label>
                        <Select
                          value={selectedElement.valign || "top"}
                          onValueChange={(value: string) =>
                            updateElement(selectedId!, {
                              valign: value as "top" | "middle" | "bottom",
                            })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="top">{t("alignTop")}</SelectItem>
                            <SelectItem value="middle">
                              {t("alignMiddle")}
                            </SelectItem>
                            <SelectItem value="bottom">
                              {t("alignBottom")}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div>
                      <Label>{t("maxLines")}</Label>
                      <Input
                        type="number"
                        value={selectedElement.maxLines || 1}
                        onChange={(e) =>
                          updateElement(selectedId!, {
                            maxLines: Number(e.target.value),
                          })
                        }
                        min="1"
                        max="10"
                      />
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="bold"
                        checked={selectedElement.bold || false}
                        onChange={(e) =>
                          updateElement(selectedId!, { bold: e.target.checked })
                        }
                        className="w-4 h-4"
                      />
                      <Label htmlFor="bold">{t("bold")}</Label>
                    </div>
                  </>
                )}

                {/* QR/Barcode Data Source */}
                {(selectedElement.type === "qrcode" ||
                  selectedElement.type === "barcode") && (
                  <div>
                    <Label>{t("dataSource")}</Label>
                    <Select
                      value={selectedElement.source}
                      onValueChange={(value: string) =>
                        updateElement(selectedId!, { source: value })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t("selectField")} />
                      </SelectTrigger>
                      <SelectContent>
                        {fieldSchema.map((field) => (
                          <SelectItem key={field} value={field}>
                            {field}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Delete Button */}
                <Button
                  variant="destructive"
                  onClick={deleteElement}
                  className="w-full mt-4"
                >
                  <Trash2 className="mr-2 h-4 w-4" /> {t("deleteElement")}
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                {t("selectElementToEdit")}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* ZPL Preview Dialog */}
      {showZPL && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => setShowZPL(false)}
        >
          <Card
            className="w-full max-w-3xl max-h-[80vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <CardHeader>
              <CardTitle>{t("zplPreview")}</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 p-4 rounded-md overflow-auto text-xs font-mono border border-slate-200 dark:border-slate-700">
                {zplOutput}
              </pre>
              <div className="flex gap-2 mt-4">
                <Button onClick={copyZPL} variant="outline">
                  {t("copyToClipboard")}
                </Button>
                <Button onClick={() => setShowZPL(false)}>{t("close")}</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Printer Selection Dialog */}
      {showPrinterSelectDialog && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => setShowPrinterSelectDialog(false)}
        >
          <Card
            className="w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <CardHeader>
              <CardTitle>{t("selectPrinterForQuery")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>{t("printer")}</Label>
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
              <div className="bg-muted p-3 rounded-md text-xs text-muted-foreground">
                {t("printerQueryNote")}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setShowPrinterSelectDialog(false)}
                  className="flex-1"
                >
                  {t("cancel")}
                </Button>
                <Button onClick={queryPrinterFonts} className="flex-1">
                  {t("queryFonts")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Fonts Reference Dialog */}
      {showFontsDialog && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => setShowFontsDialog(false)}
        >
          <Card
            className="w-full max-w-2xl max-h-[80vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <CardHeader>
              <CardTitle>{t("customFontsReference")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h3 className="font-semibold mb-2">{t("detectedFonts")}:</h3>
                <ul className="list-disc list-inside space-y-1 text-sm">
                  {customFonts.map((font, idx) => (
                    <li key={idx} className="font-mono text-xs">
                      {font}
                    </li>
                  ))}
                </ul>
              </div>
              {fontsNote && (
                <div className="bg-muted p-4 rounded-md">
                  <p className="text-xs text-muted-foreground whitespace-pre-line">
                    {fontsNote}
                  </p>
                </div>
              )}
              <Button
                onClick={() => setShowFontsDialog(false)}
                className="w-full"
              >
                {t("close")}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
