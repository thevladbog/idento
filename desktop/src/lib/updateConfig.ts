// Persists the operator's optional override for the update-manifest URL
// (Equipment/Mode's "closed network / mirror" setting). Empty means "use
// the app's compiled-in default (tauri.conf.json's plugins.updater
// endpoints)". Mirrors config.ts's getBackendUrl/setBackendUrl pattern.
const MANIFEST_URL_KEY = "idento_update_manifest_url";

export function getManifestUrlOverride(): string {
  try {
    return localStorage.getItem(MANIFEST_URL_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function setManifestUrlOverride(url: string): void {
  try {
    localStorage.setItem(MANIFEST_URL_KEY, url.trim());
  } catch {
    // ignore (storage unavailable, QuotaExceededError, etc.)
  }
}
