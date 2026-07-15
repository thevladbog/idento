import {
  Button, Input, Label,
} from "@idento/ui";
import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { ATTENDEES_LIST_KEY, ATTENDEE_DETAIL_KEY } from "./hooks";
import { $api } from "../../shared/api/query";
import type { components } from "../../shared/api/schema";

type Attendee = components["schemas"]["Attendee"];

// Same shape as AddAttendeeDialog.tsx's `addAttendeeSchema` (first/last:
// individually optional but at least one required via `.refine`; email:
// optional, validated only when non-blank) and the SAME i18n message keys
// ("addAttendeeNameRequired"/"addAttendeeEmailInvalid") — reused, not
// duplicated in en.json/ru.json. The zod object itself is duplicated rather
// than importing AddAttendeeDialog's (unexported) schema: this mirrors
// GeneralCard.tsx's own precedent of re-declaring CreateEventDialog's schema
// verbatim ("same message keys, reused — not duplicated") rather than
// exporting an internal validator purely to share ~10 lines across two
// otherwise-unrelated forms (a create dialog and an edit-in-place form with
// different submit semantics — omit-blank-fields vs scoped-PATCH).
const editAttendeeSchema = z
  .object({
    firstName: z.string(),
    lastName: z.string(),
    email: z.string().refine((v) => v.trim() === "" || z.string().email().safeParse(v.trim()).success, {
      message: "addAttendeeEmailInvalid",
    }),
    company: z.string(),
    position: z.string(),
  })
  .refine((v) => v.firstName.trim() !== "" || v.lastName.trim() !== "", {
    message: "addAttendeeNameRequired",
    path: ["firstName"],
  });

type FieldErrors = Partial<Record<"firstName" | "email", string>>;

type FormState = {
  firstName: string;
  lastName: string;
  email: string;
  company: string;
  position: string;
};

function toFormState(attendee: Attendee): FormState {
  return {
    firstName: attendee.first_name,
    lastName: attendee.last_name,
    email: attendee.email,
    company: attendee.company,
    position: attendee.position,
  };
}

export interface EditAttendeeFormProps {
  attendee: Attendee;
  eventId: string;
  onCancel: () => void;
  onSaved: () => void;
}

// Task 9's edit-details form — AttendeeDrawer.tsx swaps this in for the
// drawer's read view when "Edit details" is clicked. Same dirty-tracking +
// scoped-PATCH (only changed fields are sent — pointer-partial semantics,
// "absent" means "unchanged") + edit-version guard as
// workspace/settings/GeneralCard.tsx: `patchAttendee.reset()` on every
// keystroke only clears the mutation OBSERVER's local state, it does NOT
// cancel an in-flight PATCH or stop a late `onSuccess` from firing — without
// the version check, a stale response from an earlier save could silently
// clobber a newer, still-unsaved edit made while that earlier save was
// pending. See GeneralCard.tsx's `editVersionRef` comment for the full
// account of that (found-and-fixed) race.
export function EditAttendeeForm({ attendee, eventId, onCancel, onSaved }: EditAttendeeFormProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [baseline, setBaseline] = React.useState<FormState>(() => toFormState(attendee));
  const [form, setForm] = React.useState<FormState>(() => toFormState(attendee));
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({});
  const editVersionRef = React.useRef(0);

  const patchAttendee = $api.useMutation("patch", "/api/attendees/{id}", {
    onMutate: () => ({ editVersion: editVersionRef.current }),
    onSuccess: (updated, _vars, onMutateResult) => {
      void queryClient.invalidateQueries({ queryKey: ATTENDEES_LIST_KEY(eventId) });
      void queryClient.invalidateQueries({ queryKey: ATTENDEE_DETAIL_KEY(attendee.id) });
      // If the user has edited the form again since this save was
      // submitted, the version captured at mutate-time no longer matches —
      // applying this (now-stale) response would overwrite their newer,
      // still-unsaved edit. Leave the form (and edit mode) exactly as the
      // user left it; do not call onSaved().
      if (onMutateResult?.editVersion !== editVersionRef.current) return;
      const next = toFormState(updated);
      setBaseline(next);
      setForm(next);
      onSaved();
    },
  });

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    editVersionRef.current += 1;
    setForm((prev) => ({ ...prev, [key]: value }));
    setFieldErrors({});
    // Stale mutation state (a prior save's error) must not persist across a
    // new edit — same rule AddAttendeeDialog/GeneralCard apply.
    patchAttendee.reset();
  }

  const isDirty =
    form.firstName !== baseline.firstName ||
    form.lastName !== baseline.lastName ||
    form.email !== baseline.email ||
    form.company !== baseline.company ||
    form.position !== baseline.position;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsed = editAttendeeSchema.safeParse(form);
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

    const trimmedFirstName = parsed.data.firstName.trim();
    const trimmedLastName = parsed.data.lastName.trim();
    const trimmedEmail = parsed.data.email.trim();
    const trimmedCompany = parsed.data.company.trim();
    const trimmedPosition = parsed.data.position.trim();

    // Scoped PATCH: only fields that actually changed vs. the loaded
    // baseline are included — pointer-partial semantics on the backend
    // treat "absent" as "leave unchanged" and a present (possibly empty)
    // string as an explicit set/clear, same contract GeneralCard.tsx relies
    // on for its `location` field.
    const body: {
      first_name?: string;
      last_name?: string;
      email?: string;
      company?: string;
      position?: string;
    } = {};
    // Compare the RAW form value against the RAW baseline (matching
    // `isDirty`'s logic above) — not the trimmed value against the raw
    // baseline. A baseline with odd whitespace (e.g. imported from a messy
    // CSV) must not make an untouched field look "dirty" just because
    // trimming it happens to differ from the untrimmed baseline; the SENT
    // value is still the trimmed one for whichever fields the user actually
    // changed.
    if (form.firstName !== baseline.firstName) body.first_name = trimmedFirstName;
    if (form.lastName !== baseline.lastName) body.last_name = trimmedLastName;
    if (form.email !== baseline.email) body.email = trimmedEmail;
    if (form.company !== baseline.company) body.company = trimmedCompany;
    if (form.position !== baseline.position) body.position = trimmedPosition;

    if (Object.keys(body).length === 0) {
      // Trimming made a whitespace-only edit a no-op (e.g. typed then
      // deleted a trailing space) — nothing to persist, so just return to
      // the read view rather than firing an empty PATCH.
      onCancel();
      return;
    }

    patchAttendee.mutate({ params: { path: { id: attendee.id } }, body });
  }

  return (
    <form className="flex h-full flex-col gap-4" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-2">
        <Label htmlFor="edit-attendee-first-name">{t("addAttendeeFirstName")}</Label>
        <Input
          id="edit-attendee-first-name"
          value={form.firstName}
          onChange={(e) => updateField("firstName", e.target.value)}
        />
        {fieldErrors.firstName ? <p className="text-caption text-destructive">{t(fieldErrors.firstName)}</p> : null}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="edit-attendee-last-name">{t("addAttendeeLastName")}</Label>
        <Input
          id="edit-attendee-last-name"
          value={form.lastName}
          onChange={(e) => updateField("lastName", e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="edit-attendee-email">{t("addAttendeeEmail")}</Label>
        <Input
          id="edit-attendee-email"
          value={form.email}
          onChange={(e) => updateField("email", e.target.value)}
        />
        {fieldErrors.email ? <p className="text-caption text-destructive">{t(fieldErrors.email)}</p> : null}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="edit-attendee-company">{t("addAttendeeCompany")}</Label>
        <Input
          id="edit-attendee-company"
          value={form.company}
          onChange={(e) => updateField("company", e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="edit-attendee-position">{t("addAttendeePosition")}</Label>
        <Input
          id="edit-attendee-position"
          value={form.position}
          onChange={(e) => updateField("position", e.target.value)}
        />
      </div>
      {patchAttendee.isError ? <p className="text-body text-destructive">{t("drawerMutationError")}</p> : null}
      <div className="mt-auto flex items-center gap-3 border-t border-border pt-3">
        <Button type="button" variant="outline" onClick={onCancel}>
          {t("createEventCancel")}
        </Button>
        <Button type="submit" disabled={!isDirty || patchAttendee.isPending}>
          {t("drawerEditSave")}
        </Button>
      </div>
    </form>
  );
}
