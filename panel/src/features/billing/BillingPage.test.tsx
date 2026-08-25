import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterContextProvider, createRootRoute, createRouter } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { Toaster } from "sonner";
import { BillingPage } from "./BillingPage";
import { startMswServer } from "../../test/msw";
import "../../shared/i18n";
import type { components } from "../../shared/api/schema";

type BillingProfile = components["schemas"]["BillingProfile"];
type BillingCatalogItem = components["schemas"]["BillingCatalogItem"];
type Invoice = components["schemas"]["Invoice"];

const PROFILE: BillingProfile = {
  tenant_id: "t1",
  legal_name: "ООО Ромашка",
  inn: "7701234567",
  kpp: "770101001",
  legal_address: "г. Москва, ул. Ленина, д. 1",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

const CATALOG: BillingCatalogItem[] = [
  {
    id: "cat-1",
    kind: "plan",
    name: "Тариф Pro",
    description: "Расширенный тариф",
    price: 5000,
    vat_rate: 20,
    is_public: true,
    is_active: true,
    sort_order: 1,
    plan_id: "plan-1",
    period: "month",
    default_activation: "on_payment",
    limit_key: null,
    limit_delta: null,
    validity: null,
    validity_days: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "cat-2",
    kind: "service",
    name: "Настройка бейджей",
    description: "Разовая услуга настройки",
    price: 1500,
    vat_rate: null,
    is_public: true,
    is_active: true,
    sort_order: 2,
    plan_id: null,
    period: null,
    default_activation: null,
    limit_key: null,
    limit_delta: null,
    validity: null,
    validity_days: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  },
];

const INVOICES: Invoice[] = [
  {
    id: "inv-1",
    number: "INV-0001",
    tenant_id: "t1",
    status: "issued",
    issued_at: "2026-01-05T00:00:00.000Z",
    paid_at: null,
    cancelled_at: null,
    buyer_name: PROFILE.legal_name,
    buyer_inn: PROFILE.inn,
    buyer_kpp: PROFILE.kpp,
    buyer_address: PROFILE.legal_address,
    seller_name: "ООО Идento",
    seller_inn: "9999999999",
    seller_bank_name: "Банк",
    seller_bank_account: "40702810000000000001",
    seller_bank_bik: "044525225",
    seller_bank_corr_account: "30101810000000000000",
    total: 5000,
    comment: null,
    created_by: null,
    created_at: "2026-01-05T00:00:00.000Z",
    updated_at: "2026-01-05T00:00:00.000Z",
  },
  {
    id: "inv-2",
    number: "INV-0002",
    tenant_id: "t1",
    status: "paid",
    issued_at: "2026-01-06T00:00:00.000Z",
    paid_at: "2026-01-07T00:00:00.000Z",
    cancelled_at: null,
    buyer_name: PROFILE.legal_name,
    buyer_inn: PROFILE.inn,
    buyer_kpp: PROFILE.kpp,
    buyer_address: PROFILE.legal_address,
    seller_name: "ООО Идento",
    seller_inn: "9999999999",
    seller_bank_name: "Банк",
    seller_bank_account: "40702810000000000001",
    seller_bank_bik: "044525225",
    seller_bank_corr_account: "30101810000000000000",
    total: 1500,
    comment: null,
    created_by: null,
    created_at: "2026-01-06T00:00:00.000Z",
    updated_at: "2026-01-07T00:00:00.000Z",
  },
];

let profileStatus: "found" | "not-found" = "found";
let lastRequestBody: unknown;
let requestStatusOverride: number | null = null;
let createdInvoiceNumber = "INV-0003";

const server = startMswServer(
  http.get("http://api.test/api/billing/profile", () =>
    profileStatus === "found"
      ? HttpResponse.json(PROFILE)
      : HttpResponse.json({ error: "not found" }, { status: 404 }),
  ),
  http.put("http://api.test/api/billing/profile", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json({
      tenant_id: "t1",
      legal_name: body.legal_name,
      inn: body.inn,
      kpp: body.kpp ?? null,
      legal_address: body.legal_address,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z",
    });
  }),
  http.get("http://api.test/api/billing/catalog", () => HttpResponse.json(CATALOG)),
  http.get("http://api.test/api/billing/invoices", () => HttpResponse.json(INVOICES)),
  http.post("http://api.test/api/billing/invoices", async ({ request }) => {
    lastRequestBody = await request.json();
    if (requestStatusOverride) {
      return HttpResponse.json({ error: "Seller requisites are not configured" }, { status: requestStatusOverride });
    }
    return HttpResponse.json(
      {
        ...INVOICES[0],
        id: "inv-3",
        number: createdInvoiceNumber,
        total_in_words: "Пять тысяч рублей 00 копеек",
      },
      { status: 201 },
    );
  }),
);
void server;

// jsdom has no IntersectionObserver (see useScrollSpy.test.ts) and panel's
// global test/setup.ts intentionally doesn't stub one — BillingPage mounts
// the real useScrollSpy hook (same as EventSettingsPage.test.tsx), so
// without a stub its rAF-retry loop throws once the section elements exist.
// A minimal no-op stub is enough: these tests don't exercise scroll-spy
// activation itself.
class NoopIntersectionObserver {
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
}

// BillingInvoicesCard renders a `Link` to the print route, which needs a
// router context to resolve — same minimal single-route harness
// EventRow.test.tsx / LiveStrip.test.tsx use.
const testRouter = createRouter({ routeTree: createRootRoute({ component: () => null }) });

function renderWithProviders(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        {/* Same rationale as App.tsx: BillingCatalogCard fires
            `toast.success` (sonner) on a successful invoice request, which
            needs a mounted `<Toaster/>` to render anything into the DOM —
            App.test.tsx's own toast assertion mounts it the same way. */}
        <Toaster />
        <RouterContextProvider router={testRouter}>{ui}</RouterContextProvider>
      </QueryClientProvider>,
    ),
  };
}

describe("BillingPage", () => {
  beforeEach(() => {
    profileStatus = "found";
    lastRequestBody = undefined;
    requestStatusOverride = null;
    createdInvoiceNumber = "INV-0003";
    window.__ENV__ = { API_URL: "http://api.test" };
    localStorage.setItem("token", "jwt-test");
    vi.stubGlobal("IntersectionObserver", NoopIntersectionObserver);
  });

  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("renders an empty profile form when the profile 404s", async () => {
    profileStatus = "not-found";
    renderWithProviders(<BillingPage />);

    expect(await screen.findByLabelText("Legal name")).toHaveValue("");
    expect(screen.getByLabelText("Tax ID (INN)")).toHaveValue("");
    expect(screen.getByLabelText("Tax registration reason code (KPP)")).toHaveValue("");
    expect(screen.getByLabelText("Legal address")).toHaveValue("");
    expect(screen.queryByText("Couldn't save your changes. Please try again.")).not.toBeInTheDocument();
  });

  it("shows the localized INN-invalid error and does not save when the INN is malformed", async () => {
    profileStatus = "not-found";
    const user = userEvent.setup();
    renderWithProviders(<BillingPage />);

    await screen.findByLabelText("Legal name");
    await user.type(screen.getByLabelText("Legal name"), "ИП Иванов");
    await user.type(screen.getByLabelText("Tax ID (INN)"), "123");
    await user.type(screen.getByLabelText("Legal address"), "г. Казань, ул. Баумана, д. 5");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("INN must be 10 or 12 digits")).toBeInTheDocument();
  });

  it("loads the saved profile's values into the form", async () => {
    renderWithProviders(<BillingPage />);

    expect(await screen.findByLabelText("Legal name")).toHaveValue("ООО Ромашка");
    expect(screen.getByLabelText("Tax ID (INN)")).toHaveValue("7701234567");
    expect(screen.getByLabelText("Tax registration reason code (KPP)")).toHaveValue("770101001");
    expect(screen.getByLabelText("Legal address")).toHaveValue("г. Москва, ул. Ленина, д. 1");
  });

  it("enables the request-invoice button once a quantity is stepped up, and posts the line", async () => {
    const user = userEvent.setup();
    renderWithProviders(<BillingPage />);

    await screen.findByText("Тариф Pro");
    const requestButton = screen.getByRole("button", { name: "Request invoice" });
    expect(requestButton).toBeDisabled();

    // Step the first catalog item's ("Тариф Pro", cat-1) quantity via its
    // NumberInput + stepper — array order in the response is preserved in
    // the DOM, so the first "+" button belongs to the first row.
    const incrementButtons = screen.getAllByRole("button", { name: "+" });
    await user.click(incrementButtons[0]);

    expect(requestButton).toBeEnabled();
    await user.click(requestButton);

    await waitFor(() =>
      expect(lastRequestBody).toEqual({ lines: [{ catalog_item_id: "cat-1", quantity: 1 }] }),
    );
    expect(await screen.findByText(`Invoice ${createdInvoiceNumber} issued`)).toBeInTheDocument();
  });

  it("disables the request button with a hint when there is no billing profile yet", async () => {
    profileStatus = "not-found";
    renderWithProviders(<BillingPage />);

    await screen.findByText("Тариф Pro");
    const incrementButtons = screen.getAllByRole("button", { name: "+" });
    const user = userEvent.setup();
    await user.click(incrementButtons[0]);

    expect(screen.getByRole("button", { name: "Request invoice" })).toBeDisabled();
    expect(screen.getByText("Fill in your organization's requisites first")).toBeInTheDocument();
  });

  it("surfaces the server's 409 message when the invoice request is rejected", async () => {
    requestStatusOverride = 409;
    const user = userEvent.setup();
    renderWithProviders(<BillingPage />);

    await screen.findByText("Тариф Pro");
    const incrementButtons = screen.getAllByRole("button", { name: "+" });
    await user.click(incrementButtons[0]);
    await user.click(screen.getByRole("button", { name: "Request invoice" }));

    expect(await screen.findByText("Seller requisites are not configured")).toBeInTheDocument();
  });

  it("renders the invoices list with localized status labels", async () => {
    renderWithProviders(<BillingPage />);

    expect(await screen.findByText("INV-0001")).toBeInTheDocument();
    expect(screen.getByText("Issued")).toBeInTheDocument();
    expect(screen.getByText("INV-0002")).toBeInTheDocument();
    expect(screen.getByText("Paid")).toBeInTheDocument();
  });
});
