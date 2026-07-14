import {
  Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input, Label,
} from "@idento/ui";
import { useNavigate } from "@tanstack/react-router";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { useCreateEvent } from "./hooks";

// zod schema stores message KEYS (not translated strings) in `.min`/`.refine`
// — they're run through `t()` at render time, matching the auth-screen forms'
// error-display idiom (RegisterScreen.tsx) without pulling in react-hook-form.
const createEventSchema = z
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

type FieldErrors = Partial<Record<"name" | "startDate" | "endDate" | "location", string>>;

export type CreateEventDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function CreateEventDialog({ open, onOpenChange }: CreateEventDialogProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const createEvent = useCreateEvent();
  const [name, setName] = React.useState("");
  const [startDate, setStartDate] = React.useState("");
  const [endDate, setEndDate] = React.useState("");
  const [location, setLocation] = React.useState("");
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({});

  // Reset all form state whenever the dialog transitions closed, so the next
  // open starts clean instead of showing the previous attempt's values/errors
  // — including the mutation itself: without this, a failed create leaves
  // the mutation in `isError` after close, and reopening would immediately
  // show the stale server-error line before the user has submitted anything.
  React.useEffect(() => {
    if (open) return;
    setName("");
    setStartDate("");
    setEndDate("");
    setLocation("");
    setFieldErrors({});
    createEvent.reset();
    // createEvent is a fresh mutation object each render; including it in
    // the deps would reset on every render instead of only on the
    // open->closed transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = createEventSchema.safeParse({ name, startDate, endDate, location });
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

    // Date-only `YYYY-MM-DD` strings from `<input type="date">` are parsed by
    // `Date` as UTC midnight (per the ES date-time-string spec's date-only
    // form), so `.toISOString()` here is timezone-safe without needing to
    // append an explicit time/offset. Empty fields are omitted entirely
    // rather than sent as `""` — the API schema treats them as optional.
    const body: { name: string; start_date?: string; end_date?: string; location?: string } = {
      name: parsed.data.name,
    };
    if (parsed.data.startDate) body.start_date = new Date(parsed.data.startDate).toISOString();
    if (parsed.data.endDate) body.end_date = new Date(parsed.data.endDate).toISOString();
    if (parsed.data.location) body.location = parsed.data.location;

    createEvent.mutate(
      { body },
      {
        onSuccess: (created) => {
          onOpenChange(false);
          void navigate({ to: "/events/$eventId", params: { eventId: created.id } });
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("createEventCancel")}>
        <DialogHeader>
          <DialogTitle>{t("createEventTitle")}</DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="create-event-name">{t("createEventNameLabel")}</Label>
            <Input id="create-event-name" value={name} onChange={(e) => setName(e.target.value)} />
            {fieldErrors.name ? <p className="text-caption text-destructive">{t(fieldErrors.name)}</p> : null}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="create-event-start">{t("createEventStartLabel")}</Label>
            <Input
              id="create-event-start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="create-event-end">{t("createEventEndLabel")}</Label>
            <Input id="create-event-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            {fieldErrors.endDate ? <p className="text-caption text-destructive">{t(fieldErrors.endDate)}</p> : null}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="create-event-location">{t("createEventLocationLabel")}</Label>
            <Input id="create-event-location" value={location} onChange={(e) => setLocation(e.target.value)} />
            {fieldErrors.location ? (
              <p className="text-caption text-destructive">{t(fieldErrors.location)}</p>
            ) : null}
          </div>
          {createEvent.isError ? <p className="text-body text-destructive">{t("createEventServerError")}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("createEventCancel")}
            </Button>
            <Button type="submit" disabled={createEvent.isPending}>
              {t("createEventSubmit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
