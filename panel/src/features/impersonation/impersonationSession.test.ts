import { endImpersonation, getImpersonation } from "./impersonationSession";

const FUTURE = new Date(Date.now() + 20 * 60_000).toISOString();
const PAST = new Date(Date.now() - 5 * 60_000).toISOString();

describe("impersonationSession", () => {
  beforeEach(() => localStorage.clear());

  it("returns null when there is no stored session", () => {
    expect(getImpersonation()).toBeNull();
  });

  it("reads a valid, unexpired session", () => {
    localStorage.setItem(
      "impersonation",
      JSON.stringify({ tenantId: "t1", tenantName: "Acme", expiresAt: FUTURE, mintedAt: new Date().toISOString() }),
    );
    expect(getImpersonation()).toMatchObject({ tenantId: "t1", tenantName: "Acme" });
  });

  it("self-cleans and returns null once expired", () => {
    localStorage.setItem(
      "impersonation",
      JSON.stringify({ tenantId: "t1", tenantName: "Acme", expiresAt: PAST, mintedAt: PAST }),
    );
    expect(getImpersonation()).toBeNull();
    expect(localStorage.getItem("impersonation")).toBeNull();
  });

  it("endImpersonation restores the parked operator token and clears the session key", () => {
    localStorage.setItem("operator_token", "operator-tok");
    localStorage.setItem("token", "impersonation-tok");
    localStorage.setItem(
      "impersonation",
      JSON.stringify({ tenantId: "t1", tenantName: "Acme", expiresAt: FUTURE, mintedAt: new Date().toISOString() }),
    );
    endImpersonation();
    expect(localStorage.getItem("token")).toBe("operator-tok");
    expect(localStorage.getItem("operator_token")).toBeNull();
    expect(localStorage.getItem("impersonation")).toBeNull();
  });
});
