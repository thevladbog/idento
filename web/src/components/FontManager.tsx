import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useEventFonts } from "@/hooks/useFonts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Upload,
  Trash2,
  FileType,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface FontManagerProps {
  eventId: string;
}

export function FontManager({ eventId }: FontManagerProps) {
  const { t } = useTranslation();
  const { fonts, loading, fetchFonts, uploadFont, deleteFont } =
    useEventFonts(eventId);
  const [isOpen, setIsOpen] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [family, setFamily] = useState("");
  const [weight, setWeight] = useState("normal");
  const [style, setStyle] = useState("normal");
  const [file, setFile] = useState<File | null>(null);
  const [licenseAccepted, setLicenseAccepted] = useState(false);

  const resetForm = () => {
    setName("");
    setFamily("");
    setWeight("normal");
    setStyle("normal");
    setFile(null);
    setLicenseAccepted(false);
  };

  const handleUpload = async () => {
    if (!name || !family || !file) {
      toast.error(t("fillRequiredFields"));
      return;
    }

    if (!licenseAccepted) {
      toast.error(t("fontLicenseRequired"));
      return;
    }

    setUploading(true);
    try {
      await uploadFont({ name, family, weight, style, file, licenseAccepted });
      toast.success(t("fontUploaded", { name }));
      resetForm();
      setIsOpen(false);
    } catch (error: unknown) {
      const message = error && typeof error === 'object' && 'response' in error
        ? (error as { response?: { data?: { error?: string } } }).response?.data?.error
        : null;
      toast.error(message || t("fontUploadError"));
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: string, fontName: string) => {
    if (!confirm(t("confirmDeleteFont", { name: fontName }))) return;

    try {
      await deleteFont(id);
      toast.success(t("fontDeleted", { name: fontName }));
    } catch {
      toast.error(t("fontDeleteError"));
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    // Validate extension
    const ext = selectedFile.name.split(".").pop()?.toLowerCase();
    if (!["woff2", "woff", "ttf", "otf"].includes(ext || "")) {
      toast.error(t("invalidFontFormat"));
      return;
    }

    // Validate size
    if (selectedFile.size > 5 * 1024 * 1024) {
      toast.error(t("fontFileTooLarge"));
      return;
    }

    setFile(selectedFile);

    // Auto-fill family name from filename
    if (!family) {
      const baseName = selectedFile.name.replace(/\.[^/.]+$/, "");
      // Try to extract font family from filename like "Roboto-Bold.woff2"
      const parts = baseName.split(/[-_]/);
      setFamily(parts[0]);
      if (!name) {
        setName(baseName.replace(/[-_]/g, " "));
      }
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileType className="h-5 w-5" />
              {t("fontsForBadges")}
            </CardTitle>
            <CardDescription>{t("fontsForBadgesDesc")}</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={fetchFonts}
              disabled={loading}
            >
              <RefreshCw
                className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`}
              />
              {t("refresh")}
            </Button>
            <Dialog open={isOpen} onOpenChange={setIsOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Upload className="h-4 w-4 mr-2" />
                  {t("uploadFont")}
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg max-h-[90vh] flex flex-col">
                <DialogHeader className="flex-shrink-0">
                  <DialogTitle>{t("uploadFontTitle")}</DialogTitle>
                  <DialogDescription>{t("uploadFontDesc")}</DialogDescription>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto space-y-4 py-4">
                  <div>
                    <Label htmlFor="font-file">{t("fontFile")} *</Label>
                    <Input
                      id="font-file"
                      type="file"
                      accept=".woff2,.woff,.ttf,.otf"
                      onChange={handleFileChange}
                      className="mt-1"
                    />
                    {file && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {file.name} ({formatFileSize(file.size)})
                      </p>
                    )}
                  </div>

                  <div>
                    <Label htmlFor="font-name">{t("fontName")} *</Label>
                    <Input
                      id="font-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Roboto Bold"
                      className="mt-1"
                    />
                  </div>

                  <div>
                    <Label htmlFor="font-family">{t("fontFamily")} *</Label>
                    <Input
                      id="font-family"
                      value={family}
                      onChange={(e) => setFamily(e.target.value)}
                      placeholder="Roboto"
                      className="mt-1"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      {t("fontFamilyHint")}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>{t("fontWeight")}</Label>
                      <Select value={weight} onValueChange={setWeight}>
                        <SelectTrigger className="mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="100">
                            {t("fontWeightThin")}
                          </SelectItem>
                          <SelectItem value="200">
                            {t("fontWeightExtraLight")}
                          </SelectItem>
                          <SelectItem value="300">
                            {t("fontWeightLight")}
                          </SelectItem>
                          <SelectItem value="normal">
                            {t("fontWeightNormal")}
                          </SelectItem>
                          <SelectItem value="500">
                            {t("fontWeightMedium")}
                          </SelectItem>
                          <SelectItem value="600">
                            {t("fontWeightSemiBold")}
                          </SelectItem>
                          <SelectItem value="bold">
                            {t("fontWeightBold")}
                          </SelectItem>
                          <SelectItem value="800">
                            {t("fontWeightExtraBold")}
                          </SelectItem>
                          <SelectItem value="900">
                            {t("fontWeightBlack")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label>{t("fontStyle")}</Label>
                      <Select value={style} onValueChange={setStyle}>
                        <SelectTrigger className="mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="normal">
                            {t("fontStyleNormal")}
                          </SelectItem>
                          <SelectItem value="italic">
                            {t("fontStyleItalic")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* License Agreement */}
                  <Alert
                    variant="destructive"
                    className="bg-amber-50 border-amber-200 dark:bg-amber-950 dark:border-amber-800"
                  >
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <AlertTitle className="text-amber-800 dark:text-amber-200">
                      {t("fontLicenseTitle")}
                    </AlertTitle>
                    <AlertDescription className="text-amber-700 dark:text-amber-300 text-xs space-y-2">
                      <ol className="list-decimal list-inside space-y-1 mt-2">
                        <li>{t("fontLicenseText1")}</li>
                        <li>{t("fontLicenseText2")}</li>
                        <li>{t("fontLicenseText3")}</li>
                        <li>{t("fontLicenseText4")}</li>
                      </ol>
                    </AlertDescription>
                  </Alert>

                  <div className="flex items-start space-x-2">
                    <Checkbox
                      id="license-accepted"
                      checked={licenseAccepted}
                      onCheckedChange={(checked) =>
                        setLicenseAccepted(checked === true)
                      }
                    />
                    <label
                      htmlFor="license-accepted"
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                    >
                      {t("fontLicenseAccept")}
                    </label>
                  </div>
                </div>

                <div className="flex-shrink-0 flex justify-end gap-2 pt-4 border-t">
                  <Button
                    variant="outline"
                    onClick={() => {
                      resetForm();
                      setIsOpen(false);
                    }}
                  >
                    {t("cancel")}
                  </Button>
                  <Button
                    onClick={handleUpload}
                    disabled={uploading || !licenseAccepted}
                  >
                    {uploading ? t("uploading") : t("uploadFont")}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {fonts.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <FileType className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>{t("noFontsUploaded")}</p>
            <p className="text-sm mt-1">{t("noFontsUploadedDesc")}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {fonts.map((font) => (
              <div
                key={font.id}
                className="flex items-center justify-between p-3 border rounded-lg"
              >
                <div className="flex items-center gap-4">
                  <FileType className="h-8 w-8 text-muted-foreground" />
                  <div>
                    <div className="font-medium">{font.name}</div>
                    <div className="text-sm text-muted-foreground">
                      <code className="bg-muted px-1 rounded">
                        {font.family}
                      </code>
                      {" • "}
                      {font.weight}
                      {font.style !== "normal" && ` • ${font.style}`}
                      {" • "}
                      {font.format.toUpperCase()}
                      {" • "}
                      {formatFileSize(font.size)}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    style={{ fontFamily: font.family, fontWeight: font.weight }}
                    className="text-lg"
                  >
                    АБВ abc 123
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive hover:text-destructive"
                    onClick={() => handleDelete(font.id, font.name)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 p-3 bg-muted/50 rounded-lg text-sm text-muted-foreground">
          <p className="font-medium text-foreground mb-1">
            💡 {t("fontHowItWorks")}
          </p>
          <ul className="list-disc list-inside space-y-1">
            <li>{t("fontHowItWorks1")}</li>
            <li>{t("fontHowItWorks2")}</li>
            <li>
              {t("fontHowItWorks3")} (<strong>Font Family</strong>)
            </li>
            <li>
              {t("fontHowItWorks4")} (<strong>woff2</strong>)
            </li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
