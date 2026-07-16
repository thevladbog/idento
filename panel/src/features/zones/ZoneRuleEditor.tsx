import {
  Button, Input, Skeleton, cn,
} from "@idento/ui";
import { useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { ZONE_RULES_KEY, ZONES_KEY, useZoneAccessRules } from "./hooks";
import { $api } from "../../shared/api/query";
import type { components } from "../../shared/api/schema";

type ZoneAccessRule = components["schemas"]["ZoneAccessRule"];

interface Clause {
  id: string;
  value: string;
}

// A rule is "simple" — representable by the sentence UI's editable clauses
// — only when it's a plain category-allow with no time window. Anything
// else (allowed: false, or either time bound set) can't be expressed by
// "Access when [Category] is [value]" and MUST survive the PUT's
// delete-and-replace semantics verbatim, or it's silently destroyed the
// next time this zone's rules are saved — the exact failure mode this task
// exists to prevent (task brief, reconciliation #6).
function isSimpleRule(rule: ZoneAccessRule): boolean {
  return rule.allowed === true && !rule.time_from && !rule.time_to;
}

export interface ZoneRuleEditorProps {
  eventId: string;
  zoneId: string;
  // Fired only on a SUCCESSFUL save — the parent (ZonesPage) collapses the
  // row in response. A failed save deliberately does NOT call this: the
  // editor stays open with the error shown so the user's typed clauses
  // aren't lost.
  onSaved: () => void;
  // Lets the parent block opening a DIFFERENT zone's editor while this one
  // has unsaved edits (shows `zonesRulesUnsavedHint`) — see ZonesPage.tsx's
  // `requestExpand`.
  onDirtyChange: (dirty: boolean) => void;
  // Lets the parent gate its own controls for THIS row (the access-type
  // text's collapse toggle, and the row's `⋯` menu) while the PUT is
  // pending — the busy-gating audit this task's brief calls out as P2.1's
  // hardest lesson.
  onBusyChange: (busy: boolean) => void;
}

// Board 6b's inline OR-rule builder — Task 4. Renders the "simple" rules
// (plain category allow-rules) as an editable OR-of-clauses sentence UI,
// and any "complex" rules (deny rules, or time-windowed ones) as a
// read-only passthrough list. The PUT endpoint is delete-and-replace of the
// zone's ENTIRE rule set (backend deletes all rules then inserts the
// submitted array) — so every save resubmits both the edited simple
// clauses AND the untouched complex rules verbatim, or the complex ones
// would be silently destroyed.
export function ZoneRuleEditor({
  eventId, zoneId, onSaved, onDirtyChange, onBusyChange,
}: ZoneRuleEditorProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const rulesQuery = useZoneAccessRules(zoneId);

  const [clauses, setClauses] = React.useState<Clause[]>([]);
  const [complexRules, setComplexRules] = React.useState<ZoneAccessRule[]>([]);
  const [dirty, setDirty] = React.useState(false);
  const nextClauseIdRef = React.useRef(0);

  function nextClauseId(): string {
    nextClauseIdRef.current += 1;
    return `clause-${nextClauseIdRef.current}`;
  }

  function deriveFromFetched(rules: readonly ZoneAccessRule[]) {
    const simple = rules.filter(isSimpleRule);
    const complex = rules.filter((rule) => !isSimpleRule(rule));
    setClauses(simple.map((rule) => ({ id: nextClauseId(), value: rule.category })));
    setComplexRules(complex);
  }

  // Derives the editable clause list from the fetched rules exactly once
  // per zone — an `initializedRef` guard (same pattern as
  // ZoneFormDialog.tsx's create/edit field derivation) stops a background
  // refetch of the rules query from clobbering in-progress edits inside an
  // already-open editor. Reset whenever the target zone changes (only one
  // editor is ever mounted at a time, but this keeps the component correct
  // if that ever changes).
  const initializedRef = React.useRef(false);
  React.useEffect(() => {
    initializedRef.current = false;
  }, [zoneId]);

  React.useEffect(() => {
    if (initializedRef.current) return;
    if (!rulesQuery.isSuccess) return;
    deriveFromFetched(rulesQuery.data ?? []);
    setDirty(false);
    initializedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rulesQuery.isSuccess, rulesQuery.data]);

  React.useEffect(() => {
    onDirtyChange(dirty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

  // No session-ref guard here (contrast AddAttendeeDialog.tsx/
  // ZoneFormDialog.tsx's create/update mutations) — that pattern protects
  // against a dialog being dismissed and reopened for a NEW target while
  // its mutation is still in flight, so a late onSuccess doesn't act on the
  // wrong session. Here `onBusyChange` below makes the PUT's pending window
  // block every dismiss path for THIS row (Save, Cancel, the row's own
  // collapse toggle, and its `⋯` menu — ZonesPage.tsx) and blocks opening a
  // DIFFERENT zone's editor while this one is dirty/busy, so the analogous
  // race — this component unmounting while its own save is in flight — is
  // structurally impossible via any in-app control.
  const saveRules = $api.useMutation("put", "/api/zones/{zone_id}/access-rules", {
    onSuccess: () => {
      // The response is only `{message}` — never setQueryData; both caches
      // this screen depends on (this zone's own rules, and the zones list
      // whose access-type text reads `access_rules_count`) are invalidated
      // instead.
      void queryClient.invalidateQueries({ queryKey: ZONE_RULES_KEY(zoneId) });
      void queryClient.invalidateQueries({ queryKey: ZONES_KEY(eventId) });
      setDirty(false);
      onSaved();
    },
  });

  React.useEffect(() => {
    onBusyChange(saveRules.isPending);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveRules.isPending]);

  function isBlank(value: string): boolean {
    return value.trim() === "";
  }

  const trimmedValueCounts = new Map<string, number>();
  for (const clause of clauses) {
    const trimmed = clause.value.trim();
    if (trimmed) trimmedValueCounts.set(trimmed, (trimmedValueCounts.get(trimmed) ?? 0) + 1);
  }

  function isDuplicate(value: string): boolean {
    const trimmed = value.trim();
    return trimmed !== "" && (trimmedValueCounts.get(trimmed) ?? 0) > 1;
  }

  // PR #66 review (P2): zone_access_rules has a UNIQUE index on
  // (zone_id, category) — backend/migrations/000010_event_zones.up.sql:40 —
  // and the PUT is delete-and-replace of the WHOLE set, so a simple clause
  // duplicating a read-only advanced (deny/time-windowed) rule's category
  // fails the entire save wholesale. Exact match on the RAW trimmed value
  // (case-sensitive — the index is on the raw column, so "Staff" and
  // "staff" genuinely coexist) against the passthrough rules already held
  // in component state.
  const advancedCategories = new Set(complexRules.map((rule) => rule.category));

  function isAdvancedDuplicate(value: string): boolean {
    const trimmed = value.trim();
    return trimmed !== "" && advancedCategories.has(trimmed);
  }

  const hasInvalidClause = clauses.some(
    (clause) => isBlank(clause.value) || isDuplicate(clause.value) || isAdvancedDuplicate(clause.value),
  );

  function updateClauseValue(id: string, value: string) {
    setClauses((prev) => prev.map((clause) => (clause.id === id ? { ...clause, value } : clause)));
    setDirty(true);
    if (saveRules.isError) saveRules.reset();
  }

  function addClause() {
    setClauses((prev) => [...prev, { id: nextClauseId(), value: "" }]);
    setDirty(true);
    if (saveRules.isError) saveRules.reset();
  }

  function removeClause(id: string) {
    setClauses((prev) => prev.filter((clause) => clause.id !== id));
    setDirty(true);
    if (saveRules.isError) saveRules.reset();
  }

  function handleCancel() {
    if (saveRules.isPending) return;
    if (saveRules.isError) saveRules.reset();
    deriveFromFetched(rulesQuery.data ?? []);
    setDirty(false);
  }

  function handleSave() {
    if (saveRules.isPending || hasInvalidClause) return;
    const simpleBody = clauses.map((clause) => ({ category: clause.value.trim(), allowed: true as const }));
    const complexBody = complexRules.map((rule) => ({
      category: rule.category,
      allowed: rule.allowed,
      time_from: rule.time_from ?? null,
      time_to: rule.time_to ?? null,
    }));
    saveRules.mutate({
      params: { path: { zone_id: zoneId } },
      body: [...simpleBody, ...complexBody],
    });
  }

  // Describes a complex rule's window/denial for the read-only list —
  // composed from small translated fragments (rather than one opaque
  // pre-built string) so both en.json and ru.json carry real, grammatical
  // translations for every case, not just the container template.
  function describeAdvancedRule(rule: ZoneAccessRule): string {
    let windowText: string | null = null;
    if (rule.time_from && rule.time_to) {
      windowText = t("zonesRulesAdvancedWindow", { from: rule.time_from, to: rule.time_to });
    } else if (rule.time_from) {
      windowText = t("zonesRulesAdvancedFrom", { from: rule.time_from });
    } else if (rule.time_to) {
      windowText = t("zonesRulesAdvancedTo", { to: rule.time_to });
    }
    if (!rule.allowed) {
      return windowText ? `${t("zonesRulesAdvancedDenied")} · ${windowText}` : t("zonesRulesAdvancedDenied");
    }
    // Reaching here with allowed === true means this rule was classified
    // complex by isSimpleRule solely because a time bound is set — a
    // window is therefore guaranteed non-null.
    return windowText ?? "";
  }

  if (rulesQuery.isLoading) {
    return (
      <div className="flex flex-col gap-2" data-testid="zone-rules-loading">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-2/3" />
      </div>
    );
  }

  // Never edit over unverifiable state (P2.1 honesty rule) — a failed
  // rules fetch renders error copy only, with no editable surface at all,
  // so a save here can never silently submit an empty or stale array over
  // rules this screen couldn't actually confirm.
  if (rulesQuery.isError) {
    return <p className="text-body text-destructive">{t("zonesRulesFetchError")}</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        {clauses.length === 0 && complexRules.length === 0 ? (
          <p className="text-caption text-muted-foreground">{t("zonesRulesNoConditions")}</p>
        ) : null}
        {clauses.map((clause, index) => {
          const advancedCollision = isAdvancedDuplicate(clause.value);
          const invalid = isBlank(clause.value) || isDuplicate(clause.value) || advancedCollision;
          return (
            <div key={clause.id} className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="text-body text-muted-foreground">{t("zonesRulesSentenceWhen")}</span>
                <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-caption font-medium text-muted-foreground">
                  {t("zonesRulesCategoryChip")}
                </span>
                <span className="text-body text-muted-foreground">{t("zonesRulesSentenceIs")}</span>
                <Input
                  aria-label={t("zonesRulesValueInputLabel", { index: index + 1 })}
                  aria-invalid={invalid}
                  value={clause.value}
                  placeholder={t("zonesRulesValuePlaceholder")}
                  disabled={saveRules.isPending}
                  onChange={(e) => updateClauseValue(clause.id, e.target.value)}
                  className={cn("max-w-xs", invalid && "border-destructive")}
                />
                <button
                  type="button"
                  aria-label={t("zonesRulesRemoveClause", { index: index + 1 })}
                  disabled={saveRules.isPending}
                  className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => removeClause(clause.id)}
                >
                  <X aria-hidden className="size-4" />
                </button>
              </div>
              {/* Dedicated per-clause message (PR #66 review, P2) — this
                  collision has its own copy because the generic
                  zonesRulesValidationHint ("remove duplicates") points at
                  the EDITABLE clauses; here the conflicting rule is in the
                  read-only advanced list below, which the user can't edit
                  from this UI at all. */}
              {advancedCollision ? (
                <p className="text-caption text-destructive">{t("zonesRulesDuplicateAdvanced")}</p>
              ) : null}
            </div>
          );
        })}
        {/* Disabled while a save is pending, same as every other edit
            surface here — the clauses/complexRules a pending PUT is
            actually sending were captured at click-time (handleSave), so
            letting the user keep adding/removing/typing during that window
            would let them believe further edits are part of the in-flight
            save when they're actually not: a successful save collapses the
            editor via `onSaved`, silently discarding anything typed after
            the click. */}
        <Button
          type="button"
          variant="outline"
          className="self-start"
          disabled={saveRules.isPending}
          onClick={addClause}
        >
          {t("zonesRulesAddClause")}
        </Button>
        {hasInvalidClause ? (
          <p className="text-caption text-destructive">{t("zonesRulesValidationHint")}</p>
        ) : null}
      </div>

      {complexRules.length > 0 ? (
        <div className="flex flex-col gap-1 rounded-md border border-border bg-muted/40 p-2">
          <span className="text-caption font-medium uppercase text-muted-foreground">
            {t("zonesRulesAdvancedHeading")}
          </span>
          <ul className="flex flex-col gap-1">
            {complexRules.map((rule) => (
              <li key={rule.id} className="text-caption text-muted-foreground">
                {t("zonesRulesAdvanced", { category: rule.category, detail: describeAdvancedRule(rule) })}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {saveRules.isError ? <p className="text-body text-destructive">{t("zonesRulesServerError")}</p> : null}

      <div className="flex gap-2">
        <Button type="button" variant="outline" disabled={saveRules.isPending} onClick={handleCancel}>
          {t("createEventCancel")}
        </Button>
        <Button type="button" disabled={saveRules.isPending || hasInvalidClause} onClick={handleSave}>
          {t("zonesRulesSaveAction")}
        </Button>
      </div>
    </div>
  );
}
