import { Checkbox, StatusPill } from "@idento/ui";
import { CheckCircle2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { pageItems } from "./pageItems";
import type { components } from "../../shared/api/schema";

type Attendee = components["schemas"]["Attendee"];

export interface AttendeeTableProps {
  rows: Attendee[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onRowClick: (id: string) => void;
}

// Board 1g's dense attendee grid: checkbox / Name / Company / Zone access /
// Badge / Status / trailing row-menu — `34px 1.3fr 1fr 150px 110px 130px 40px`.
const ROW_GRID = "grid grid-cols-[34px_1.3fr_1fr_150px_110px_130px_40px] items-center gap-3";

export function AttendeeTable({ rows, selected, onToggle, onToggleAll, onRowClick }: AttendeeTableProps) {
  const { t } = useTranslation();
  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.id));

  return (
    <div data-testid="attendee-table" className="overflow-hidden rounded-[10px] border border-border bg-card">
      <div
        className={`${ROW_GRID} border-b border-border bg-muted/40 px-3.5 py-2 text-caption font-medium uppercase text-muted-foreground`}
      >
        <Checkbox
          checked={allSelected}
          onCheckedChange={() => onToggleAll()}
          aria-label={t("attendeesSelectAllLabel")}
        />
        <span>{t("attendeesColName")}</span>
        <span>{t("attendeesColCompany")}</span>
        <span>{t("attendeesColZones")}</span>
        <span>{t("attendeesColBadge")}</span>
        <span>{t("attendeesColStatus")}</span>
        <span />
      </div>
      <ul className="flex flex-col divide-y divide-border">
        {rows.map((row) => {
          const fullName = `${row.first_name} ${row.last_name}`.trim();
          const isSelected = selected.has(row.id);
          return (
            // The row-open affordance lives on a real <button> (below), not
            // on this wrapping <div>/<li>: a11y audit
            // (jsx-a11y/no-noninteractive-element-to-interactive-role) —
            // <li>'s implicit role is `listitem`, and AT list-navigation
            // (e.g. "list of N items") relies on that; role="button" on
            // either the <li> or a <div> wrapping the WHOLE row (checkbox
            // included) used to pull every row out of list semantics AND
            // (found live by the P5.3.3 axe-core/playwright sweep) nest a
            // genuinely interactive Checkbox inside a role="button"
            // ancestor — axe's `nested-interactive` (WCAG 4.1.2): "Element
            // has focusable descendants". Restructured so the open action is
            // a real, independent <button> sibling of the Checkbox — not an
            // ancestor of it — while this outer <div> keeps only a plain
            // (non-role, non-focusable) onClick so "click anywhere on the
            // row" still works for mouse users exactly as before.
            <li key={row.id}>
              {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions --
                  This div's onClick is a pure MOUSE-convenience affordance
                  (bubble target for "click anywhere on the row"), not the
                  row's accessible interaction surface — that's the real
                  <Checkbox> and <button> children below, each independently
                  focusable/keyboard-operable on their own. Both jsx-a11y
                  rules assume a clickable non-interactive element must ALSO
                  be the keyboard entry point, which doesn't apply here since
                  keyboard/AT users already have full equivalent access via
                  those two real controls. */}
              <div
                onClick={() => onRowClick(row.id)}
                className={`${ROW_GRID} cursor-pointer px-3.5 py-2 text-caption hover:bg-muted/30 ${isSelected ? "bg-success/5" : ""}`}
              >
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => onToggle(row.id)}
                  onClick={(e) => e.stopPropagation()}
                  aria-label={t("attendeesSelectAttendeeLabel", { name: fullName })}
                />
                <button
                  type="button"
                  onClick={(e) => {
                    // Without this, the click would ALSO bubble to the row
                    // div's own onClick above and call onRowClick a second
                    // time (harmless in practice — same id, same handler —
                    // but wasteful and easy to trip up on later).
                    e.stopPropagation();
                    onRowClick(row.id);
                  }}
                  aria-label={t("attendeesRowOpenLabel", { name: fullName })}
                  className="flex flex-col items-start rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="font-medium text-body text-foreground">{fullName}</span>
                  <span className="font-mono text-caption text-muted-foreground">{row.code}</span>
                </button>
                <span className="text-muted-foreground">{row.company}</span>
                {/* Zone access is a separate per-attendee resource (not present
                    on the Attendee row itself) — fetching it here would mean
                    firing up to `per_page` (50) parallel zone-access queries on
                    every page load. Deliberate v1 scope cut: this column is a
                    static placeholder in the table; the real per-attendee zone
                    list is fetched on demand in the drawer (Task 8), which only
                    ever needs one attendee's zones at a time. */}
                <span className="text-muted-foreground">—</span>
                <span>
                  {row.printed_count > 0 ? (
                    <StatusPill status="ready" label={t("attendeesBadgePrinted")} />
                  ) : (
                    <StatusPill status="empty" label={t("attendeesBadgeNotPrinted")} />
                  )}
                </span>
                <span>
                  {row.checkin_status ? (
                    // WCAG 1.4.1: status is icon + text + color together, never
                    // color alone — mirrors WorkspaceRail/ReadinessCell's
                    // status vocabulary.
                    <span className="inline-flex items-center gap-1 text-success">
                      <CheckCircle2 aria-hidden className="size-3.5" />
                      {t("attendeesStatusCheckedIn")}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">{t("attendeesStatusNotCheckedIn")}</span>
                  )}
                </span>
                {/* Fix (Codex, PR #65): previously exposed role=button (native
                    <button> default) plus an aria-label announcing "row menu"
                    — but with no handler of its own and no stopPropagation, a
                    keyboard/screen-reader user who activated the ADVERTISED
                    menu control landed on the drawer instead (via bubbling to
                    the row's onClick), a different, unexpected action.
                    Follow-up fix (P5.3.3 axe-core/playwright sweep):
                    tabIndex={-1} + aria-hidden on a real <button> still
                    tripped axe's `nested-interactive` (WCAG 4.1.2) — a
                    genuine interactive element nested inside the row's own
                    role="button" isn't reliably hidden from every assistive
                    technology by aria-hidden alone (axe's own message: a
                    negative tabindex "does not prevent assistive
                    technologies from focusing the element"). Since this is
                    still pure decoration with no handler of its own, a plain
                    <span> removes the illegal nesting outright — a native
                    MOUSE click on it still bubbles to the row's onClick
                    unchanged, preserving "click anywhere on the row,
                    including this cell, opens the drawer". Revisit once a
                    real per-row menu exists (attendeesRowMenuLabel is kept in
                    en.json/ru.json for that). */}
                <span aria-hidden="true" className="text-muted-foreground">
                  ⋯
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export interface AttendeePagerProps {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

// Board 1g's pagination footer: "1–50 of N" + a numbered pager with
// ellipsis truncation. The active-page pill reuses the same dark-fill
// treatment (`bg-foreground text-background`) the board's dark bulk-bar/
// active-pill uses elsewhere on this screen.
export function AttendeePager({ page, perPage, total, totalPages, onPageChange }: AttendeePagerProps) {
  const { t } = useTranslation();
  const from = (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);
  const items = pageItems(page, totalPages);

  return (
    <div className="flex items-center justify-between border-t border-border px-3.5 py-2.5 text-caption text-muted-foreground">
      <span>{t("attendeesPageOf", { from, to, total })}</span>
      <nav aria-label={t("attendeesPaginationLabel")} className="flex items-center gap-1">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label={t("attendeesPagePrev")}
          className="flex size-7 items-center justify-center rounded-md hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
        >
          ‹
        </button>
        {items.map((item, index) =>
          item === "…" ? (
            // Ellipsis markers have no stable identity of their own; index
            // is fine here since the surrounding page-number buttons already
            // have stable (page-number) keys.
            <span key={`ellipsis-${index}`} className="px-1" aria-hidden>
              …
            </span>
          ) : (
            <button
              key={item}
              type="button"
              aria-current={item === page ? "page" : undefined}
              onClick={() => onPageChange(item)}
              className={`flex size-7 items-center justify-center rounded-md ${
                item === page ? "bg-foreground text-background" : "hover:bg-muted"
              }`}
            >
              {item}
            </button>
          ),
        )}
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          aria-label={t("attendeesPageNext")}
          className="flex size-7 items-center justify-center rounded-md hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
        >
          ›
        </button>
      </nav>
    </div>
  );
}
