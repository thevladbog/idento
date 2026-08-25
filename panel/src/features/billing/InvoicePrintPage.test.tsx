import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { InvoicePrintPage } from "./InvoicePrintPage";
import { startMswServer } from "../../test/msw";
import "../../shared/i18n";
import type { components } from "../../shared/api/schema";

type Invoice = components["schemas"]["Invoice"];

const INVOICE_NO_VAT: Invoice = {
  id: "inv-1",
  number: "INV-0007",
  tenant_id: "t1",
  status: "issued",
  issued_at: "2026-01-05T00:00:00.000Z",
  paid_at: null,
  cancelled_at: null,
  buyer_name: "ООО Ромашка",
  buyer_inn: "7701234567",
  buyer_kpp: "770101001",
  buyer_address: "г. Москва, ул. Ленина, д. 1",
  seller_name: "ООО Идento",
  seller_inn: "9999999999",
  seller_bank_name: "Банк",
  seller_bank_account: "40702810000000000001",
  seller_bank_bik: "044525225",
  seller_bank_corr_account: "30101810000000000000",
  total: 1500,
  comment: null,
  created_by: null,
  created_at: "2026-01-05T00:00:00.000Z",
  updated_at: "2026-01-05T00:00:00.000Z",
  lines: [
    {
      id: "line-1",
      invoice_id: "inv-1",
      position: 1,
      catalog_item_id: "cat-2",
      kind: "service",
      name: "Настройка бейджей",
      price: 1500,
      vat_rate: null,
      plan_id: null,
      period: null,
      activation: null,
      limit_key: null,
      limit_delta: null,
      validity: null,
      validity_days: null,
      quantity: 1,
      amount: 1500,
    },
  ],
  total_in_words: "Одна тысяча пятьсот рублей 00 копеек",
};

let invoiceOverride: Invoice = INVOICE_NO_VAT;

const server = startMswServer(
  http.get("http://api.test/api/billing/invoices/:id", () => HttpResponse.json(invoiceOverride)),
);
void server;

function renderAt(invoiceId: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute();
  const printRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/billing/invoices/$invoiceId/print",
    component: InvoicePrintPage,
  });
  const routeTree = rootRoute.addChildren([printRoute]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [`/billing/invoices/${invoiceId}/print`] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      {/* Cast, not @ts-expect-error: this test router's route shape differs
          from the app's registered singleton -- same rationale as
          StationPage.test.tsx's own routed harness. */}
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
}

describe("InvoicePrintPage", () => {
  beforeEach(() => {
    invoiceOverride = INVOICE_NO_VAT;
    window.__ENV__ = { API_URL: "http://api.test" };
    localStorage.setItem("token", "jwt-test");
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("renders the invoice number, the no-VAT totals branch, and the amount in words", async () => {
    renderAt("inv-1");

    expect(await screen.findByText(/Счёт на оплату № INV-0007/)).toBeInTheDocument();
    expect(screen.getByText("Без НДС")).toBeInTheDocument();
    expect(screen.getByText("Одна тысяча пятьсот рублей 00 копеек")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Print" })).toBeInTheDocument();
  });
});
