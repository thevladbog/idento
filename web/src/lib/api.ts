/**
 * Axios instance for the Idento backend API.
 * - Base URL from window.__ENV__.API_URL (runtime, set by the Docker image's
 *   nginx templating at container start) → VITE_API_URL (build-time, local
 *   dev override) → http://localhost:8008 (default).
 * - Request interceptor adds Bearer token from localStorage.
 * - Response interceptor clears auth and redirects to the base-aware
 *   login page on 401.
 */
import axios from 'axios';
import { toast } from 'sonner';
import i18n from 'i18next';

/**
 * Resolves the backend's base URL: runtime-injected window.__ENV__.API_URL
 * (Docker/production) → build-time Vite env var (local dev override) →
 * hardcoded localhost default. The single source of truth for this
 * precedence — fonts.ts and impersonationSummary.ts both need it too,
 * since they can't route through this file's axios instance directly.
 */
export function getApiBaseUrl(): string {
  return window.__ENV__?.API_URL || import.meta.env.VITE_API_URL || 'http://localhost:8008';
}

const api = axios.create({
  baseURL: getApiBaseUrl(),
});

// Request interceptor: Add token to all requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor: Handle 401 errors (invalid/expired token)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Suspended/blocked organization: one persistent, deduplicated banner.
    if (error.response?.status === 403 && error.response?.data?.code === 'tenant_suspended') {
      toast.error(i18n.t('tenantSuspended'), { id: 'tenant-suspended', duration: Infinity });
    }

    if (error.response?.status === 401) {
      // Token is invalid or expired, clear auth data and redirect to login
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      localStorage.removeItem('tenants');
      localStorage.removeItem('current_tenant');
      localStorage.removeItem('operator_token');
      localStorage.removeItem('impersonation');
      
      // Only redirect if we're not already on an auth page. Both the guard
      // and the destination are built from Vite's base (/super-admin/ in
      // this app -- same base-awareness lesson as PR #94's asset URLs): a
      // raw '/login' escapes the SPA in dev (Vite refuses paths outside
      // the base) and lands on the TENANT PANEL's login in the combined
      // production image, and a base-less guard never matches this app's
      // pathnames, so it protected nothing.
      const base = import.meta.env.BASE_URL;
      const onAuthPage = ['login', 'register', 'qr-login'].some((page) =>
        window.location.pathname.startsWith(base + page)
      );
      if (!onAuthPage) {
        window.location.href = base + 'login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;

