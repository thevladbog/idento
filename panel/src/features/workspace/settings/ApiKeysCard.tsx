import {
  Button, Card, CardContent, CardHeader, CardTitle, CardDescription, ConfirmDialog, Dialog, DialogContent,
  DialogFooter, DialogHeader, DialogTitle, Input, Label, Skeleton, StatusPill, cn,
} from "@idento/ui";
import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { $api } from "../../../shared/api/query";
import type { components } from "../../../shared/api/schema";

type APIKey = components["schemas"]["APIKey"];

export interface ApiKeysCardProps {
  eventId: string;
}

// Shared between the header row and each key row so the header labels stay
// pixel-aligned with their columns (Name / masked key preview / Created /
// Last used / Actions).
const KEY_ROW_GRID = "grid grid-cols-[1fr_180px_100px_100px_90px] items-center gap-3";

// UTC calendar date, same convention GeneralCard.tsx/FontsCard.tsx use for
// date-only display of a full timestamp.
function formatUtcDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

// Board 6a's API keys card: a table-ish list (Name / masked key preview /
// created / last-used / actions — Scope is dropped, the API has no such
// field) plus a "+ Create key" affordance whose dialog swaps into a
// show-once reveal state on success. No expiry picker in P1.2 — the API
// accepts `expires_at` but the board doesn't show a picker for it and it's
// explicit YAGNI per the task brief; only `name` is collected here.
export function ApiKeysCard({ eventId }: ApiKeysCardProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [revokeTarget, setRevokeTarget] = React.useState<APIKey | null>(null);
  const [revokeError, setRevokeError] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [plainKey, setPlainKey] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const copiedTimeoutRef = React.useRef<number | undefined>(undefined);
  // Monotonically-incrementing session id, bumped every time the create
  // dialog closes for any reason (Cancel/X/Escape/overlay).
  // `createKey.reset()` on close only detaches the mutation observer — it
  // does NOT cancel the in-flight request or stop `onSuccess` from firing
  // when the response lands late. A plain boolean re-armed on every reopen
  // isn't enough: a SECOND cancel-then-reopen cycle can let a stale response
  // from the FIRST (already-abandoned) request pass the guard again once
  // it's reset to false on reopen. An incrementing id captured at
  // mutate-time (via `onMutate`) and compared exactly in `onSuccess` means a
  // reopen never "un-stales" a response tied to a previously-closed session
  // — every close permanently invalidates all in-flight responses from
  // before it.
  const createSessionRef = React.useRef(0);

  React.useEffect(() => () => window.clearTimeout(copiedTimeoutRef.current), []);

  const listQueryKey = ["get", "/api/events/{event_id}/api-keys", { params: { path: { event_id: eventId } } }] as const;

  const keysQuery = $api.useQuery("get", "/api/events/{event_id}/api-keys", {
    params: { path: { event_id: eventId } },
  });

  const revokeKey = $api.useMutation("delete", "/api/events/{event_id}/api-keys/{key_id}", {
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: listQueryKey });
      setRevokeError(false);
      setRevokeTarget(null);
    },
    onError: () => {
      // Close the dialog so the inline error below is actually visible
      // (it lives in the card, behind the modal overlay while open), and
      // leave revokeTarget's key un-revoked in the list.
      setRevokeError(true);
      setRevokeTarget(null);
    },
  });

  const createKey = $api.useMutation("post", "/api/events/{event_id}/api-keys", {
    onMutate: () => ({ sessionId: createSessionRef.current }),
    onSuccess: (created, _vars, onMutateResult) => {
      void queryClient.invalidateQueries({ queryKey: listQueryKey });
      // See createSessionRef above: if the dialog was closed (and possibly
      // reopened) since this particular request was submitted, its session
      // id no longer matches the current one, and the secret must never be
      // shown.
      if (onMutateResult?.sessionId !== createSessionRef.current) return;
      setPlainKey(created.plain_key);
    },
  });

  // Reset all create-dialog state on the open->closed transition — the
  // secret must never survive a close (P1.1 mutation-reset-on-close rule,
  // re-confirmed for Task 4/5's dialogs), and reopening must show a fresh
  // form rather than a stale error or the previous reveal.
  React.useEffect(() => {
    if (createOpen) return;
    // Any response still in flight from the closed session is now
    // permanently stale — a later reopen gets a new session id, so it can
    // never match again.
    createSessionRef.current += 1;
    setName("");
    setPlainKey(null);
    setCopied(false);
    window.clearTimeout(copiedTimeoutRef.current);
    createKey.reset();
    // createKey is a fresh mutation object each render; including it in the
    // deps would reset on every render instead of only on close.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createOpen]);

  function handleCreateSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = name.trim();
    createKey.mutate({
      params: { path: { event_id: eventId } },
      body: trimmed ? { name: trimmed } : {},
    });
  }

  function handleCopy() {
    if (!plainKey) return;
    // Await the write and only claim success once it actually resolves — a
    // rejected clipboard write (e.g. permission blocked) must not flip the
    // button to "Copied" and mislead the user into thinking the one-time
    // secret made it onto their clipboard.
    navigator.clipboard.writeText(plainKey).then(
      () => {
        setCopied(true);
        window.clearTimeout(copiedTimeoutRef.current);
        copiedTimeoutRef.current = window.setTimeout(() => setCopied(false), 2000);
      },
      () => {
        // Leave `copied` false — no distinct failure-state i18n key exists
        // for this yet, and adding one is more than this fix warrants.
      },
    );
  }

  const keys = keysQuery.data ?? [];

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t("settingsApiKeys")}</CardTitle>
          <CardDescription>{t("settingsApiKeysSubtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {keysQuery.isLoading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : keysQuery.isError ? (
            <p className="text-body text-destructive">{t("settingsLoadError")}</p>
          ) : keys.length > 0 ? (
            <div className="flex flex-col">
              <div className={cn(KEY_ROW_GRID, "border-b border-border pb-2 text-caption font-medium text-muted-foreground")}>
                <span>{t("settingsKeyName")}</span>
                <span />
                <span>{t("settingsKeyCreatedAt")}</span>
                <span>{t("settingsKeyLastUsed")}</span>
                <span />
              </div>
              <ul className="flex flex-col divide-y divide-border">
                {keys.map((key) => {
                  const revoked = Boolean(key.revoked_at);
                  return (
                    <li
                      key={key.id}
                      className={cn(KEY_ROW_GRID, "py-3", revoked && "opacity-50")}
                    >
                      <span className="text-body font-medium">{key.name}</span>
                      <code className="w-fit rounded bg-muted px-2 py-1 font-mono text-caption">{key.key_preview}</code>
                      <span className="text-caption text-muted-foreground">{formatUtcDate(key.created_at)}</span>
                      <span className="text-caption text-muted-foreground">
                        {key.last_used_at ? formatUtcDate(key.last_used_at) : "—"}
                      </span>
                      <div className="flex justify-end">
                        {revoked ? (
                          <StatusPill status="error" label={t("settingsKeyRevoked")} />
                        ) : (
                          <Button
                            type="button"
                            variant="link"
                            className="text-destructive"
                            onClick={() => {
                              setRevokeError(false);
                              setRevokeTarget(key);
                            }}
                          >
                            {t("settingsKeyRevoke")}
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <p className="text-body text-muted-foreground">{t("settingsKeysEmpty")}</p>
          )}

          {revokeError ? <p className="text-body text-destructive">{t("settingsKeyRevokeError")}</p> : null}

          <div className="flex flex-col items-start gap-2">
            <Button type="button" onClick={() => setCreateOpen(true)}>
              {t("settingsKeyCreate")}
            </Button>
            <p className="text-caption text-muted-foreground">{t("settingsKeyShownOnce")}</p>
          </div>
        </CardContent>
      </Card>

      {revokeTarget ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setRevokeTarget(null);
          }}
          title={t("settingsKeyRevokeTitle")}
          description={t("settingsKeyRevokeBody")}
          confirmLabel={t("settingsKeyRevokeConfirm")}
          cancelLabel={t("createEventCancel")}
          closeLabel={t("workspaceDialogClose")}
          destructive
          confirmDisabled={revokeKey.isPending}
          onConfirm={() =>
            revokeKey.mutate({
              params: { path: { event_id: eventId, key_id: revokeTarget.id } },
            })
          }
        />
      ) : null}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent closeLabel={t("workspaceDialogClose")}>
          {plainKey ? (
            <>
              <DialogHeader>
                <DialogTitle>{t("settingsKeyCreate")}</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-3">
                <code className="break-all rounded-md border border-border bg-muted p-3 font-mono text-body">
                  {plainKey}
                </code>
                <Button type="button" variant="outline" onClick={handleCopy}>
                  {copied ? t("settingsKeyCopied") : t("settingsKeyCopy")}
                </Button>
                <p className="text-caption text-warning">{t("settingsKeyRevealWarning")}</p>
              </div>
              <DialogFooter>
                <Button type="button" onClick={() => setCreateOpen(false)}>
                  {t("settingsKeyDone")}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>{t("settingsKeyCreate")}</DialogTitle>
              </DialogHeader>
              <form className="flex flex-col gap-4" onSubmit={handleCreateSubmit}>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="api-key-name">{t("settingsKeyName")}</Label>
                  <Input id="api-key-name" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                {createKey.isError ? (
                  <p className="text-body text-destructive">{t("settingsKeyCreateError")}</p>
                ) : null}
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                    {t("createEventCancel")}
                  </Button>
                  <Button type="submit" disabled={createKey.isPending}>
                    {t("settingsKeyCreate")}
                  </Button>
                </DialogFooter>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
