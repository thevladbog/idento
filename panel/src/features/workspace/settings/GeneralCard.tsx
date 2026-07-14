import {
  Button, Card, CardContent, CardHeader, CardTitle, Input, Label,
} from "@idento/ui";
import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { $api } from "../../../shared/api/query";
import type { components } from "../../../shared/api/schema";

type ApiEvent = components["schemas"]["Event"];

// Mirrors CreateEventDialog's schema exactly (same message keys, reused —
// not duplicated in en.json/ru.json). Empty date-input strings are valid
// here too ("" means "not set" for the refine check below), matching the
// create dialog's optional-field handling.
const generalSchema = z
  .object({
    name: z.string().trim().min(1, "createEventNameRequired").max(200, "createEventNameTooLong"),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    location: z.string().max(300, "createEventLocationTooLong").optional(),
  })
  .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, {
    message: "createEventDatesOrder",
    path: ["endDate"],
  });

type FieldErrors = Partial<Record<"name" | "endDate" | "location", string>>;

type FormState = {
  name: string;
  startDate: string;
  endDate: string;
  location: string;
};

// `new Date(iso).toISOString().slice(0, 10)` is the UTC calendar date
// whether `iso` is a bare date-only UTC-midnight timestamp or a real
// timestamp with a time component — safe for both, per the P1.1 date-only
// rules this task must stay consistent with.
function toFormState(event: ApiEvent): FormState {
  return {
    name: event.name,
    startDate: event.start_date ? new Date(event.start_date).toISOString().slice(0, 10) : "",
    endDate: event.end_date ? new Date(event.end_date).toISOString().slice(0, 10) : "",
    location: event.location ?? "",
  };
}

export interface GeneralCardProps {
  event: ApiEvent;
}

// Board 6a's General card: name/starts/ends/location with a scoped PATCH —
// only the fields the user actually changed are sent (PATCH's contract:
// absent = unchanged). Dates can't be cleared via PATCH (nil = unchanged,
// documented P1.1 limitation), so clearing a previously-set date input
// disables Save entirely for that dirty-state rather than silently dropping
// the clear attempt or sending a value that wouldn't actually clear it.
export function GeneralCard({ event }: GeneralCardProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [baseline, setBaseline] = React.useState<FormState>(() => toFormState(event));
  const [form, setForm] = React.useState<FormState>(() => toFormState(event));
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({});
  const [saved, setSaved] = React.useState(false);
  const savedTimeoutRef = React.useRef<number | undefined>(undefined);

  // Cancel the pending fade-out on unmount so a save that succeeds right
  // before the user navigates away doesn't call setSaved on an unmounted
  // component.
  React.useEffect(() => () => window.clearTimeout(savedTimeoutRef.current), []);

  const patchEvent = $api.useMutation("patch", "/api/events/{id}", {
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({
        queryKey: ["get", "/api/events/{id}", { params: { path: { id: event.id } } }],
      });
      const next = toFormState(updated);
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
    // Stale mutation state (a prior save's error) must not persist across a
    // new edit — same rule CreateEventDialog applies on dialog reopen.
    patchEvent.reset();
  }

  const startCleared = baseline.startDate !== "" && form.startDate === "";
  const endCleared = baseline.endDate !== "" && form.endDate === "";
  const dateClearAttempted = startCleared || endCleared;

  const isDirty =
    form.name !== baseline.name ||
    form.startDate !== baseline.startDate ||
    form.endDate !== baseline.endDate ||
    form.location !== baseline.location;

  const saveDisabled = !isDirty || dateClearAttempted || patchEvent.isPending;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (dateClearAttempted) return;

    const parsed = generalSchema.safeParse(form);
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
      start_date?: string;
      end_date?: string;
      location?: string;
    } = {};
    if (form.name !== baseline.name) body.name = parsed.data.name;
    if (form.startDate !== baseline.startDate && form.startDate) {
      body.start_date = new Date(form.startDate).toISOString();
    }
    if (form.endDate !== baseline.endDate && form.endDate) {
      body.end_date = new Date(form.endDate).toISOString();
    }
    // Location deliberately allows an explicit "" — PATCH's *string pointer
    // semantics treat a present empty string as "clear this field", which is
    // exactly the user's intent when they empty the input (unlike dates,
    // which have no clear-via-PATCH support at all).
    if (form.location !== baseline.location) body.location = form.location;

    patchEvent.mutate({ params: { path: { id: event.id } }, body });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settingsGeneral")}</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="settings-general-name">{t("createEventNameLabel")}</Label>
            <Input
              id="settings-general-name"
              value={form.name}
              onChange={(e) => updateField("name", e.target.value)}
            />
            {fieldErrors.name ? <p className="text-caption text-destructive">{t(fieldErrors.name)}</p> : null}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="settings-general-start">{t("createEventStartLabel")}</Label>
            <Input
              id="settings-general-start"
              type="date"
              value={form.startDate}
              onChange={(e) => updateField("startDate", e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="settings-general-end">{t("createEventEndLabel")}</Label>
            <Input
              id="settings-general-end"
              type="date"
              value={form.endDate}
              onChange={(e) => updateField("endDate", e.target.value)}
            />
            {fieldErrors.endDate ? <p className="text-caption text-destructive">{t(fieldErrors.endDate)}</p> : null}
          </div>
          {dateClearAttempted ? (
            <p className="text-caption text-muted-foreground">{t("settingsDatesCannotClear")}</p>
          ) : null}
          <div className="flex flex-col gap-2">
            <Label htmlFor="settings-general-location">{t("createEventLocationLabel")}</Label>
            <Input
              id="settings-general-location"
              value={form.location}
              onChange={(e) => updateField("location", e.target.value)}
            />
            {fieldErrors.location ? (
              <p className="text-caption text-destructive">{t(fieldErrors.location)}</p>
            ) : null}
          </div>
          {patchEvent.isError ? <p className="text-body text-destructive">{t("settingsSaveError")}</p> : null}
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={saveDisabled}>
              {t("settingsSave")}
            </Button>
            {saved ? <span className="text-caption text-muted-foreground">{t("settingsSaved")}</span> : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
