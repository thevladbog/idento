import type { components } from "./schema";

// `User`/`Tenant` are narrowed (via Pick) to the fields every existing
// consumer in this codebase actually reads/constructs, rather than aliased
// 1:1 to the full generated components. The full generated `User` also
// requires `is_super_admin`/`has_qr_token` and the full generated `Tenant`
// also requires `status` (plus other optional admin-console fields) — none
// of which any current panel code sets or reads (verified: no references to
// those fields anywhere under panel/src). Aliasing 1:1 would force every
// hand-written `User`/`Tenant` object literal across the app (tests,
// session fixtures, etc.) to grow those fields for no behavioral reason.
// Field *types* here are still sourced from the generated schema, so a
// backend change to e.g. the `role` enum or id format is still caught.
export type User = Pick<
  components["schemas"]["User"],
  "id" | "tenant_id" | "email" | "role" | "created_at" | "updated_at"
>;
export type Tenant = Pick<components["schemas"]["Tenant"], "id" | "name">;

// AuthResponse mirrors LoginResponse's shape, but `current_tenant` is kept
// optional rather than aliased as-is (the generated LoginResponse requires
// it). session.ts's saveSession() already treats current_tenant as optional
// (`auth.current_tenant ?? auth.tenants[0]`), and QrLoginScreen constructs
// an AuthResponse-shaped object with `current_tenant: undefined` after a
// QR login (which has no tenant list at all). register() also returns this
// type: the generated RegisterResponse component has no current_tenant
// field, and structurally satisfies AuthResponse as-is because the field is
// optional here — no cast needed.
export interface AuthResponse {
  token: string;
  user: User;
  tenants: Tenant[];
  current_tenant?: Tenant;
}

export type QrLoginResponse = Pick<components["schemas"]["QrLoginResponse"], "token"> & {
  user: User;
};
export type InstanceInfo = components["schemas"]["InstanceInfo"];
export type SwitchTenantResponse = Pick<components["schemas"]["SwitchTenantResponse"], "token"> & {
  current_tenant: Tenant;
};
