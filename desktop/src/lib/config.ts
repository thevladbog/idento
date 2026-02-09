const BACKEND_URL_KEY = "idento_backend_url";
const DEFAULT_BACKEND_URL = "http://localhost:8008";

export function getBackendUrl(): string {
  try {
    const url = localStorage.getItem(BACKEND_URL_KEY);
    return url && url.trim() ? url.trim() : DEFAULT_BACKEND_URL;
  } catch {
    return DEFAULT_BACKEND_URL;
  }
}

export function setBackendUrl(url: string): void {
  localStorage.setItem(BACKEND_URL_KEY, url.trim());
}
