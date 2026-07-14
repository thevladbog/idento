import { QueryCache, QueryClient } from "@tanstack/react-query";
import { ApiError } from "../shared/api/ApiError";
import { tenantStatusStore } from "../shared/tenant-status/tenantStatusStore";

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      if (error instanceof ApiError && error.code === "tenant_suspended") {
        tenantStatusStore.setSuspended(true);
      }
    },
  }),
});
