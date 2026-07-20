import {
  Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Checkbox, ConfirmDialog, Skeleton, StatusPill, cn,
} from "@idento/ui";
import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { $api } from "../../../shared/api/query";
import type { components } from "../../../shared/api/schema";

type FontListItem = components["schemas"]["FontListItem"];

export interface FontsCardProps {
  eventId: string;
}

// Simplest honest size humanizer for the metadata caption — KB below 1 MiB,
// MB above. No locale-aware Intl.NumberFormat is warranted here; a plain
// fixed-point KB/MB split matches the board's "filename · size · ..." copy.
function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// UTC calendar date, same convention GeneralCard.tsx documents/uses for
// date-only display of a full timestamp.
function formatUtcDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

function stripExtension(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx > 0 ? filename.slice(0, idx) : filename;
}

// Board 6a's Fonts card: a plain list of uploaded fonts (name, UPLOADED
// pill, metadata caption) plus a dashed drop-zone that uploads immediately
// on file pick — no separate "confirm upload" step, no drag-and-drop
// library (YAGNI per the task brief; click-to-pick via the native file
// input is enough for P1.2). name/family are derived from the filename
// (extension stripped) as the simplest honest default; a real font-family
// manager is a later phase.
export function FontsCard({ eventId }: FontsCardProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [removeTarget, setRemoveTarget] = React.useState<FontListItem | null>(null);
  const [deleteError, setDeleteError] = React.useState(false);
  const [uploadError, setUploadError] = React.useState(false);
  // Real consent gate: the upload body's `license_accepted` flag is
  // meaningless if it's sent unconditionally regardless of whether the user
  // actually acknowledged the notice below — this tracks the checkbox the
  // user must explicitly check before the upload affordance is usable.
  const [licenseAccepted, setLicenseAccepted] = React.useState(false);

  const listQueryKey = ["get", "/api/events/{event_id}/fonts", { params: { path: { event_id: eventId } } }] as const;

  const fontsQuery = $api.useQuery("get", "/api/events/{event_id}/fonts", {
    params: { path: { event_id: eventId } },
  });

  const deleteFont = $api.useMutation("delete", "/api/events/{event_id}/fonts/{font_id}", {
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: listQueryKey });
      setDeleteError(false);
      setRemoveTarget(null);
    },
    onError: () => {
      // Close the dialog so the inline error below is actually visible (it
      // lives in the card, behind the modal overlay while open), and leave
      // removeTarget's font un-deleted in the list — same shape as
      // ApiKeysCard's revokeKey.onError.
      setDeleteError(true);
      setRemoveTarget(null);
    },
  });

  const uploadFont = $api.useMutation("post", "/api/events/{event_id}/fonts", {
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: listQueryKey });
    },
    onError: () => {
      setUploadError(true);
    },
  });

  function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset the input so picking the same filename again still fires onChange.
    e.target.value = "";
    if (!file) return;
    setUploadError(false);
    const derived = stripExtension(file.name);
    uploadFont.mutate({
      params: { path: { event_id: eventId } },
      // The generated request-body type models the multipart `file` field as
      // `string` (openapi-typescript's mapping for `format: binary`), but the
      // real value we hold is a `File` — cast through `unknown` here and back
      // in `bodySerializer` below, which is the only place the value is
      // actually read.
      body: {
        file: file as unknown as string,
        name: derived,
        family: derived,
        // Wired from real state rather than a hardcoded literal — the
        // upload input is disabled unless `licenseAccepted` is true (see
        // below), so this mutation is only ever reachable when it's "true",
        // but the value itself must still reflect the actual consent state
        // for correctness/clarity rather than lying by construction.
        license_accepted: licenseAccepted ? "true" : "false",
      },
      // Multipart investigation (verified against the INSTALLED
      // node_modules/openapi-fetch/src/index.js@0.17.0, not assumed):
      // 1. `bodySerializer` IS a supported per-call option — coreFetch()
      //    destructures it from the object passed to `.mutate()`/the client
      //    method call (`bodySerializer = globalBodySerializer ??
      //    defaultBodySerializer` from `fetchOptions`) and calls it with
      //    `(body, mergedHeaders)` to produce `serializedBody`.
      // 2. Returning a `FormData` instance requires NO manual Content-Type
      //    removal. coreFetch() itself special-cases this
      //    (`serializedBody instanceof FormData ? {} : { "Content-Type":
      //    "application/json" }` when building `finalHeaders`) — it simply
      //    never adds the JSON header when the body is FormData, rather than
      //    adding-then-relying-on-a-null-header-unset. Passing
      //    `headers: { "Content-Type": null }` (the brief's fallback sketch)
      //    is therefore unnecessary here; the browser's `Request`/`fetch`
      //    computes the correct `multipart/form-data; boundary=...` header
      //    on its own once no Content-Type is present in `requestInit`.
      // 3. This project's `dynamicBaseUrl` middleware (shared/api/http.ts)
      //    re-wraps every outgoing Request to rewrite its origin. It copies
      //    `request.headers` as-is (already carrying the browser-computed
      //    boundary) and re-reads the body via
      //    `request.clone().arrayBuffer()` — i.e. the already-multipart-
      //    encoded raw bytes, not a re-serialization — so the boundary and
      //    body stay in sync through that rewrite.
      bodySerializer: (body) => {
        const fd = new FormData();
        fd.append("file", body.file as unknown as File);
        fd.append("name", body.name);
        fd.append("family", body.family);
        fd.append("license_accepted", body.license_accepted);
        return fd;
      },
    });
  }

  const fonts = fontsQuery.data ?? [];

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t("settingsFonts")}</CardTitle>
          <CardDescription>{t("settingsFontsSubtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {fontsQuery.isLoading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : fontsQuery.isError ? (
            <p className="text-body text-destructive">{t("settingsLoadError")}</p>
          ) : fonts.length > 0 ? (
            <ul className="flex flex-col divide-y divide-border">
              {fonts.map((font) => (
                <li key={font.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="text-body font-medium">{font.name}</span>
                      <StatusPill status="ready" label={t("settingsFontUploaded")} />
                    </div>
                    <p className="text-caption text-muted-foreground">
                      {font.format} · {formatSize(font.size)} · {formatUtcDate(font.created_at)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="link"
                    className="text-destructive"
                    onClick={() => {
                      setDeleteError(false);
                      setRemoveTarget(font);
                    }}
                  >
                    {t("settingsFontRemove")}
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-body text-muted-foreground">{t("settingsFontsEmpty")}</p>
          )}

          {deleteError ? <p className="text-body text-destructive">{t("settingsFontRemoveError")}</p> : null}

          <label
            htmlFor="fonts-card-license-accepted"
            className="flex cursor-pointer items-start gap-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-caption text-warning"
          >
            <Checkbox
              id="fonts-card-license-accepted"
              className="mt-0.5 shrink-0"
              checked={licenseAccepted}
              onCheckedChange={(checked) => setLicenseAccepted(checked === true)}
            />
            <span>{t("settingsFontLicense")}</span>
          </label>

          <label
            htmlFor="fonts-card-upload"
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border p-6 text-center text-body text-muted-foreground",
              (uploadFont.isPending || !licenseAccepted) && "cursor-not-allowed opacity-60",
            )}
          >
            {uploadFont.isPending ? (
              <span>{t("settingsFontUploading")}</span>
            ) : (
              <span>
                {t("settingsFontDropHint")} <span className="font-medium text-primary">{t("settingsFontBrowse")}</span>
              </span>
            )}
            <input
              id="fonts-card-upload"
              type="file"
              accept=".ttf,.otf,.woff,.woff2"
              className="sr-only"
              disabled={uploadFont.isPending || !licenseAccepted}
              // The wrapping <label>'s visible text includes the "Browse…"
              // trigger too, but the input's accessible name is scoped to
              // just the drop hint via aria-label (aria-label outranks a
              // wrapping <label> for accessible-name computation).
              aria-label={t("settingsFontDropHint")}
              onChange={handleFilePick}
            />
          </label>
          {uploadError ? <p className="text-body text-destructive">{t("settingsFontUploadError")}</p> : null}
        </CardContent>
      </Card>

      {removeTarget ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setRemoveTarget(null);
          }}
          title={t("settingsFontRemoveTitle")}
          description={t("settingsFontRemoveBody", { name: removeTarget.name })}
          confirmLabel={t("settingsFontRemoveConfirm")}
          cancelLabel={t("createEventCancel")}
          closeLabel={t("workspaceDialogClose")}
          destructive
          confirmDisabled={deleteFont.isPending}
          onConfirm={() =>
            deleteFont.mutate({
              params: { path: { event_id: eventId, font_id: removeTarget.id } },
            })
          }
        />
      ) : null}
    </>
  );
}
