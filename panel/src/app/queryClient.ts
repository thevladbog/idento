import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { handleApiError } from "../shared/api/handleApiError";

// handleApiError lives in shared/api/ (PR #81 bot round Finding C3) so
// useMonitorStream.ts -- a features/ module that must not import from
// app/ -- can route its own SSE connection failures through the exact
// same tenant-suspension/dead-session handling this QueryClient wires up
// below for every ordinary query/mutation failure.
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
