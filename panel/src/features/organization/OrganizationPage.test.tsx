import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { OrganizationPage } from "./OrganizationPage";
import { startMswServer } from "../../test/msw";
import "../../shared/i18n";
import type { components } from "../../shared/api/schema";

type TenantMembership = components["schemas"]["TenantMembership"];

const BASE_TENANT: TenantMembership = {
  id: "t1",
  name: "Acme Events",
  settings: null,
  logo_url: "https://cdn.example.com/logo.png",
  website: "https://acme.example.com",
  contact_email: "ops@acme.example.com",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  role: "admin",
};

let currentTenant: TenantMembership = BASE_TENANT;
let putCount = 0;
let lastPutBody: unknown;
let putStatusOverride: number | null = null;

const server = startMswServer(
  http.get("http://api.test/api/tenants/:id", () => HttpResponse.json(currentTenant)),
  http.put("http://api.test/api/tenants/:id", async ({ request }) => {
    putCount += 1;
    lastPutBody = await request.json();
    if (putStatusOverride) {
      return HttpResponse.json({ error: "forbidden" }, { status: putStatusOverride });
    }
    const body = lastPutBody as Record<string, string>;
    return HttpResponse.json({
      id: currentTenant.id,
      name: body.name ?? currentTenant.name,
      status: "active",
      logo_url: body.logo_url ?? currentTenant.logo_url,
      website: body.website ?? currentTenant.website,
      contact_email: body.contact_email ?? currentTenant.contact_email,
      created_at: currentTenant.created_at,
      updated_at: "2026-01-02T00:00:00.000Z",
    });
  }),
);
void server;

function renderWithProviders(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe("OrganizationPage", () => {
  beforeEach(() => {
    currentTenant = BASE_TENANT;
    putCount = 0;
    lastPutBody = undefined;
    putStatusOverride = null;
    window.__ENV__ = { API_URL: "http://api.test" };
    localStorage.setItem("current_tenant", JSON.stringify({ id: "t1", name: "Acme Events" }));
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("loads the tenant's current values into the fields for an admin", async () => {
    renderWithProviders(<OrganizationPage />);

    expect(await screen.findByLabelText("Organization name")).toHaveValue("Acme Events");
    expect(screen.getByLabelText("Website")).toHaveValue("https://acme.example.com");
    expect(screen.getByLabelText("Contact email")).toHaveValue("ops@acme.example.com");
    expect(screen.getByLabelText("Logo URL")).toHaveValue("https://cdn.example.com/logo.png");
    expect(screen.getByLabelText("Organization name")).toBeEnabled();
  });

  it("PUTs only the changed field and shows the saved caption", async () => {
    const user = userEvent.setup();
    renderWithProviders(<OrganizationPage />);

    await screen.findByLabelText("Organization name");
    await user.clear(screen.getByLabelText("Website"));
    await user.type(screen.getByLabelText("Website"), "https://acme.example.org");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(putCount).toBe(1));
    expect(lastPutBody).toEqual({ website: "https://acme.example.org" });
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("sends an explicit empty string to clear an optional field", async () => {
    const user = userEvent.setup();
    renderWithProviders(<OrganizationPage />);

    await screen.findByLabelText("Organization name");
    await user.clear(screen.getByLabelText("Website"));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(putCount).toBe(1));
    expect(lastPutBody).toEqual({ website: "" });
  });

  it("shows a localized invalid-email error and does not call the API", async () => {
    const user = userEvent.setup();
    renderWithProviders(<OrganizationPage />);

    await screen.findByLabelText("Organization name");
    await user.clear(screen.getByLabelText("Contact email"));
    await user.type(screen.getByLabelText("Contact email"), "not-an-email");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Enter a valid email address.")).toBeInTheDocument();
    expect(putCount).toBe(0);
  });

  it("shows a localized invalid-url error for the logo URL and does not call the API", async () => {
    const user = userEvent.setup();
    renderWithProviders(<OrganizationPage />);

    await screen.findByLabelText("Organization name");
    await user.clear(screen.getByLabelText("Logo URL"));
    await user.type(screen.getByLabelText("Logo URL"), "not-a-url");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Enter a valid URL.")).toBeInTheDocument();
    expect(putCount).toBe(0);
  });

  it("shows a required-name error and does not call the API when the name is cleared", async () => {
    const user = userEvent.setup();
    renderWithProviders(<OrganizationPage />);

    await screen.findByLabelText("Organization name");
    await user.clear(screen.getByLabelText("Organization name"));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Give the organization a name.")).toBeInTheDocument();
    expect(putCount).toBe(0);
  });

  it("disables all inputs and shows a read-only notice for a non-admin, with no save action reachable", async () => {
    currentTenant = { ...BASE_TENANT, role: "member" };
    renderWithProviders(<OrganizationPage />);

    expect(await screen.findByLabelText("Organization name")).toBeDisabled();
    expect(screen.getByLabelText("Website")).toBeDisabled();
    expect(screen.getByLabelText("Contact email")).toBeDisabled();
    expect(screen.getByLabelText("Logo URL")).toBeDisabled();
    expect(screen.getByText("Only organization admins can edit these settings.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("shows a forbidden error if the save is rejected with 403 despite the role guard", async () => {
    putStatusOverride = 403;
    const user = userEvent.setup();
    renderWithProviders(<OrganizationPage />);

    await screen.findByLabelText("Organization name");
    await user.type(screen.getByLabelText("Organization name"), "!");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Only organization admins can save changes.")).toBeInTheDocument();
  });

  it("renders the load-error message and nothing else when getCurrentTenant() returns null", () => {
    localStorage.removeItem("current_tenant");
    renderWithProviders(<OrganizationPage />);

    expect(screen.getByText("Couldn't load your events.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Organization name")).not.toBeInTheDocument();
  });
});
