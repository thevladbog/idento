import {
  Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Input, Label, NumberInput, Skeleton, cn,
} from "@idento/ui";
import { Link } from "@tanstack/react-router";
import { Receipt } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { z } from "zod";
import {
  useBillingCatalog, useBillingInvoices, useBillingProfile, useRequestInvoice, useSaveBillingProfile,
} from "./hooks";
import { ApiError } from "../../shared/api/ApiError";
import type { components } from "../../shared/api/schema";
import { useScrollSpy } from "../../shared/hooks/useScrollSpy";

type BillingProfile = components["schemas"]["BillingProfile"];
type BillingCatalogItem = components["schemas"]["BillingCatalogItem"];
type Invoice = components["schemas"]["Invoice"];

const SECTION_IDS = ["billing-profile", "billing-catalog", "billing-invoices"] as const;

const RAIL_ITEMS: { id: (typeof SECTION_IDS)[number]; labelKey: string }[] = [
  { id: "billing-profile", labelKey: "billingProfileSection" },
  { id: "billing-catalog", labelKey: "billingCatalogSection" },
  { id: "billing-invoices", labelKey: "billingInvoicesSection" },
];

// ---- Profile card --------------------------------------------------------

// inn: 10 digits (organization) or 12 digits (individual entrepreneur), per
// BillingProfile's own schema doc comment. kpp is optional — empty or
// exactly 9 digits — omitted entirely for individual entrepreneurs.
const billingProfileSchema = z
  .object({
    legal_name: z.string().trim().min(1, "billingFieldRequired"),
    inn: z.string().trim(),
    kpp: z.string().trim(),
    legal_address: z.string().trim().min(1, "billingFieldRequired"),
  })
  .superRefine((val, ctx) => {
    if (!/^\d{10}$|^\d{12}$/.test(val.inn)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "billingInnInvalid", path: ["inn"] });
    }
    if (val.kpp !== "" && !/^\d{9}$/.test(val.kpp)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "billingKppInvalid", path: ["kpp"] });
    }
  });

type ProfileFormState = {
  legal_name: string;
  inn: string;
  kpp: string;
  legal_address: string;
};

type ProfileFieldErrors = Partial<Record<keyof ProfileFormState, string>>;

function emptyProfileForm(): ProfileFormState {
  return { legal_name: "", inn: "", kpp: "", legal_address: "" };
}

function toProfileForm(profile: BillingProfile): ProfileFormState {
  return {
    legal_name: profile.legal_name,
    inn: profile.inn,
    kpp: profile.kpp ?? "",
    legal_address: profile.legal_address,
  };
}

interface BillingProfileFormProps {
  initial: ProfileFormState;
}

// Mirrors OrganizationForm's structure (features/organization/OrganizationPage.tsx):
// plain useState baseline/form + zod safeParse storing i18n KEYS as field
// errors, dirty-tracked save button, a transient "saved" caption.
function BillingProfileForm({ initial }: BillingProfileFormProps) {
  const { t } = useTranslation();
  const [baseline, setBaseline] = React.useState<ProfileFormState>(initial);
  const [form, setForm] = React.useState<ProfileFormState>(initial);
  const [fieldErrors, setFieldErrors] = React.useState<ProfileFieldErrors>({});
  const [saved, setSaved] = React.useState(false);
  const savedTimeoutRef = React.useRef<number | undefined>(undefined);
  const saveProfile = useSaveBillingProfile();

  React.useEffect(() => () => window.clearTimeout(savedTimeoutRef.current), []);

  function updateField<K extends keyof ProfileFormState>(key: K, value: ProfileFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFieldErrors({});
    setSaved(false);
    saveProfile.reset();
  }

  const isDirty =
    form.legal_name !== baseline.legal_name ||
    form.inn !== baseline.inn ||
    form.kpp !== baseline.kpp ||
    form.legal_address !== baseline.legal_address;

  const saveDisabled = !isDirty || saveProfile.isPending;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const parsed = billingProfileSchema.safeParse(form);
    if (!parsed.success) {
      const errors: ProfileFieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (typeof key === "string" && !(key in errors)) {
          errors[key as keyof ProfileFormState] = issue.message;
        }
      }
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});

    saveProfile.mutate(
      {
        body: {
          legal_name: parsed.data.legal_name,
          inn: parsed.data.inn,
          kpp: parsed.data.kpp === "" ? null : parsed.data.kpp,
          legal_address: parsed.data.legal_address,
        },
      },
      {
        onSuccess: (updated) => {
          const next = toProfileForm(updated);
          setBaseline(next);
          setForm(next);
          setSaved(true);
          window.clearTimeout(savedTimeoutRef.current);
          savedTimeoutRef.current = window.setTimeout(() => setSaved(false), 2000);
        },
      },
    );
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-2">
        <Label htmlFor="billing-legal-name">{t("billingLegalName")}</Label>
        <Input
          id="billing-legal-name"
          value={form.legal_name}
          onChange={(e) => updateField("legal_name", e.target.value)}
        />
        {fieldErrors.legal_name ? <p className="text-caption text-destructive">{t(fieldErrors.legal_name)}</p> : null}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="billing-inn">{t("billingInn")}</Label>
        <Input id="billing-inn" value={form.inn} onChange={(e) => updateField("inn", e.target.value)} />
        {fieldErrors.inn ? <p className="text-caption text-destructive">{t(fieldErrors.inn)}</p> : null}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="billing-kpp">{t("billingKpp")}</Label>
        <Input id="billing-kpp" value={form.kpp} onChange={(e) => updateField("kpp", e.target.value)} />
        {fieldErrors.kpp ? <p className="text-caption text-destructive">{t(fieldErrors.kpp)}</p> : null}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="billing-legal-address">{t("billingLegalAddress")}</Label>
        <Input
          id="billing-legal-address"
          value={form.legal_address}
          onChange={(e) => updateField("legal_address", e.target.value)}
        />
        {fieldErrors.legal_address ? (
          <p className="text-caption text-destructive">{t(fieldErrors.legal_address)}</p>
        ) : null}
      </div>
      {saveProfile.isError ? <p className="text-body text-destructive">{t("settingsSaveError")}</p> : null}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={saveDisabled}>
          {t("settingsSave")}
        </Button>
        {saved ? <span className="text-caption text-muted-foreground">{t("billingProfileSaved")}</span> : null}
      </div>
    </form>
  );
}

function BillingProfileCard({ onProfileChange }: { onProfileChange: (profile: BillingProfile | null) => void }) {
  const { t } = useTranslation();
  const profileQuery = useBillingProfile();

  React.useEffect(() => {
    onProfileChange(profileQuery.data ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onProfileChange is a stable setState-wrapping callback from the parent
  }, [profileQuery.data]);

  const isNotFound =
    profileQuery.isError && profileQuery.error instanceof ApiError && profileQuery.error.status === 404;
  const loadFailed = profileQuery.isError && !isNotFound;

  let content: React.ReactNode;
  if (profileQuery.isLoading) {
    content = <Skeleton className="h-64 w-full" />;
  } else if (loadFailed) {
    content = <p className="text-body text-destructive">{t("settingsLoadError")}</p>;
  } else {
    const initial = profileQuery.data ? toProfileForm(profileQuery.data) : emptyProfileForm();
    // Keyed on the loaded profile's updated_at (or "empty" pre-save) so a
    // successful first save — 404/no-profile flipping to a real profile —
    // remounts the form with the server's canonical values as its new
    // baseline, instead of the stale pre-save baseline sticking around.
    content = <BillingProfileForm key={profileQuery.data?.updated_at ?? "empty"} initial={initial} />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("billingProfileSection")}</CardTitle>
      </CardHeader>
      <CardContent>{content}</CardContent>
    </Card>
  );
}

// ---- Catalog card ---------------------------------------------------------

const KIND_LABEL_KEYS: Record<BillingCatalogItem["kind"], string> = {
  plan: "billingKindPlan",
  service: "billingKindService",
  addon: "billingKindAddon",
};

function formatRub(value: number): string {
  return `${value.toLocaleString("ru-RU")} ₽`;
}

function BillingCatalogCard({ hasProfile }: { hasProfile: boolean }) {
  const { t } = useTranslation();
  const catalogQuery = useBillingCatalog();
  const requestInvoice = useRequestInvoice();
  const [quantities, setQuantities] = React.useState<Record<string, number>>({});

  const items = catalogQuery.data ?? [];
  const total = items.reduce((sum, item) => sum + item.price * (quantities[item.id] ?? 0), 0);
  const hasQuantity = items.some((item) => (quantities[item.id] ?? 0) > 0);
  const requestDisabled = !hasQuantity || !hasProfile || requestInvoice.isPending;

  function handleQuantityChange(itemId: string, value: number | "") {
    setQuantities((prev) => ({ ...prev, [itemId]: value === "" ? 0 : value }));
    requestInvoice.reset();
  }

  function handleRequest() {
    const lines = items
      .filter((item) => (quantities[item.id] ?? 0) > 0)
      .map((item) => ({ catalog_item_id: item.id, quantity: quantities[item.id] }));

    requestInvoice.mutate(
      { body: { lines } },
      {
        onSuccess: (invoice) => {
          toast.success(t("billingInvoiceRequested", { number: invoice.number }));
          setQuantities({});
        },
      },
    );
  }

  const requestErrorMessage =
    requestInvoice.isError && requestInvoice.error instanceof ApiError ? requestInvoice.error.message : null;

  let body: React.ReactNode;
  if (catalogQuery.isLoading) {
    body = <Skeleton className="h-40 w-full" />;
  } else if (items.length === 0) {
    body = <p className="text-body text-muted-foreground">{t("billingNoCatalogItems")}</p>;
  } else {
    body = (
      <div className="flex flex-col gap-3">
        <ul className="flex flex-col divide-y divide-border">
          {items.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-4 py-3">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-body text-foreground">{item.name}</span>
                  <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-caption text-muted-foreground">
                    {t(KIND_LABEL_KEYS[item.kind])}
                  </span>
                </div>
                <p className="text-caption text-muted-foreground">{item.description}</p>
                <p className="text-caption text-muted-foreground">
                  {formatRub(item.price)}
                  {" — "}
                  {item.vat_rate === null ? t("billingNoVat") : t("billingVatIncluded", { rate: item.vat_rate })}
                </p>
              </div>
              <NumberInput
                aria-label={item.name}
                value={quantities[item.id] ?? 0}
                min={0}
                onValueChange={(value) => handleQuantityChange(item.id, value)}
              />
            </li>
          ))}
        </ul>
        {requestErrorMessage ? <p className="text-body text-destructive">{requestErrorMessage}</p> : null}
        <div className="flex items-center justify-between border-t border-border pt-3">
          <span className="text-body font-medium">
            {t("billingTotal")}: {formatRub(total)}
          </span>
          <div className="flex flex-col items-end gap-1">
            <Button type="button" disabled={requestDisabled} onClick={handleRequest}>
              {t("billingRequestInvoice")}
            </Button>
            {!hasProfile ? <span className="text-caption text-muted-foreground">{t("billingProfileFirst")}</span> : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("billingCatalogSection")}</CardTitle>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}

// ---- Invoices card ---------------------------------------------------------

const STATUS_LABEL_KEYS: Record<Invoice["status"], string> = {
  issued: "billingStatusIssued",
  paid: "billingStatusPaid",
  cancelled: "billingStatusCancelled",
};

// Board-agnostic CSS-grid row, mirroring AttendeeTable.tsx's pattern:
// Номер / Дата / Сумма / Статус / «Открыть». Below `md` the fixed 140px
// columns (520px+ total) overflow a 390px phone viewport, so the Date
// column is dropped there (`hidden md:inline` on its cells — display:none
// removes it from grid auto-placement entirely, so the remaining 4 items
// cleanly fill the 4-column mobile template) and the surviving columns use
// `minmax(0, …fr)` instead of a fixed px width so long content can't force
// the grid wider than the viewport. The `md:` desktop template is the exact
// original fixed-px value, so desktop rendering is unchanged.
const INVOICE_ROW_GRID =
  "grid grid-cols-[minmax(0,1.3fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_44px] items-center gap-2 md:grid-cols-[1fr_140px_140px_140px_100px] md:gap-3";

function BillingInvoicesCard() {
  const { t } = useTranslation();
  const invoicesQuery = useBillingInvoices();
  const invoices = invoicesQuery.data ?? [];

  let body: React.ReactNode;
  if (invoicesQuery.isLoading) {
    body = <Skeleton className="h-40 w-full" />;
  } else if (invoicesQuery.isError) {
    body = <p className="text-body text-destructive">{t("settingsLoadError")}</p>;
  } else if (invoices.length === 0) {
    body = <EmptyState icon={Receipt} title={t("billingNoInvoices")} />;
  } else {
    body = (
      <div data-testid="billing-invoices-table" className="overflow-hidden rounded-[10px] border border-border">
        <div
          className={cn(
            INVOICE_ROW_GRID,
            "border-b border-border bg-muted/40 px-3.5 py-2 text-caption font-medium uppercase text-muted-foreground",
          )}
        >
          <span>{t("billingInvoiceNumberCol")}</span>
          <span className="hidden md:inline">{t("billingInvoiceDateCol")}</span>
          <span>{t("billingInvoiceAmountCol")}</span>
          <span>{t("billingInvoiceStatusCol")}</span>
          <span />
        </div>
        <ul className="flex flex-col divide-y divide-border">
          {invoices.map((invoice) => (
            <li key={invoice.id} className={cn(INVOICE_ROW_GRID, "px-3.5 py-2 text-body")}>
              <span className="truncate font-mono text-caption">{invoice.number}</span>
              <span className="hidden text-muted-foreground md:inline">{new Date(invoice.issued_at).toLocaleDateString()}</span>
              <span>{formatRub(invoice.total)}</span>
              <span>{t(STATUS_LABEL_KEYS[invoice.status])}</span>
              <Link
                to="/billing/invoices/$invoiceId/print"
                params={{ invoiceId: invoice.id }}
                className="text-caption text-primary hover:underline"
              >
                {t("billingOpen")}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("billingInvoicesSection")}</CardTitle>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}

// ---- Page -------------------------------------------------------------

// Task 13 — the tenant panel's «Оплата» page: an anchor-rail + stacked-
// sections layout (as EventSettingsPage.tsx) over three cards — billing
// requisites (self-service PUT), the public catalog (self-service invoice
// request), and the tenant's own invoice history (opens the chrome-less
// print view, registered as a router.tsx sibling of protectedLayoutRoute
// so it renders outside the NavDrawer/AppShell chrome — see router.tsx's
// own comment on that registration).
export function BillingPage() {
  const { t } = useTranslation();
  const activeId = useScrollSpy([...SECTION_IDS]);
  const [profile, setProfile] = React.useState<BillingProfile | null>(null);

  return (
    <div data-testid="billing-page" className="flex flex-col gap-5 p-4 md:p-6">
      <h2 className="text-page-title">{t("billingTitle")}</h2>
      <div className="flex gap-6">
        {/* Hidden below `md`: at a 390px phone width the fixed 200px rail plus
        the content column overflows; content sections stack full-width on
        their own since this is the only sibling left in the flex row once
        the rail is display:none. Returns at `md` (single cutover, matching
        the AppShell header pattern). */}
        <nav className="hidden w-[200px] shrink-0 flex-col gap-0.5 md:flex">
          {RAIL_ITEMS.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              aria-current={activeId === item.id ? "true" : undefined}
              className={cn(
                "rounded-md px-2 py-1.5 text-body",
                activeId === item.id ? "bg-success/10 text-success" : "text-muted-foreground hover:bg-muted",
              )}
            >
              {t(item.labelKey)}
            </a>
          ))}
        </nav>
        <div className="flex max-w-3xl flex-1 flex-col gap-4">
          <section id="billing-profile">
            <BillingProfileCard onProfileChange={setProfile} />
          </section>
          <section id="billing-catalog">
            <BillingCatalogCard hasProfile={profile !== null} />
          </section>
          <section id="billing-invoices">
            <BillingInvoicesCard />
          </section>
        </div>
      </div>
    </div>
  );
}
