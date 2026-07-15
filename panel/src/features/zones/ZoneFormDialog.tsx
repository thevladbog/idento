import {
  Button, cn, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input, Label,
} from "@idento/ui";
import { useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { useEventZonesWithStats, ZONES_KEY } from "./hooks";
import {
  ZONE_COLOR_CLASSES, ZONE_COLOR_KEYS, zoneColorKey, type ZoneColorKey,
} from "./zoneColors";
import { $api } from "../../shared/api/query";
import type { components } from "../../shared/api/schema";

type EventZone = components["schemas"]["EventZone"];

// zod schema stores a message KEY (not a translated string) — same
// convention as CreateEventDialog.tsx / AddAttendeeDialog.tsx, translated via
// `t()` at render time.
const zoneFormSchema = z.object({
  name: z.string().trim().min(1, "zonesFormNameRequired"),
});

// Accessible name per swatch (WCAG 1.4.1: the swatch's color is never the
// only way to identify it — the radio's aria-label carries the real name,
// and the selected swatch also renders a check icon rather than relying on a
// border/ring color alone).
const ZONE_COLOR_NAME_KEYS: Record<ZoneColorKey, string> = {
  green: "zonesFormColorGreen",
  amber: "zonesFormColorAmber",
  blue: "zonesFormColorBlue",
  slate: "zonesFormColorSlate",
};

export interface ZoneFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  // Absent => create mode. Present => edit mode, prefilled from this zone.
  zone?: EventZone;
}

// Handles BOTH create and edit — Task 3 brief's explicit file-structure call:
// one dialog component for both modes, not two near-duplicate files. Create
// POSTs /api/events/{event_id}/zones with a fixed-default body (order_index
// computed as max existing + 1, zone_type "general", everything else
// inactive/false until the rule builder (Task 4) or a later edit changes it).
// Edit PUTs /api/zones/{id} — a FULL REPLACE endpoint (confirmed against
// backend/openapi.yaml's updateEventZone: omitted fields are blanked
// server-side) — so the body must carry every field from the fetched `zone`
// verbatim, with only `name` and `settings` (spread-merged so foreign keys
// survive) actually edited.
export function ZoneFormDialog({
  open, onOpenChange, eventId, zone,
}: ZoneFormDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  // Reused for the create-mode order_index/default-color computation. Same
  // query key as ZonesPage's own useEventZonesWithStats call — when this
  // dialog opens from that page the data is already cached, so this is a
  // no-op subscribe, not a fresh round trip in the common case.
  const zonesQuery = useEventZonesWithStats(eventId);
  const isEdit = zone !== undefined;

  // Monotonically-incrementing session id, bumped on every close — same
  // create/cancel-race pattern as AddAttendeeDialog.tsx's createSessionRef:
  // `.reset()` on close only detaches the mutation observer, it doesn't
  // cancel the in-flight request or stop a late onSuccess from closing a
  // dialog session the user has already backed out of.
  const sessionRef = React.useRef(0);
  const createZone = $api.useMutation("post", "/api/events/{event_id}/zones", {
    onMutate: () => ({ sessionId: sessionRef.current }),
  });
  const updateZone = $api.useMutation("put", "/api/zones/{id}", {
    onMutate: () => ({ sessionId: sessionRef.current }),
  });
  const mutation = isEdit ? updateZone : createZone;

  const [name, setName] = React.useState("");
  const [color, setColor] = React.useState<ZoneColorKey>("green");
  const [nameError, setNameError] = React.useState<string | undefined>(undefined);
  const colorButtonRefs = React.useRef<Partial<Record<ZoneColorKey, HTMLButtonElement | null>>>({});

  // Tracks whether the CURRENT dialog session (this open transition, or this
  // edit target) has already derived its initial field values — re-running
  // the derivation on every zonesQuery background refetch would stomp on
  // in-progress edits inside an already-open dialog. Reset whenever a new
  // session begins (dialog opens, or which zone we're editing changes).
  const initializedRef = React.useRef(false);
  React.useEffect(() => {
    initializedRef.current = false;
  }, [open, zone?.id]);

  React.useEffect(() => {
    if (!open || initializedRef.current) return;
    if (zone) {
      setName(zone.name);
      setColor(zoneColorKey(zone));
      setNameError(undefined);
      initializedRef.current = true;
      return;
    }
    // Create mode's default color depends on the zones list — wait for it to
    // SUCCEED rather than momentarily defaulting from the `[]` fallback.
    // `isSuccess`, not `!isLoading`: under TanStack Query v5, isLoading is
    // `isPending && isFetching`, so a fetch that settles to ERROR leaves
    // isLoading false while `data` is still undefined — deriving (and
    // locking, via initializedRef) defaults from the fallback there would
    // fabricate order_index 0 / color "green" regardless of what actually
    // exists server-side.
    if (!zonesQuery.isSuccess) return;
    setName("");
    const zones = zonesQuery.data ?? [];
    const usedColors = new Set(zones.map((entry) => zoneColorKey(entry.zone)));
    // First key not used by an existing zone; "green" (ZONE_COLOR_KEYS[0])
    // when all four are already used, or when there are no zones yet.
    setColor(ZONE_COLOR_KEYS.find((key) => !usedColors.has(key)) ?? ZONE_COLOR_KEYS[0]);
    setNameError(undefined);
    initializedRef.current = true;
  }, [open, zone, zonesQuery.data, zonesQuery.isSuccess]);

  // Reset both mutations whenever the dialog transitions closed, so a failed
  // attempt never leaks a stale server-error banner into the next open —
  // same pattern as CreateEventDialog.tsx/AddAttendeeDialog.tsx.
  React.useEffect(() => {
    if (open) return;
    sessionRef.current += 1;
    createZone.reset();
    updateZone.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Wraps onOpenChange for every Radix dismiss path (X/Escape/outside-click)
  // plus the Cancel button below — while the request is genuinely in
  // flight, blocking dismissal outright is simpler and more honest than
  // racing the session-ref guard alone (mirrors AddAttendeeDialog.tsx).
  function handleOpenChange(next: boolean) {
    if (!next && mutation.isPending) return;
    onOpenChange(next);
  }

  function preventDialogDismiss(e: Event) {
    if (mutation.isPending) e.preventDefault();
  }

  function clearServerErrorIfNeeded() {
    if (mutation.isError) mutation.reset();
  }

  function selectColor(key: ZoneColorKey) {
    setColor(key);
    clearServerErrorIfNeeded();
  }

  // Roving-tabindex radio-group keyboard nav (WAI-ARIA authoring practices
  // for role="radiogroup"): arrow keys move both focus and selection among
  // the 4 swatches, wrapping at the ends.
  function handleColorKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, key: ZoneColorKey) {
    const currentIndex = ZONE_COLOR_KEYS.indexOf(key);
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % ZONE_COLOR_KEYS.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (currentIndex - 1 + ZONE_COLOR_KEYS.length) % ZONE_COLOR_KEYS.length;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    const nextKey = ZONE_COLOR_KEYS[nextIndex];
    selectColor(nextKey);
    colorButtonRefs.current[nextKey]?.focus();
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = zoneFormSchema.safeParse({ name });
    if (!parsed.success) {
      setNameError(parsed.error.issues[0]?.message);
      return;
    }
    setNameError(undefined);
    const trimmedName = parsed.data.name;

    if (zone) {
      // FULL REPLACE: every field from the fetched zone verbatim, only name
      // and settings (spread-merged so foreign keys survive) are edited.
      updateZone.mutate(
        {
          params: { path: { id: zone.id } },
          body: {
            name: trimmedName,
            zone_type: zone.zone_type,
            order_index: zone.order_index,
            open_time: zone.open_time,
            close_time: zone.close_time,
            is_registration_zone: zone.is_registration_zone,
            requires_registration: zone.requires_registration,
            is_active: zone.is_active,
            settings: { ...zone.settings, color },
          },
        },
        {
          onSuccess: (_data, _vars, onMutateResult) => {
            void queryClient.invalidateQueries({ queryKey: ZONES_KEY(eventId) });
            if (onMutateResult?.sessionId !== sessionRef.current) return;
            onOpenChange(false);
          },
        },
      );
      return;
    }

    const zones = zonesQuery.data ?? [];
    const maxOrderIndex = zones.reduce((max, entry) => Math.max(max, entry.zone.order_index), -1);
    createZone.mutate(
      {
        params: { path: { event_id: eventId } },
        body: {
          name: trimmedName,
          zone_type: "general",
          order_index: maxOrderIndex + 1,
          is_active: true,
          is_registration_zone: false,
          requires_registration: false,
          settings: { color },
        },
      },
      {
        onSuccess: (_data, _vars, onMutateResult) => {
          void queryClient.invalidateQueries({ queryKey: ZONES_KEY(eventId) });
          if (onMutateResult?.sessionId !== sessionRef.current) return;
          onOpenChange(false);
        },
      },
    );
  }

  const colorLabelId = React.useId();
  // Create mode's default order_index/color both depend on zonesQuery — a
  // submit before the list has SUCCESSFULLY loaded (still in flight, or
  // settled to error — ZonesPage's header "+ New zone" button renders even
  // in the list's error state) would compute the body from the `[]`
  // fallback, silently violating the `<max existing + 1>` order_index
  // invariant. `isSuccess`, not `!isLoading` — see the derivation effect
  // above for why an errored fetch slips past an isLoading gate. Not a risk
  // in edit mode, which never reads zonesQuery for its body.
  const submitDisabled = mutation.isPending || (!isEdit && !zonesQuery.isSuccess);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        closeLabel={t("workspaceDialogClose")}
        hideClose={mutation.isPending}
        onEscapeKeyDown={preventDialogDismiss}
        onPointerDownOutside={preventDialogDismiss}
        onInteractOutside={preventDialogDismiss}
      >
        <DialogHeader>
          <DialogTitle>{t(isEdit ? "zonesFormEditTitle" : "zonesFormCreateTitle")}</DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="zone-form-name">{t("zonesFormNameLabel")}</Label>
            <Input
              id="zone-form-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                clearServerErrorIfNeeded();
              }}
            />
            {nameError ? <p className="text-caption text-destructive">{t(nameError)}</p> : null}
          </div>
          <div className="flex flex-col gap-2">
            <Label id={colorLabelId}>{t("zonesFormColorLabel")}</Label>
            <div role="radiogroup" aria-labelledby={colorLabelId} className="flex gap-2">
              {ZONE_COLOR_KEYS.map((key) => {
                const selected = key === color;
                return (
                  <button
                    key={key}
                    ref={(el) => {
                      colorButtonRefs.current[key] = el;
                    }}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={t(ZONE_COLOR_NAME_KEYS[key])}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => selectColor(key)}
                    onKeyDown={(e) => handleColorKeyDown(e, key)}
                    className={cn(
                      "flex size-8 items-center justify-center rounded-full border-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      ZONE_COLOR_CLASSES[key],
                      selected ? "border-foreground" : "border-transparent",
                    )}
                  >
                    {selected ? <Check aria-hidden className="size-4 text-background" /> : null}
                  </button>
                );
              })}
            </div>
          </div>
          {/* Why submit is disabled in create mode when the zones list fetch
              failed (reuses the page's existing zonesLoadError copy) — the
              defaults derive from that list, so submitting without it would
              fabricate order_index/color. Edit mode never reads the list. */}
          {!isEdit && zonesQuery.isError ? (
            <p className="text-body text-destructive">{t("zonesLoadError")}</p>
          ) : null}
          {mutation.isError ? <p className="text-body text-destructive">{t("zonesFormServerError")}</p> : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => handleOpenChange(false)}
            >
              {t("createEventCancel")}
            </Button>
            <Button type="submit" disabled={submitDisabled}>
              {t(isEdit ? "zonesFormSubmitEdit" : "zonesFormSubmitCreate")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
