import {
  Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input, Label, RadioGroup, RadioGroupItem,
} from "@idento/ui";
import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { ROLE_LABEL_KEYS } from "./StaffCard";
import { STAFF_KEY, useEventStaff, useTenantUsers } from "./hooks";
import type { StaffUser } from "./hooks";
import { READINESS_KEY } from "../events/hooks";
import { ApiError } from "../../shared/api/ApiError";
import { $api } from "../../shared/api/query";

// No password-strength rule exists anywhere else in this codebase to reuse
// (grepped panel/src/features/auth/ per the task brief — RegisterScreen.tsx
// has no zod schema at all, just a bare `required` input; the backend only
// rejects an EMPTY password, never a short one). This is a fresh floor, not
// a reused one — 8 is an ordinary minimum, message-keyed like every other
// validator in this codebase.
const PASSWORD_MIN_LENGTH = 8;

type CreateRole = "staff" | "manager";

// zod stores message KEYS (translated via `t()` at render time), same
// convention as CreateEventDialog.tsx/AddAttendeeDialog.tsx.
const createStaffSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "staffAddEmailRequired")
    .refine((v) => z.string().email().safeParse(v).success, { message: "staffAddEmailInvalid" }),
  password: z.string().min(PASSWORD_MIN_LENGTH, "staffAddPasswordTooShort"),
  role: z.enum(["staff", "manager"]),
});

type FieldErrors = Partial<Record<"email" | "password", string>>;

// Distinguishes the two ways a create-mode submit can end up in an error
// state, since the copy for each is different (reconciliation: an
// assign-after-create failure must say the user EXISTS — it's not a plain
// "couldn't create" failure).
type CreateFlowError = { kind: "create"; message?: string } | { kind: "assign"; email: string };

export interface AddStaffDialogProps {
  eventId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Gates the "create new user" tab/segment entirely (reconciliation #15) —
  // POST /api/users is admin-only server-side too, so a manager would only
  // ever get a 403 from it; hiding it is honest, not just decorative.
  isAdmin: boolean;
}

export function AddStaffDialog({
  eventId, open, onOpenChange, isAdmin,
}: AddStaffDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [mode, setMode] = React.useState<"existing" | "create">("existing");
  const [selectedUserId, setSelectedUserId] = React.useState<string | null>(null);
  const [existingError, setExistingError] = React.useState(false);

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [role, setRole] = React.useState<CreateRole>("staff");
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({});
  const [createFlowError, setCreateFlowError] = React.useState<CreateFlowError | null>(null);

  // Bumped on every dialog-close path (Cancel/X/Escape/outside-click) —
  // same AddAttendeeDialog pattern: a response landing after the user has
  // backed out of THIS session must not close/error into whatever the
  // dialog is doing now. Cache invalidation for anything that really
  // happened server-side still runs unconditionally.
  const sessionRef = React.useRef(0);

  const staffQuery = useEventStaff(eventId);
  const tenantUsersQuery = useTenantUsers(open);

  // Three independent mutation objects rather than sharing one across both
  // modes/steps: existing-mode's direct assign, create-mode's user creation,
  // and create-mode's chained assign step all render their OWN error state
  // (createFlowError/existingError), never a shared mutation's `.isError` —
  // otherwise a create-chain assign failure could leak its `.isError` into
  // the existing-mode tab's error line (or vice versa) despite the two
  // being unrelated to each other's current attempt.
  const assignExisting = $api.useMutation("post", "/api/events/{event_id}/staff", {
    onMutate: () => ({ sessionId: sessionRef.current }),
  });
  const createUser = $api.useMutation("post", "/api/users", {
    onMutate: () => ({ sessionId: sessionRef.current }),
  });
  const assignAfterCreate = $api.useMutation("post", "/api/events/{event_id}/staff", {
    onMutate: () => ({ sessionId: sessionRef.current }),
  });

  const isPending = assignExisting.isPending || createUser.isPending || assignAfterCreate.isPending;

  React.useEffect(() => {
    if (open) return;
    sessionRef.current += 1;
    setMode("existing");
    setSelectedUserId(null);
    setExistingError(false);
    setEmail("");
    setPassword("");
    setRole("staff");
    setFieldErrors({});
    setCreateFlowError(null);
    // Dismissal is blocked below while isPending, so `open` only ever
    // transitions to false once every mutation here has already settled —
    // resetting unconditionally can't detach an observer still in flight.
    assignExisting.reset();
    createUser.reset();
    assignAfterCreate.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Defense-in-depth: `isAdmin` is a live prop (StaffPage's own tenant-role
  // fetch), not something this dialog controls — if it ever flips to false
  // while the dialog happens to be open in create mode (e.g. an org switch
  // elsewhere demotes the viewer mid-session), the create form must not be
  // left reachable just because the tab buttons that would normally guard
  // it have disappeared.
  React.useEffect(() => {
    if (!isAdmin && mode === "create") setMode("existing");
  }, [isAdmin, mode]);

  function handleOpenChange(next: boolean) {
    if (!next && isPending) return;
    onOpenChange(next);
  }

  function preventDialogDismiss(e: Event) {
    if (isPending) e.preventDefault();
  }

  // Called by BOTH modes' assign-success paths (existing-user assign, and
  // the create→assign chain). Readiness is invalidated alongside the staff
  // list (PR #66 review, P1): the backend recomputes the staff readiness
  // step from the live staff list, so adding the first member must flip the
  // workspace rail's staff step without waiting for an unrelated refetch.
  // Unconditional, same as the staff-list invalidation — the assignment
  // really happened server-side even if this dialog session was abandoned.
  function invalidateStaffList() {
    void queryClient.invalidateQueries({ queryKey: STAFF_KEY(eventId) });
    void queryClient.invalidateQueries({ queryKey: READINESS_KEY(eventId) });
  }

  function handleExistingSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedUserId) return;
    setExistingError(false);
    assignExisting.mutate(
      { params: { path: { event_id: eventId } }, body: { user_id: selectedUserId } },
      {
        onSuccess: (_data, _vars, onMutateResult) => {
          // The assignment WAS created server-side regardless of whether
          // this session has since been abandoned, so invalidation runs
          // unconditionally — only the close below is session-gated.
          invalidateStaffList();
          if (onMutateResult?.sessionId !== sessionRef.current) return;
          onOpenChange(false);
        },
        onError: (_error, _vars, onMutateResult) => {
          if (onMutateResult?.sessionId !== sessionRef.current) return;
          setExistingError(true);
        },
      },
    );
  }

  function handleCreateSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = createStaffSchema.safeParse({ email, password, role });
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
    setCreateFlowError(null);

    createUser.mutate(
      { body: { email: parsed.data.email, password: parsed.data.password, role: parsed.data.role } },
      {
        onSuccess: (createdUser, _vars, onMutateResult) => {
          // The account WAS created server-side regardless of session —
          // invalidate the tenant-users list unconditionally so a later
          // reopen's existing-mode tab offers this user as a candidate even
          // if the assign step below fails.
          void queryClient.invalidateQueries({ queryKey: ["get", "/api/users"] });

          assignAfterCreate.mutate(
            { params: { path: { event_id: eventId } }, body: { user_id: createdUser.id } },
            {
              onSuccess: () => {
                invalidateStaffList();
                if (onMutateResult?.sessionId !== sessionRef.current) return;
                onOpenChange(false);
              },
              onError: () => {
                if (onMutateResult?.sessionId !== sessionRef.current) return;
                // Honesty (reconciliation): the user now EXISTS — this must
                // never read like a plain "couldn't create" failure.
                setCreateFlowError({ kind: "assign", email: createdUser.email });
              },
            },
          );
        },
        onError: (error, _vars, onMutateResult) => {
          if (onMutateResult?.sessionId !== sessionRef.current) return;
          setCreateFlowError({ kind: "create", message: error instanceof ApiError ? error.message : undefined });
        },
      },
    );
  }

  const assignedIds = new Set((staffQuery.data ?? []).map((u) => u.id));
  const candidates = (tenantUsersQuery.data ?? []).filter((u) => !assignedIds.has(u.id));
  const candidatesLoading = tenantUsersQuery.isLoading || staffQuery.isLoading;
  const candidatesError = tenantUsersQuery.isError || staffQuery.isError;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        closeLabel={t("createEventCancel")}
        hideClose={isPending}
        onEscapeKeyDown={preventDialogDismiss}
        onPointerDownOutside={preventDialogDismiss}
        onInteractOutside={preventDialogDismiss}
      >
        <DialogHeader>
          <DialogTitle>{t("staffAddTitle")}</DialogTitle>
        </DialogHeader>

        {isAdmin ? (
          <div className="flex gap-2" role="group" aria-label={t("staffAddTitle")}>
            <Button
              type="button"
              size="sm"
              variant={mode === "existing" ? "default" : "outline"}
              aria-pressed={mode === "existing"}
              onClick={() => setMode("existing")}
            >
              {t("staffAddExistingTab")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mode === "create" ? "default" : "outline"}
              aria-pressed={mode === "create"}
              onClick={() => setMode("create")}
            >
              {t("staffAddCreateTab")}
            </Button>
          </div>
        ) : null}

        {mode === "existing" ? (
          <form className="flex flex-col gap-4" onSubmit={handleExistingSubmit}>
            {candidatesLoading ? (
              <p className="text-body text-muted-foreground">{t("staffAddCandidatesLoading")}</p>
            ) : candidatesError ? (
              <p className="text-body text-destructive">{t("staffAddCandidatesLoadError")}</p>
            ) : candidates.length === 0 ? (
              <p className="text-body text-muted-foreground">{t("staffAddNoCandidates")}</p>
            ) : (
              <fieldset className="flex max-h-64 flex-col overflow-y-auto">
                <legend className="mb-1 text-caption text-muted-foreground">{t("staffAddExistingLabel")}</legend>
                <RadioGroup
                  value={selectedUserId ?? undefined}
                  onValueChange={(value) => {
                    setSelectedUserId(value);
                    setExistingError(false);
                  }}
                >
                  {candidates.map((candidate: StaffUser) => (
                    <label
                      key={candidate.id}
                      htmlFor={`add-staff-candidate-${candidate.id}`}
                      className="flex cursor-pointer items-center gap-2 rounded-md border border-border p-2 has-[[data-state=checked]]:border-primary"
                    >
                      <RadioGroupItem id={`add-staff-candidate-${candidate.id}`} value={candidate.id} />
                      <span className="flex flex-col">
                        <span className="text-body">{candidate.email}</span>
                        <span className="text-caption text-muted-foreground">{t(ROLE_LABEL_KEYS[candidate.role])}</span>
                      </span>
                    </label>
                  ))}
                </RadioGroup>
              </fieldset>
            )}
            {existingError ? <p className="text-body text-destructive">{t("staffAddAssignError")}</p> : null}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={isPending} onClick={() => handleOpenChange(false)}>
                {t("createEventCancel")}
              </Button>
              <Button type="submit" disabled={isPending || !selectedUserId}>
                {t("staffAddSubmit")}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <form className="flex flex-col gap-4" onSubmit={handleCreateSubmit}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="add-staff-email">{t("staffAddEmailLabel")}</Label>
              <Input
                id="add-staff-email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setCreateFlowError(null);
                }}
              />
              {fieldErrors.email ? <p className="text-caption text-destructive">{t(fieldErrors.email)}</p> : null}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="add-staff-password">{t("staffAddPasswordLabel")}</Label>
              <Input
                id="add-staff-password"
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setCreateFlowError(null);
                }}
              />
              {fieldErrors.password ? <p className="text-caption text-destructive">{t(fieldErrors.password)}</p> : null}
            </div>
            <fieldset className="flex flex-col gap-2">
              <legend className="text-caption text-muted-foreground">{t("staffAddRoleLabel")}</legend>
              <RadioGroup
                className="flex gap-4"
                value={role}
                onValueChange={(value) => setRole(value as CreateRole)}
              >
                {(["staff", "manager"] as const).map((candidateRole) => (
                  <label
                    key={candidateRole}
                    htmlFor={`add-staff-role-${candidateRole}`}
                    className="flex items-center gap-2"
                  >
                    <RadioGroupItem id={`add-staff-role-${candidateRole}`} value={candidateRole} />
                    <span>{t(ROLE_LABEL_KEYS[candidateRole])}</span>
                  </label>
                ))}
              </RadioGroup>
            </fieldset>
            {createFlowError ? (
              <p className="text-body text-destructive">
                {createFlowError.kind === "assign"
                  ? t("staffAddAssignFailed", { email: createFlowError.email })
                  : createFlowError.message ?? t("staffAddCreateError")}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={isPending} onClick={() => handleOpenChange(false)}>
                {t("createEventCancel")}
              </Button>
              <Button type="submit" disabled={isPending}>
                {t("staffAddCreateSubmit")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
