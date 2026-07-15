import {
  Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input, Label,
} from "@idento/ui";
import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { ATTENDEES_LIST_KEY } from "./hooks";
import { $api } from "../../shared/api/query";

// Same message-KEY convention as CreateEventDialog.tsx: zod stores KEYS
// (translated via `t()` at render time), never raw validator strings, so a
// bare `.email()` can't leak untranslated English into the UI.
//
// Both name fields are optional individually, but at least one must be
// non-empty after trimming — enforced via `.refine()` rather than per-field
// `.min()` since the requirement spans both fields. Email is optional too,
// but when a value IS provided it must be a valid address; `.email()` only
// runs on non-empty trimmed values via `.refine()` for the same reason
// `.email().optional()` alone can't express "valid-or-blank" without also
// accepting a garbage non-empty string through `.optional()`.
const addAttendeeSchema = z
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

export interface AddAttendeeDialogProps {
  eventId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddAttendeeDialog({ eventId, open, onOpenChange }: AddAttendeeDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const createAttendee = $api.useMutation("post", "/api/events/{event_id}/attendees");

  const [firstName, setFirstName] = React.useState("");
  const [lastName, setLastName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [company, setCompany] = React.useState("");
  const [position, setPosition] = React.useState("");
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({});

  // Reset all form state whenever the dialog transitions closed, so the next
  // open starts clean — same mutation-reset-on-close pattern as
  // CreateEventDialog.tsx, otherwise a failed create leaves the mutation in
  // `isError` after close and reopening would immediately show the stale
  // server-error line before the user has submitted anything.
  React.useEffect(() => {
    if (open) return;
    setFirstName("");
    setLastName("");
    setEmail("");
    setCompany("");
    setPosition("");
    setFieldErrors({});
    createAttendee.reset();
    // createAttendee is a fresh mutation object each render; including it in
    // the deps would reset on every render instead of only on the
    // open->closed transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // A stale server error shouldn't survive the user editing any field again
  // — clear it eagerly on the next keystroke rather than waiting for
  // resubmit, so the inline message doesn't sit next to an edit the user has
  // already made in response to it.
  function clearServerErrorIfNeeded() {
    if (createAttendee.isError) createAttendee.reset();
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = addAttendeeSchema.safeParse({ firstName, lastName, email, company, position });
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

    // CREATE, not PATCH — there's no "clear via empty string" semantics to
    // preserve, so fields the user left blank are simply omitted from the
    // body rather than sent as "".
    const body: {
      first_name?: string;
      last_name?: string;
      email?: string;
      company?: string;
      position?: string;
    } = {};
    const trimmedFirstName = parsed.data.firstName.trim();
    const trimmedLastName = parsed.data.lastName.trim();
    const trimmedEmail = parsed.data.email.trim();
    const trimmedCompany = parsed.data.company.trim();
    const trimmedPosition = parsed.data.position.trim();
    if (trimmedFirstName) body.first_name = trimmedFirstName;
    if (trimmedLastName) body.last_name = trimmedLastName;
    if (trimmedEmail) body.email = trimmedEmail;
    if (trimmedCompany) body.company = trimmedCompany;
    if (trimmedPosition) body.position = trimmedPosition;

    createAttendee.mutate(
      { params: { path: { event_id: eventId } }, body },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: ATTENDEES_LIST_KEY(eventId) });
          onOpenChange(false);
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("createEventCancel")}>
        <DialogHeader>
          <DialogTitle>{t("addAttendeeTitle")}</DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="add-attendee-first-name">{t("addAttendeeFirstName")}</Label>
            <Input
              id="add-attendee-first-name"
              value={firstName}
              onChange={(e) => {
                setFirstName(e.target.value);
                clearServerErrorIfNeeded();
              }}
            />
            {fieldErrors.firstName ? (
              <p className="text-caption text-destructive">{t(fieldErrors.firstName)}</p>
            ) : null}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="add-attendee-last-name">{t("addAttendeeLastName")}</Label>
            <Input
              id="add-attendee-last-name"
              value={lastName}
              onChange={(e) => {
                setLastName(e.target.value);
                clearServerErrorIfNeeded();
              }}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="add-attendee-email">{t("addAttendeeEmail")}</Label>
            <Input
              id="add-attendee-email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                clearServerErrorIfNeeded();
              }}
            />
            {fieldErrors.email ? <p className="text-caption text-destructive">{t(fieldErrors.email)}</p> : null}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="add-attendee-company">{t("addAttendeeCompany")}</Label>
            <Input
              id="add-attendee-company"
              value={company}
              onChange={(e) => {
                setCompany(e.target.value);
                clearServerErrorIfNeeded();
              }}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="add-attendee-position">{t("addAttendeePosition")}</Label>
            <Input
              id="add-attendee-position"
              value={position}
              onChange={(e) => {
                setPosition(e.target.value);
                clearServerErrorIfNeeded();
              }}
            />
          </div>
          {createAttendee.isError ? (
            <p className="text-body text-destructive">{t("addAttendeeServerError")}</p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("createEventCancel")}
            </Button>
            <Button type="submit" disabled={createAttendee.isPending}>
              {t("addAttendeeSubmit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
