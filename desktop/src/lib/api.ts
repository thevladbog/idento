import axios from "axios";
import { toast } from "sonner";
import i18n from "../i18n";
import { getBackendUrl } from "./config";

const SESSION_KEYS = ["token", "user", "tenants", "current_tenant"] as const;

export function clearSession(): void {
  SESSION_KEYS.forEach((key) => {
    localStorage.removeItem(key);
  });
}

function createApi() {
  const api = axios.create({
    baseURL: getBackendUrl(),
  });

  api.interceptors.request.use((config) => {
    config.baseURL = getBackendUrl();
    const token = localStorage.getItem("token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  });

  api.interceptors.response.use(
    (response) => response,
    (error) => {
      // Suspended/blocked organization: one persistent, deduplicated banner.
      if (error.response?.status === 403 && error.response?.data?.code === "tenant_suspended") {
        toast.error(i18n.t("tenantSuspended"), { id: "tenant-suspended", duration: Infinity });
      }

      // A 401 from a credential-submission endpoint itself (/auth/login,
      // /auth/login-qr) means "the credentials you just typed are wrong",
      // not "your existing session died" -- it must never clear the
      // caller's current session or navigate away. The page-path exclusion
      // below (for /login, /qr-login) already handled this for those two
      // pages, but StaffExitOverlay (K2b) calls /auth/login-qr from
      // /checkin/:eventId/self, which isn't in that list -- without this
      // request-URL check, a mistyped staff-exit QR token would wipe the
      // kiosk's valid station session and hard-redirect away from lockdown.
      const isCredentialSubmission = (error.config?.url ?? "").includes("/auth/login");
      if (error.response?.status === 401 && !isCredentialSubmission) {
        clearSession();
        const path = window.location.pathname + window.location.search;
        if (!path.startsWith("/login") && !path.startsWith("/qr-login")) {
          window.location.href = `/login?returnUrl=${encodeURIComponent(path)}`;
        }
      }
      return Promise.reject(error);
    }
  );

  return api;
}

export const api = createApi();
