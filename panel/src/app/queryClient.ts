import { MutationCache, QueryCache, QueryClient, type Mutation } from "@tanstack/react-query";
import { ApiError } from "../shared/api/ApiError";
import { clearSession } from "../shared/api/session";
import { tenantStatusStore } from "../shared/tenant-status/tenantStatusStore";

// Login/register/QR-login legitimately reject with 401 on wrong
// credentials — that's the screen's own inline error (see LoginScreen.tsx
// etc.), not a dead session. Skip the global 401 handler for exactly
// these, identified by mutationKey.
const AUTH_MUTATION_KEYS = new Set(["login", "register", "loginWithQr"]);

function isAuthMutation(mutation?: Mutation<unknown, unknown, unknown, unknown>): boolean {
  const key = mutation?.options.mutationKey?.[0];
  return typeof key === "string" && AUTH_MUTATION_KEYS.has(key);
}

function handleApiError(error: unknown, mutation?: Mutation<unknown, unknown, unknown, unknown>) {
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

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => handleApiError(error),
  }),
  mutationCache: new MutationCache({
    // TanStack Query v5's MutationCache onError signature is
    // (error, variables, onMutateResult, mutation, context) — mutation is
    // the 4th argument, not the 3rd (verified against the installed
    // @tanstack/query-core 5.101.2 types).
    onError: (error, _variables, _onMutateResult, mutation) => handleApiError(error, mutation),
  }),
});
