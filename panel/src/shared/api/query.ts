import createClient from "openapi-react-query";
import { api } from "./http";

// Typed TanStack Query bindings over the shared openapi-fetch client.
// Query keys are [method, path, params] — invalidate with the same shape,
// e.g. queryClient.invalidateQueries({ queryKey: ["get", "/api/events"] }).
export const $api = createClient(api);
