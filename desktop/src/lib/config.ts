const BACKEND_URL_KEY = "idento_backend_url";
const DEFAULT_BACKEND_URL = "http://localhost:8008";

export function getBackendUrl(): string {
  try {
    const url = localStorage.getItem(BACKEND_URL_KEY);
    const base = url && url.trim() ? url.trim() : DEFAULT_BACKEND_URL;
    return base.replace(/\/$/, "");
  } catch {
    return DEFAULT_BACKEND_URL;
  }
}

export function setBackendUrl(url: string): void {
  try {
    const normalized = url.trim().replace(/\/$/, "");
    localStorage.setItem(BACKEND_URL_KEY, normalized);
  } catch {
    // ignore (storage unavailable, QuotaExceededError, etc.); matches getBackendUrl behavior
  }
}
