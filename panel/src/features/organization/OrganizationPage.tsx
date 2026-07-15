import {
  Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Skeleton,
} from "@idento/ui";
import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { ApiError } from "../../shared/api/ApiError";
import { $api } from "../../shared/api/query";
import type { components } from "../../shared/api/schema";
import { getCurrentTenant } from "../../shared/api/session";

type TenantMembership = components["schemas"]["TenantMembership"];

// Optional fields (website/contactEmail/logoUrl) are validated with zod's
// `.email()`/`.url()` only when non-empty — an empty string is a legitimate
// "not set" value here, not an error, matching the brief's "validated ONLY
// when non-empty" rule. `.superRefine` (rather than a plain `.email()` on
// the field) is what makes that "skip when empty" conditional possible.
const orgSchema = z.object({
  name: z.string().trim().min(1, "orgNameRequired").max(200, "orgNameTooLong"),
  website: z.string(),
  contactEmail: z.string(),
  logoUrl: z.string(),
}).superRefine((val, ctx) => {
  if (val.contactEmail !== "" && !z.string().email().safeParse(val.contactEmail).success) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "orgEmailInvalid", path: ["contactEmail"] });
  }
  if (val.logoUrl !== "" && !z.string().url().safeParse(val.logoUrl).success) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "orgLogoUrlInvalid", path: ["logoUrl"] });
  }
});

type FieldErrors = Partial<Record<"name" | "contactEmail" | "logoUrl", string>>;

type FormState = {
  name: string;
  website: string;
  contactEmail: string;
  logoUrl: string;
};

function toFormState(tenant: TenantMembership): FormState {
  return {
    name: tenant.name,
    website: tenant.website ?? "",
    contactEmail: tenant.contact_email ?? "",
    logoUrl: tenant.logo_url ?? "",
  };
}

interface OrganizationFormProps {
  tenantId: string;
  tenant: TenantMembership;
}

// Mirrors GeneralCard.tsx's dirty-tracking + scoped-save shape (Task 4), but
// isn't extracted into a shared hook: the field set (email/url validation,
// role-gated disable, no date-clear-block analog) differs enough that a
// shared `useDirtyFields` would need its own escape hatches for both call
// sites' quirks, which isn't a net simplification for two call sites.
function OrganizationForm({ tenantId, tenant }: OrganizationFormProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const isAdmin = tenant.role === "admin";
  const [baseline, setBaseline] = React.useState<FormState>(() => toFormState(tenant));
  const [form, setForm] = React.useState<FormState>(() => toFormState(tenant));
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({});
  const [saved, setSaved] = React.useState(false);
  const savedTimeoutRef = React.useRef<number | undefined>(undefined);

  React.useEffect(() => () => window.clearTimeout(savedTimeoutRef.current), []);

  const updateTenant = $api.useMutation("put", "/api/tenants/{id}", {
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({
        queryKey: ["get", "/api/tenants/{id}", { params: { path: { id: tenantId } } }],
      });
      const next: FormState = {
        name: updated.name,
        website: updated.website ?? "",
        contactEmail: updated.contact_email ?? "",
        logoUrl: updated.logo_url ?? "",
      };
      setBaseline(next);
      setForm(next);
      setSaved(true);
      window.clearTimeout(savedTimeoutRef.current);
      savedTimeoutRef.current = window.setTimeout(() => setSaved(false), 2000);
    },
  });

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFieldErrors({});
    setSaved(false);
    updateTenant.reset();
  }

  const isDirty =
    form.name !== baseline.name ||
    form.website !== baseline.website ||
    form.contactEmail !== baseline.contactEmail ||
    form.logoUrl !== baseline.logoUrl;

  const saveDisabled = !isDirty || updateTenant.isPending;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const parsed = orgSchema.safeParse(form);
    if (!parsed.success) {
      const errors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (typeof key === "string" && !(key in errors)) {
          errors[key as keyof FieldErrors] = issue.message;
        }
      }
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});

    const body: {
      name?: string;
      website?: string;
      contact_email?: string;
      logo_url?: string;
    } = {};
    if (form.name !== baseline.name) body.name = parsed.data.name;
    // Website/contact email/logo URL deliberately allow an explicit "" —
    // PUT's *pointer* semantics (despite the HTTP verb) treat a present
    // empty string as "clear this field", which is exactly the user's
    // intent when they empty one of these inputs (same deliberate-clear
    // treatment as GeneralCard's location field).
    if (form.website !== baseline.website) body.website = form.website;
    if (form.contactEmail !== baseline.contactEmail) body.contact_email = form.contactEmail;
    if (form.logoUrl !== baseline.logoUrl) body.logo_url = form.logoUrl;

    updateTenant.mutate({ params: { path: { id: tenantId } }, body });
  }

  const saveErrorKey =
    updateTenant.error instanceof ApiError && updateTenant.error.status === 403
      ? "orgForbiddenError"
      : "settingsSaveError";

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("orgTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          {!isAdmin ? (
            <p className="text-body text-muted-foreground">{t("orgReadOnlyNotice")}</p>
          ) : null}
          <div className="flex flex-col gap-2">
            <Label htmlFor="organization-name">{t("orgNameLabel")}</Label>
            <Input
              id="organization-name"
              value={form.name}
              disabled={!isAdmin}
              onChange={(e) => updateField("name", e.target.value)}
            />
            {fieldErrors.name ? <p className="text-caption text-destructive">{t(fieldErrors.name)}</p> : null}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="organization-website">{t("orgWebsiteLabel")}</Label>
            <Input
              id="organization-website"
              value={form.website}
              disabled={!isAdmin}
              onChange={(e) => updateField("website", e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="organization-contact-email">{t("orgContactEmailLabel")}</Label>
            <Input
              id="organization-contact-email"
              value={form.contactEmail}
              disabled={!isAdmin}
              onChange={(e) => updateField("contactEmail", e.target.value)}
            />
            {fieldErrors.contactEmail ? (
              <p className="text-caption text-destructive">{t(fieldErrors.contactEmail)}</p>
            ) : null}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="organization-logo-url">{t("orgLogoUrlLabel")}</Label>
            <Input
              id="organization-logo-url"
              value={form.logoUrl}
              disabled={!isAdmin}
              onChange={(e) => updateField("logoUrl", e.target.value)}
            />
            {fieldErrors.logoUrl ? (
              <p className="text-caption text-destructive">{t(fieldErrors.logoUrl)}</p>
            ) : null}
          </div>
          {updateTenant.isError ? <p className="text-body text-destructive">{t(saveErrorKey)}</p> : null}
          {isAdmin ? (
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={saveDisabled}>
                {t("settingsSave")}
              </Button>
              {saved ? <span className="text-caption text-muted-foreground">{t("settingsSaved")}</span> : null}
            </div>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}

// Task 8's Organization screen — not on the design board (reconciliation
// #10 in the task brief); styled to match GeneralCard.tsx's single-card,
// dirty-tracked, scoped-save look instead. `getCurrentTenant()` returning
// null shouldn't happen inside the protected `_app` layout (every route
// under it requires an active tenant), but is handled honestly rather than
// crashing or rendering a blank card.
export function OrganizationPage() {
  const { t } = useTranslation();
  const tenant = getCurrentTenant();

  const tenantQuery = $api.useQuery(
    "get",
    "/api/tenants/{id}",
    { params: { path: { id: tenant?.id ?? "" } } },
    { enabled: tenant !== null },
  );

  if (tenant === null) {
    return <p className="text-body text-destructive">{t("homeLoadError")}</p>;
  }

  if (tenantQuery.isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full max-w-2xl" />
      </div>
    );
  }

  if (tenantQuery.isError || !tenantQuery.data) {
    return <p className="text-body text-destructive">{t("settingsLoadError")}</p>;
  }

  return (
    <div className="max-w-2xl">
      <OrganizationForm tenantId={tenant.id} tenant={tenantQuery.data} />
    </div>
  );
}
