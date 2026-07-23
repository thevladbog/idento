// Reads the tenant logo cached by Login.tsx's /auth/login response
// (current_tenant, the full backend Tenant object, includes logo_url).
// Deliberately does NOT hit the network -- self-service's AttractScreen
// must never block on a request just to show its brand slot. QRLogin.tsx's
// /auth/login-qr response does not include current_tenant at all (a
// pre-existing, K2b-unrelated backend inconsistency) -- a station set up
// via QR login simply has no cached logo here, handled by the caller
// (AttractScreen) falling back to BrandSlot's own empty-state rendering,
// not by this function throwing or guessing.
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getTenantLogoUrl(): string | undefined {
  try {
    const raw = localStorage.getItem("current_tenant");
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainObject(parsed)) return undefined;
    return typeof parsed.logo_url === "string" ? parsed.logo_url : undefined;
  } catch {
    return undefined;
  }
}
