import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
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

export default function QRLoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [qrToken, setQrToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const response = await api.post("/auth/login-qr", { qr_token: qrToken.trim() });
      localStorage.setItem("token", response.data.token);
      localStorage.setItem("user", JSON.stringify(response.data.user));
      navigate("/checkin");
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "response" in err
          ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
          : undefined;
      setError(msg || t("invalidQRToken"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="absolute right-4 top-4">
        <LanguageSwitcher />
      </div>
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">{t("qrLogin")}</CardTitle>
          <CardDescription>{t("enterQRToken")}</CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="qr-token">{t("qrToken")}</Label>
              <Input
                id="qr-token"
                type="text"
                placeholder={t("enterQRToken")}
                value={qrToken}
                onChange={(e) => setQrToken(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </CardContent>
          <CardFooter className="flex flex-col gap-2">
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "..." : t("qrLogin")}
            </Button>
            <Link to="/login" className="text-sm text-primary underline hover:no-underline">
              {t("login")}
            </Link>
            <Link to="/connection" className="text-sm text-muted-foreground hover:text-foreground">
              {t("serverUrl")}
            </Link>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
