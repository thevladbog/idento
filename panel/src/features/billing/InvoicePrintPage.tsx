import { Button, Skeleton } from "@idento/ui";
import { getRouteApi } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useBillingInvoice } from "./hooks";
import { includedVat } from "./vat";
import type { components } from "../../shared/api/schema";

type InvoiceLine = components["schemas"]["InvoiceLine"];

// `router.tsx` registers this route ("/billing/invoices/$invoiceId/print")
// directly under `rootRoute`, a SIBLING of `protectedLayoutRoute` — not
// nested inside it — so it never mounts `ProtectedLayout`/`AppShell`'s
// NavDrawer chrome (see router.tsx's own comment on that registration for
// why). `getRouteApi` with the route's string id, not an import of the
// route object itself, avoids a circular import with app/router.tsx —
// same rationale as StationPage.tsx / MonitorPage.tsx's own top-level
// sibling routes.
const routeApi = getRouteApi("/billing/invoices/$invoiceId/print");

// Print-only formatter: an RF счёт always shows kopecks (2 decimal places),
// which also keeps figures consistent with total_in_words (always emits
// kopecks, e.g. "...рублей 00 копеек"). Mirrors web's InvoicePrint.tsx
// formatRub exactly — the two print views must render identical documents.
function formatRub(value: number): string {
  return `${value.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`;
}

// Document text is always Russian (Task 13 brief) regardless of the
// panel's active UI language — a счёт issued to a Russian legal entity
// keeps the same wording no matter which locale the operator's browser is
// set to. `t()` is still used for the one interactive control outside the
// document itself (the «Печать» button), which DOES follow the brief's
// i18n key (`billingPrint`) like any other UI chrome.
export function InvoicePrintPage() {
  const { t } = useTranslation();
  const { invoiceId } = routeApi.useParams();
  const invoiceQuery = useBillingInvoice(invoiceId);

  if (invoiceQuery.isLoading) {
    return (
      <div className="min-h-screen bg-white p-8">
        <Skeleton className="h-96 w-full max-w-[800px]" />
      </div>
    );
  }

  if (!invoiceQuery.data) {
    return <div className="min-h-screen bg-white p-8 text-black">{t("settingsLoadError")}</div>;
  }

  const invoice = invoiceQuery.data;
  const lines: InvoiceLine[] = invoice.lines ?? [];
  const dateStr = new Date(invoice.issued_at).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const vatLines = lines.filter((line) => line.vat_rate !== null);
  const noVatLines = lines.filter((line) => line.vat_rate === null);
  const vatTotal = vatLines.reduce((sum, line) => sum + includedVat(line.amount, line.vat_rate as number), 0);
  const noVatTotal = noVatLines.reduce((sum, line) => sum + line.amount, 0);
  const hasVat = vatLines.length > 0;
  // Mixed invoice: some lines carry VAT, some don't. Mirrors web's
  // InvoicePrint.tsx isMixedVat exactly — see that file's comment for the
  // rationale (pure cases unchanged; mixed gets a second totals row).
  const isMixedVat = hasVat && noVatLines.length > 0;

  return (
    <div className="min-h-screen bg-white">
      <div className="print:hidden fixed right-4 top-4">
        <Button onClick={() => window.print()}>{t("billingPrint")}</Button>
      </div>

      <div className="mx-auto max-w-[800px] bg-white p-8 text-black">
        {/* Bank requisites header */}
        <div className="mb-4 grid grid-cols-2 gap-4 border border-black p-2 text-xs">
          <div className="space-y-0.5">
            <div>Банк получателя: {invoice.seller_bank_name}</div>
            <div>БИК: {invoice.seller_bank_bik}</div>
            <div>к/с: {invoice.seller_bank_corr_account || "—"}</div>
          </div>
          <div className="space-y-0.5">
            <div>ИНН: {invoice.seller_inn}</div>
            <div className="font-semibold">Получатель: {invoice.seller_name}</div>
            <div>р/с: {invoice.seller_bank_account}</div>
          </div>
        </div>

        <h1 className="my-6 text-center text-xl font-bold">
          Счёт на оплату № {invoice.number} от {dateStr}
        </h1>

        <div className="mb-4 text-sm">
          <div>
            <span className="font-semibold">Поставщик (Исполнитель):</span> {invoice.seller_name}, ИНН{" "}
            {invoice.seller_inn}
          </div>
          <div className="mt-1">
            <span className="font-semibold">Покупатель (Заказчик):</span> {invoice.buyer_name}, ИНН{" "}
            {invoice.buyer_inn}
            {invoice.buyer_kpp ? ` / КПП ${invoice.buyer_kpp}` : ""}, {invoice.buyer_address}
          </div>
        </div>

        <table className="mb-4 w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="border border-black p-1 text-left">№</th>
              <th className="border border-black p-1 text-left">Наименование</th>
              <th className="border border-black p-1 text-right">Кол-во</th>
              <th className="border border-black p-1 text-right">Цена</th>
              <th className="border border-black p-1 text-right">Сумма</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.id}>
                <td className="border border-black p-1">{line.position}</td>
                <td className="border border-black p-1">{line.name}</td>
                <td className="border border-black p-1 text-right">{line.quantity}</td>
                <td className="border border-black p-1 text-right">{formatRub(line.price)}</td>
                <td className="border border-black p-1 text-right">{formatRub(line.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mb-4 space-y-1 text-right text-sm">
          <div>Итого: {formatRub(invoice.total)}</div>
          <div>{hasVat ? `В том числе НДС: ${formatRub(vatTotal)}` : "Без НДС"}</div>
          {isMixedVat && <div>Без НДС: {formatRub(noVatTotal)}</div>}
          <div className="font-semibold">Всего к оплате: {formatRub(invoice.total)}</div>
        </div>

        <div className="mb-2 text-sm">
          Всего наименований {lines.length}, на сумму {formatRub(invoice.total)}
        </div>
        <div className="mb-8 text-sm font-bold">{invoice.total_in_words}</div>

        {/* Fixed neutral, not the theme's `text-muted-foreground`: this sheet
        pins `text-black bg-white` regardless of the active theme (it's a
        printable document, not themed UI chrome). `text-muted-foreground`
        resolves to a light color in dark mode, which would be invisible on
        this always-white sheet. Mirrors web's InvoicePrint.tsx exactly. */}
        <div className="mb-12 text-xs text-neutral-600">
          Оплата данного счёта означает согласие с условиями поставки услуг.
        </div>

        <div className="text-sm">Руководитель _____________</div>
      </div>
    </div>
  );
}
