import axios from "axios";
import { getBackendUrl } from "./config";

const SESSION_KEYS = ["token", "user", "tenants", "current_tenant"] as const;

export function clearSession(): void {
  SESSION_KEYS.forEach((key) => localStorage.removeItem(key));
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
      if (error.response?.status === 401) {
        clearSession();
        const path = window.location.pathname + window.location.search;
        if (!path.startsWith("/login") && !path.startsWith("/qr-login")) {
          const returnUrl = encodeURIComponent(path);
          window.location.href = returnUrl ? `/login?returnUrl=${returnUrl}` : "/login";
        }
      }
      return Promise.reject(error);
    }
  );

  return api;
}

export const api = createApi();
