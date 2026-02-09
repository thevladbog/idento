import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getBackendUrl, setBackendUrl } from "@/lib/config";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

export default function ConnectionPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [url, setUrl] = useState(getBackendUrl());
  const [status, setStatus] = useState<"idle" | "checking" | "ok" | "error">("idle");
  const [message, setMessage] = useState("");

  const checkConnection = async () => {
    setStatus("checking");
    setMessage("");
    try {
      const base = url.trim().replace(/\/$/, "");
      const res = await fetch(`${base}/health`, { method: "GET" });
      if (res.ok) {
        setStatus("ok");
        setMessage(t("connected"));
      } else {
        setStatus("error");
        setMessage(`HTTP ${res.status}`);
      }
    } catch (e) {
      setStatus("error");
      setMessage(e instanceof Error ? e.message : t("connectionFailed"));
    }
  };

  const save = () => {
    const normalizedBase = url.trim().replace(/\/$/, "");
    setBackendUrl(normalizedBase);
    api.defaults.baseURL = normalizedBase;
    navigate("/login");
  };

  useEffect(() => {
    setUrl(getBackendUrl());
  }, []);

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="absolute right-4 top-4">
        <LanguageSwitcher />
      </div>
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>{t("serverUrl")}</CardTitle>
          <CardDescription>{t("serverUrlDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="backend-url">URL</Label>
            <Input
              id="backend-url"
              type="url"
              placeholder={t("serverUrlPlaceholder")}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          {status === "checking" && <p className="text-sm text-muted-foreground">{t("checking")}</p>}
          {status === "ok" && <p className="text-sm text-green-600">{message}</p>}
          {status === "error" && <p className="text-sm text-destructive">{message}</p>}
        </CardContent>
        <CardFooter className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={checkConnection} disabled={status === "checking"}>
            {t("connect")}
          </Button>
          <Button onClick={save}>
            {t("saveAndGoToLoginShort")}
          </Button>
          <Button variant="ghost" onClick={() => navigate("/login")} className="shrink-0">
            {t("cancel")}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
