// Staff-QR exit trigger for self-service lockdown (K2b). Reuses the exact
// same POST /auth/login-qr check QRLogin.tsx already does for normal
// staff login -- success replaces the current session (same as a fresh QR
// login) and calls exit_lockdown before navigating back to the Mode step.
// Rendered unconditionally by SelfServicePage so it's reachable from every
// self-service state (attract, scanning, or a verdict showing) -- a real
// hardware problem shouldn't have to wait out a verdict's auto-return
// timer before staff can intervene.
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { QrCode } from "lucide-react";
import { KioskButton, KioskInput } from "@idento/ui/kiosk";
import { api } from "@/lib/api";

export function StaffExitOverlay() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { eventId } = useParams<{ eventId: string }>();
  const [open, setOpen] = useState(false);
  const [qrToken, setQrToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const close = () => {
    setOpen(false);
    setError("");
    setQrToken("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const response = await api.post("/auth/login-qr", { qr_token: qrToken.trim() });
      localStorage.setItem("token", response.data.token);
      localStorage.setItem("user", JSON.stringify(response.data.user));
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("exit_lockdown");
      } catch {
        // Not running under Tauri (e.g. plain browser dev) -- nothing to
        // reverse; the Mode navigation below still happens.
      }
      navigate(`/checkin/${eventId}/mode`);
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

  if (!open) {
    return (
      <button
        type="button"
        aria-label={t("selfStaffExit")}
        onClick={() => setOpen(true)}
        className="absolute bottom-4 right-4 rounded-full p-3 text-kiosk-text opacity-20 hover:opacity-70 focus-visible:opacity-70"
      >
        <QrCode aria-hidden className="size-6" />
      </button>
    );
  }

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-kiosk-overlay-ink">
      <form onSubmit={handleSubmit} className="flex w-[480px] flex-col gap-5 rounded-3xl border border-kiosk-border bg-kiosk-surface p-10">
        <div className="kiosk-type-verdict-title text-kiosk-text" style={{ fontSize: "calc(var(--kiosk-fs-verdict-title) * 0.7)" }}>
          {t("selfStaffExit")}
        </div>
        <KioskInput mono type="text" placeholder={t("enterQRToken")} value={qrToken} onChange={(e) => setQrToken(e.target.value)} autoFocus />
        {error && <p className="text-kiosk-danger-soft">{error}</p>}
        <div className="flex gap-3">
          <KioskButton type="submit" disabled={loading}>
            {loading ? "…" : t("selfStaffExitConfirm")}
          </KioskButton>
          <KioskButton type="button" variant="ghost" onClick={close} disabled={loading}>
            {t("cancel")}
          </KioskButton>
        </div>
      </form>
    </div>
  );
}
