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
  // Set false whenever the create dialog is open (i.e. the in-flight
  // create's response is still relevant) and true the moment it closes for
  // any reason (Cancel/X/Escape/overlay). `createKey.reset()` on close only
  // detaches the mutation observer — it does NOT cancel the in-flight
  // request or stop `onSuccess` from firing when the response lands late.
  // Without this guard, a close-before-response race would let a stray
  // `plain_key` sneak into `plainKey` state and resurface unlabeled the
  // next time the dialog is opened.
  const createAbortedRef = React.useRef(false);

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
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: listQueryKey });
      // See createAbortedRef above: if the dialog was closed before this
      // response arrived, the secret must never be shown.
      if (createAbortedRef.current) return;
      setPlainKey(created.plain_key);
    },
  });

  // Reset all create-dialog state on the open->closed transition — the
  // secret must never survive a close (P1.1 mutation-reset-on-close rule,
  // re-confirmed for Task 4/5's dialogs), and reopening must show a fresh
  // form rather than a stale error or the previous reveal.
  React.useEffect(() => {
    if (createOpen) {
      createAbortedRef.current = false;
      return;
    }
    createAbortedRef.current = true;
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
    void navigator.clipboard.writeText(plainKey);
    setCopied(true);
    window.clearTimeout(copiedTimeoutRef.current);
    copiedTimeoutRef.current = window.setTimeout(() => setCopied(false), 2000);
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
            <ul className="flex flex-col divide-y divide-border">
              {keys.map((key) => {
                const revoked = Boolean(key.revoked_at);
                return (
                  <li
                    key={key.id}
                    className={cn(
                      "grid grid-cols-[1fr_180px_100px_100px_90px] items-center gap-3 py-3",
                      revoked && "opacity-50",
                    )}
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
