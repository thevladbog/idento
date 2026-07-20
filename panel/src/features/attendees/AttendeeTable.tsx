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
            <li
              key={row.id}
              onClick={() => onRowClick(row.id)}
              onKeyDown={(e) => {
                // Only react when the row itself (not a nested focusable
                // child — the checkbox or the row-menu button, each
                // independently focusable/activatable) is what received the
                // key: without this guard, Space/Enter on the checkbox would
                // bubble up and ALSO trigger the row's own activation on top
                // of the checkbox's native toggle.
                if (e.target !== e.currentTarget) return;
                if (e.key === "Enter" || e.key === " ") {
                  // Space's default is page-scroll; Enter has no default
                  // here, but preventDefault on both is harmless.
                  e.preventDefault();
                  onRowClick(row.id);
                }
              }}
              tabIndex={0}
              role="button"
              aria-label={t("attendeesRowOpenLabel", { name: fullName })}
              className={`${ROW_GRID} cursor-pointer px-3.5 py-2 text-caption hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${isSelected ? "bg-success/5" : ""}`}
            >
              <Checkbox
                checked={isSelected}
                onCheckedChange={() => onToggle(row.id)}
                onClick={(e) => e.stopPropagation()}
                aria-label={t("attendeesSelectAttendeeLabel", { name: fullName })}
              />
              <div className="flex flex-col">
                <span className="font-medium text-body text-foreground">{fullName}</span>
                <span className="font-mono text-caption text-muted-foreground">{row.code}</span>
              </div>
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
                  the <li>'s onClick), a different, unexpected action.
                  tabIndex={-1} + aria-hidden pull it out of the tab order
                  and accessibility tree entirely — pure decoration, not a
                  working control — while a native MOUSE click on it still
                  bubbles to the <li>'s onClick unchanged, preserving "click
                  anywhere on the row, including this cell, opens the
                  drawer". Revisit both once a real per-row menu exists
                  (attendeesRowMenuLabel is kept in en.json/ru.json for
                  that). */}
              <button type="button" tabIndex={-1} aria-hidden="true" className="text-muted-foreground">
                ⋯
              </button>
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
