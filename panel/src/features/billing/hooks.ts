import { useQueryClient } from "@tanstack/react-query";
import { $api } from "../../shared/api/query";

// Query-key for GET /api/billing/invoices, matching useBillingInvoices's
// no-init call shape (openapi-react-query's queryKey is [method, path] when
// init is omitted — see query.ts's own doc comment on the [method, path,
// init] shape). Used by useRequestInvoice's onSuccess to refresh the
// invoices list after a new one is issued.
export const BILLING_INVOICES_KEY = ["get", "/api/billing/invoices"] as const;

// Query-key PREFIX for GET /api/billing/profile. useBillingProfile calls
// with an explicit `{}` init (required to pass `{ retry: false }` as the
// options arg), so the actual cached key is ["get", "/api/billing/profile",
// {}] — but TanStack Query's invalidateQueries does a fuzzy/prefix match by
// default, so invalidating with this shorter key still matches it (same
// technique OrganizationPage.tsx doesn't need, since its tenant key already
// carries path params it must match exactly).
export const BILLING_PROFILE_KEY = ["get", "/api/billing/profile"] as const;

export function useBillingProfile() {
  // retry: false — a 404 here means "no profile saved yet", a normal,
  // expected state (BillingPage renders an empty form for it), not a
  // transient failure worth react-query's default retry backoff.
  return $api.useQuery("get", "/api/billing/profile", {}, { retry: false });
}

export function useSaveBillingProfile() {
  const queryClient = useQueryClient();
  return $api.useMutation("put", "/api/billing/profile", {
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: BILLING_PROFILE_KEY });
    },
  });
}

export function useBillingCatalog() {
  return $api.useQuery("get", "/api/billing/catalog");
}

export function useBillingInvoices() {
  return $api.useQuery("get", "/api/billing/invoices");
}

export function useRequestInvoice() {
  const queryClient = useQueryClient();
  return $api.useMutation("post", "/api/billing/invoices", {
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: BILLING_INVOICES_KEY });
    },
  });
}

export function useBillingInvoice(id: string) {
  return $api.useQuery("get", "/api/billing/invoices/{id}", { params: { path: { id } } });
}
