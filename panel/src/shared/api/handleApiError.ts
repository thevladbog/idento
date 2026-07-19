import type { Mutation } from "@tanstack/react-query";
import { ApiError } from "./ApiError";
import { clearSession } from "./session";
import { tenantStatusStore } from "../tenant-status/tenantStatusStore";

// Extracted from app/queryClient.ts (PR #81 bot round Finding C3) into
// shared/api/ so useMonitorStream.ts's raw-`fetch` SSE client -- a
// features/ module that must not import from app/ (panel/AGENTS.md's
// feature-sliced layering; app/ assembles features/, not the reverse,
// avoiding an import cycle since app/router.tsx pulls in feature route
// components) -- can route ITS non-OK stream responses through the exact
// same global handling (tenant suspension, dead-session redirect) every
// other API failure gets via the `api` client's query/mutation caches,
// instead of a second, drifting copy of this logic.

// Login/register/QR-login legitimately reject with 401 on wrong
// credentials — that's the screen's own inline error (see LoginScreen.tsx
// etc.), not a dead session. Skip the global 401 handler for exactly
// these, identified by mutationKey.
const AUTH_MUTATION_KEYS = new Set(["login", "register", "loginWithQr"]);

function isAuthMutation(mutation?: Mutation<unknown, unknown, unknown, unknown>): boolean {
  const key = mutation?.options.mutationKey?.[0];
  return typeof key === "string" && AUTH_MUTATION_KEYS.has(key);
}

/**
 * Routes an `ApiError` through the app's global failure handling:
 * `tenant_suspended` flips the suspension takeover on; a bare 401 (outside
 * the auth screens' own login/register/QR-login mutations, which handle
 * their own 401s inline) clears the session and redirects to /login.
 * Non-`ApiError` failures and every other status are no-ops here — callers
 * (queryClient.ts's query/mutation caches, useMonitorStream.ts's SSE
 * client) keep their own retry/rethrow behavior for those.
 */
export function handleApiError(error: unknown, mutation?: Mutation<unknown, unknown, unknown, unknown>): void {
  if (!(error instanceof ApiError)) return;
  if (error.code === "tenant_suspended") {
    tenantStatusStore.setSuspended(true);
    return;
  }
  if (error.status === 401 && !isAuthMutation(mutation)) {
    clearSession();
    if (!window.location.pathname.startsWith("/login")) {
      window.location.assign("/login");
    }
  }
}
