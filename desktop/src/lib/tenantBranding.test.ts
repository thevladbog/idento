import { afterEach, describe, expect, it } from "vitest";
import { getTenantLogoUrl } from "./tenantBranding";

afterEach(() => {
  localStorage.clear();
});

describe("getTenantLogoUrl", () => {
  it("returns undefined when no current_tenant is cached", () => {
    expect(getTenantLogoUrl()).toBeUndefined();
  });

  it("returns undefined when current_tenant has no logo_url", () => {
    localStorage.setItem("current_tenant", JSON.stringify({ id: "t1", name: "Acme" }));
    expect(getTenantLogoUrl()).toBeUndefined();
  });

  it("returns undefined when current_tenant is malformed JSON", () => {
    localStorage.setItem("current_tenant", "{not json");
    expect(getTenantLogoUrl()).toBeUndefined();
  });

  it("returns the logo_url when present", () => {
    localStorage.setItem("current_tenant", JSON.stringify({ id: "t1", name: "Acme", logo_url: "https://cdn.example/acme.png" }));
    expect(getTenantLogoUrl()).toBe("https://cdn.example/acme.png");
  });
});
