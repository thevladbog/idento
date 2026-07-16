import {
  Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input,
} from "@idento/ui";
import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { STANDARD_FIELD_KEYS } from "../../attendees/import/wizardState";
import { $api } from "../../../shared/api/query";
import type { components } from "../../../shared/api/schema";

type ApiEvent = components["schemas"]["Event"];

export interface AttendeeFieldsCardProps {
  event: ApiEvent;
}

// Each editable row gets a stable, locally-generated id (NOT the row's
// index) so React doesn't recycle the wrong <input>'s internal state (focus,
// IME composition, etc.) when an earlier row is removed and every later row
// shifts up an index. The id never leaves this component — it's stripped
// back down to a plain `string[]` (`row.value`) before validation or the
// PATCH body.
interface FieldRow {
  id: number;
  value: string;
}

// A header collides with a standard field per bulk_import.go's own
// lowercasing (the same P2.1 lesson wizardState.ts's validateMapping already
// encodes) — compare case-insensitively against STANDARD_FIELD_KEYS, the
// single source of truth Task 10 extracted from wizardState.ts.
const STANDARD_FIELD_KEYS_LOWER = new Set(STANDARD_FIELD_KEYS.map((key) => key.toLowerCase()));

// One message key per row (or `null` when that row is valid), computed
// against the CURRENT (trimmed) values of every row so duplicate detection
// sees the full picture, not just pairwise. Priority per row: blank first
// (nothing else about a blank name is worth reporting), then a collision
// with a standard field, then a collision with another custom row — matches
// wizardState.ts's validateMapping precedent of flagging every colliding
// header, not just the second one, so the operator isn't left guessing which
// row "won".
function computeFieldErrors(values: string[]): (string | null)[] {
  const trimmedLower = values.map((value) => value.trim().toLowerCase());
  const countByLower = new Map<string, number>();
  for (const lower of trimmedLower) {
    if (lower === "") continue;
    countByLower.set(lower, (countByLower.get(lower) ?? 0) + 1);
  }

  return values.map((value, index) => {
    if (value.trim() === "") return "settingsFieldsBlankError";
    const lower = trimmedLower[index];
    if (STANDARD_FIELD_KEYS_LOWER.has(lower)) return "settingsFieldsReservedError";
    if ((countByLower.get(lower) ?? 0) > 1) return "settingsFieldsDuplicateError";
    return null;
  });
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

// Board 6a's Attendee-fields card: a plain, reorder-free list of the
// event's custom field_schema names — add / inline-rename / remove, all
// LOCAL until one scoped Save PATCHes the FULL array (never a partial diff;
// `field_schema` has no per-item PATCH semantics, only whole-array replace).
export function AttendeeFieldsCard({ event }: AttendeeFieldsCardProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const nextRowIdRef = React.useRef(0);

  function freshRows(fields: string[]): FieldRow[] {
    return fields.map((value) => ({ id: nextRowIdRef.current++, value }));
  }

  const [baseline, setBaseline] = React.useState<string[]>(() => event.field_schema ?? []);
  const [rows, setRows] = React.useState<FieldRow[]>(() => freshRows(event.field_schema ?? []));
  const [newFieldValue, setNewFieldValue] = React.useState("");
  const [saved, setSaved] = React.useState(false);
  const savedTimeoutRef = React.useRef<number | undefined>(undefined);
  // Same race class + fix as GeneralCard.tsx:81 — `patchEvent.reset()` on
  // every edit only clears the mutation OBSERVER's local state, it does NOT
  // cancel an in-flight PATCH or stop its `onSuccess` from firing when a
  // stale response lands late. Captured at mutate-time via `onMutate`,
  // compared exactly in `onSuccess`: a mismatch means the user edited again
  // after clicking Save but before the response arrived, so that (now-stale)
  // response must not clobber the newer, still-unsaved edit.
  const editVersionRef = React.useRef(0);

  React.useEffect(() => () => window.clearTimeout(savedTimeoutRef.current), []);

  const patchEvent = $api.useMutation("patch", "/api/events/{id}", {
    onMutate: () => ({ editVersion: editVersionRef.current }),
    onSuccess: (updated, _vars, onMutateResult) => {
      void queryClient.invalidateQueries({
        queryKey: ["get", "/api/events/{id}", { params: { path: { id: event.id } } }],
      });
      if (onMutateResult?.editVersion !== editVersionRef.current) return;
      const next = updated.field_schema ?? [];
      setBaseline(next);
      setRows(freshRows(next));
      setSaved(true);
      window.clearTimeout(savedTimeoutRef.current);
      savedTimeoutRef.current = window.setTimeout(() => setSaved(false), 2000);
    },
  });

  function bumpEdit() {
    editVersionRef.current += 1;
    setSaved(false);
    // Stale mutation state (a prior save's error) must not persist across a
    // new edit — same rule GeneralCard applies.
    patchEvent.reset();
  }

  function handleRename(id: number, value: string) {
    bumpEdit();
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, value } : row)));
  }

  function handleRemove(id: number) {
    bumpEdit();
    setRows((prev) => prev.filter((row) => row.id !== id));
  }

  function handleAdd() {
    const value = newFieldValue.trim();
    if (value === "") return;
    bumpEdit();
    setRows((prev) => [...prev, { id: nextRowIdRef.current++, value }]);
    setNewFieldValue("");
  }

  const values = rows.map((row) => row.value);
  const effectiveValues = values.map((value) => value.trim());
  const fieldErrors = computeFieldErrors(values);
  const isValid = fieldErrors.every((error) => error === null);
  const isDirty = !arraysEqual(effectiveValues, baseline);
  const saveDisabled = !isDirty || !isValid || patchEvent.isPending;

  function handleSave() {
    if (saveDisabled) return;
    patchEvent.mutate({ params: { path: { id: event.id } }, body: { field_schema: effectiveValues } });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settingsFieldsNav")}</CardTitle>
        <CardDescription>{t("settingsFieldsSubtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {rows.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {rows.map((row, index) => (
              <li key={row.id} className="flex items-start gap-2">
                <div className="flex flex-1 flex-col gap-1">
                  <Input
                    aria-label={t("settingsFieldsRowLabel", { position: index + 1 })}
                    value={row.value}
                    onChange={(e) => handleRename(row.id, e.target.value)}
                  />
                  {fieldErrors[index] ? (
                    <p className="text-caption text-destructive">{t(fieldErrors[index] as string)}</p>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  onClick={() => handleRemove(row.id)}
                >
                  {t("settingsFieldsRemove")}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-body text-muted-foreground">{t("settingsFieldsEmpty")}</p>
        )}

        <p className="text-caption text-muted-foreground">{t("settingsFieldsRemoveNote")}</p>

        <div className="flex items-center gap-2">
          <Input
            aria-label={t("settingsFieldsAddLabel")}
            placeholder={t("settingsFieldsAddPlaceholder")}
            value={newFieldValue}
            onChange={(e) => setNewFieldValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAdd();
              }
            }}
          />
          <Button type="button" variant="outline" disabled={newFieldValue.trim() === ""} onClick={handleAdd}>
            {t("settingsFieldsAdd")}
          </Button>
        </div>

        {patchEvent.isError ? <p className="text-body text-destructive">{t("settingsSaveError")}</p> : null}
        <div className="flex items-center gap-3">
          <Button type="button" disabled={saveDisabled} onClick={handleSave}>
            {t("settingsSave")}
          </Button>
          {saved ? <span className="text-caption text-muted-foreground">{t("settingsSaved")}</span> : null}
        </div>
      </CardContent>
    </Card>
  );
}
