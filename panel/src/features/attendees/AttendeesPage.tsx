import {
  Button, EmptyState, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Skeleton,
} from "@idento/ui";
import { getRouteApi } from "@tanstack/react-router";
import { Users } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { AddAttendeeDialog } from "./AddAttendeeDialog";
import { AttendeeDrawer } from "./AttendeeDrawer";
import { AttendeePager, AttendeeTable } from "./AttendeeTable";
import { BulkBar } from "./BulkBar";
import { useAttendeesPage, useEventZones } from "./hooks";
import { ImportWizard } from "./import/ImportWizard";
import { zoneIdentity } from "../../shared/lib/zoneIdentity";
import type { AttendeesSearch } from "./searchParams";

type AttendeeStatus = NonNullable<AttendeesSearch["status"]>;

// Radix's Select throws if any SelectItem has value="" — these sentinels
// stand in for the "All zones"/"Any status" options (which used to be a
// native <option value="">) and are mapped back to `undefined` at the
// onValueChange boundary, so `search.zone`/`search.status` (and therefore
// the outgoing query params) are unchanged from before this migration.
const ZONE_FILTER_ALL = "__all";
const STATUS_FILTER_ANY = "__all";

// Same rationale as EventWorkspaceLayout.tsx / WorkspaceOverview.tsx:
// `getRouteApi` with the route's string id avoids a circular import with
// app/router.tsx (which imports this component for the route's `component`).
const routeApi = getRouteApi("/_app/events/$eventId/attendees");

const PER_PAGE = 50;
const SEARCH_DEBOUNCE_MS = 250;

// Board 1g — the attendees list/table screen: header (title + plain mono
// total), search + Zone/Status filters, dense server-paginated table, empty
// states. Selection state (checkboxes) is owned here and threaded into
// AttendeeTable so Task 6's bulk-select bar can consume it without this
// page's shape changing again.
export function AttendeesPage() {
  const { t } = useTranslation();
  const { eventId } = routeApi.useParams();
  const search = routeApi.useSearch();
  const navigate = routeApi.useNavigate();

  const page = search.page ?? 1;

  // Local input state gives the search box instant keystroke feedback;
  // the URL (and therefore the actual query, via useAttendeesPage) only
  // updates SEARCH_DEBOUNCE_MS after the user stops typing, so fast typing
  // doesn't fire a request per keystroke.
  const [searchInput, setSearchInput] = React.useState(search.search ?? "");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [addAttendeeOpen, setAddAttendeeOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);

  // Keep the local input in sync when the URL's `search` param changes from
  // outside this input (e.g. the "clear filters" link, or back/forward nav).
  React.useEffect(() => {
    setSearchInput(search.search ?? "");
  }, [search.search]);

  React.useEffect(() => {
    const trimmed = searchInput.trim();
    if (trimmed === (search.search ?? "")) return;
    const timeoutId = window.setTimeout(() => {
      void navigate({ search: (prev) => ({ ...prev, search: trimmed || undefined, page: 1 }) });
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- debounce timer keys off searchInput only; navigate/search.search are read fresh inside the closure.
  }, [searchInput]);

  const attendeesQuery = useAttendeesPage(eventId, {
    page,
    perPage: PER_PAGE,
    search: search.search,
    zone: search.zone,
    status: search.status,
  });
  const zonesQuery = useEventZones(eventId);

  const hasActiveFilters = Boolean(search.search || search.zone || search.status);

  function updateFilter(patch: { zone?: string; status?: AttendeeStatus }) {
    void navigate({ search: (prev) => ({ ...prev, ...patch, page: 1 }) });
  }

  function clearFilters() {
    setSearchInput("");
    void navigate({ search: (prev) => ({ attendee: prev.attendee, page: 1 }) });
  }

  function goToPage(target: number) {
    void navigate({ search: (prev) => ({ ...prev, page: target }) });
  }

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    const rows = attendeesQuery.data?.attendees ?? [];
    setSelected((prev) => {
      const allSelected = rows.length > 0 && rows.every((row) => prev.has(row.id));
      const next = new Set(prev);
      for (const row of rows) {
        if (allSelected) next.delete(row.id);
        else next.add(row.id);
      }
      return next;
    });
  }

  function openAttendee(id: string) {
    void navigate({ search: (prev) => ({ ...prev, attendee: id }) });
  }

  // Task 8's drawer close affordance: same "spread prev, set the one key to
  // undefined" pattern as clearFilters/updateFilter above, so closing the
  // drawer clears only `attendee` and leaves page/search/zone/status
  // untouched — TanStack Router's default search serializer drops
  // `undefined` keys from the URL, so this doesn't leave a stray
  // `?attendee=` behind.
  function closeAttendee() {
    void navigate({ search: (prev) => ({ ...prev, attendee: undefined }) });
  }

  const rows = attendeesQuery.data?.attendees ?? [];
  // Derived, not a second piece of state: once a selected id's row falls
  // out of the current page (e.g. after a bulk delete invalidates and
  // refetches the list), it silently drops out of the bar's count too,
  // rather than needing an explicit onClear call from BulkBar.
  const selectedAttendees = rows.filter((row) => selected.has(row.id));
  const total = attendeesQuery.data?.total;
  const totalPages = attendeesQuery.data ? Math.max(1, Math.ceil(attendeesQuery.data.total / attendeesQuery.data.per_page)) : 0;

  // An out-of-range `page` — the current page's rows are empty but the
  // event has attendees overall (`total > 0`) — is reachable organically:
  // deleting the last row(s) on a non-first page via either BulkBar's bulk
  // delete or AttendeeDrawer's single delete invalidates and refetches the
  // list without resetting `page`, so the backend correctly returns
  // `{attendees: [], total: N}` for a page that's now past the end (same
  // thing can happen from editing `?page=` directly). Auto-clamp back to
  // the true last page here, via the same navigate-on-derived-state pattern
  // the search-debounce effect above already uses, so this state is never
  // visibly rendered as the canonical "No attendees yet" empty state next
  // to a nonzero header total.
  React.useEffect(() => {
    if (!attendeesQuery.data) return;
    if (attendeesQuery.data.attendees.length > 0 || attendeesQuery.data.total === 0) return;
    const lastPage = Math.max(1, Math.ceil(attendeesQuery.data.total / attendeesQuery.data.per_page));
    if (page !== lastPage) {
      void navigate({ search: (prev) => ({ ...prev, page: lastPage }) });
    }
  }, [attendeesQuery.data, page, navigate]);

  // Mirrors the effect above: while data has landed showing an out-of-range
  // page (empty rows, nonzero total), render the loading skeleton for the
  // one tick before the clamp effect's navigate takes effect, rather than
  // ever falling into the "no attendees"/"no matches" branches below with a
  // dataset that contradicts the header total.
  const isOutOfRangePage = Boolean(attendeesQuery.data && attendeesQuery.data.attendees.length === 0 && attendeesQuery.data.total > 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-page-title">{t("attendeesTitle")}</h2>
          {attendeesQuery.isLoading ? (
            <Skeleton className="h-4 w-8" data-testid="attendees-total-skeleton" />
          ) : total !== undefined ? (
            <span className="font-mono text-caption text-muted-foreground">{total}</span>
          ) : null}
        </div>

        <input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder={t("attendeesSearchPlaceholder")}
          aria-label={t("attendeesSearchPlaceholder")}
          className="h-9 w-[230px] rounded-md border border-input bg-card px-3 text-body text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />

        <Select
          value={search.zone || ZONE_FILTER_ALL}
          onValueChange={(next) => updateFilter({ zone: next === ZONE_FILTER_ALL ? undefined : next })}
        >
          <SelectTrigger variant="pill" aria-label={t("attendeesZoneFilterLabel")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ZONE_FILTER_ALL}>{t("attendeesZoneFilterAll")}</SelectItem>
            {(zonesQuery.data ?? []).map((entry) => {
              const zone = zoneIdentity(entry);
              return (
                <SelectItem key={zone.id} value={zone.id}>
                  {zone.name}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>

        <Select
          value={search.status || STATUS_FILTER_ANY}
          onValueChange={(next) =>
            updateFilter({ status: next === STATUS_FILTER_ANY ? undefined : (next as AttendeeStatus) })
          }
        >
          <SelectTrigger variant="pill" aria-label={t("attendeesStatusFilterLabel")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={STATUS_FILTER_ANY}>{t("attendeesStatusFilterAny")}</SelectItem>
            <SelectItem value="checked_in">{t("attendeesStatusCheckedIn")}</SelectItem>
            <SelectItem value="not_checked_in">{t("attendeesStatusNotCheckedIn")}</SelectItem>
          </SelectContent>
        </Select>

        <div className="ml-auto flex items-center gap-2">
          {/* Import CSV opens the wizard to step 1 (Task 11); the wizard's
              own steps 2-3 (column mapping, chunked import) land in Tasks
              12-13. + Add attendee is wired by Task 7. */}
          <Button type="button" variant="outline" onClick={() => setImportOpen(true)}>
            {t("attendeesImportCsv")}
          </Button>
          <Button type="button" onClick={() => setAddAttendeeOpen(true)}>
            {t("attendeesAdd")}
          </Button>
        </div>
      </div>

      {attendeesQuery.isLoading ? (
        <AttendeesTableSkeleton />
      ) : attendeesQuery.isError ? (
        <div className="flex flex-col items-start gap-2 rounded-lg border border-border p-6">
          <p className="text-body text-destructive">{t("attendeesLoadError")}</p>
          <Button type="button" variant="outline" onClick={() => attendeesQuery.refetch()}>
            {t("retry")}
          </Button>
        </div>
      ) : isOutOfRangePage ? (
        <AttendeesTableSkeleton />
      ) : total === 0 && !hasActiveFilters ? (
        <EmptyState
          icon={Users}
          title={t("attendeesEmptyTitle")}
          description={t("attendeesEmptyBody")}
          actions={
            <>
              <Button type="button" onClick={() => setImportOpen(true)}>
                {t("attendeesEmptyImportAction")}
              </Button>
              <Button type="button" variant="outline" onClick={() => setAddAttendeeOpen(true)}>
                {t("attendeesEmptyAddAction")}
              </Button>
            </>
          }
        />
      ) : total === 0 && hasActiveFilters ? (
        <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-border p-6">
          <p className="text-body text-muted-foreground">{t("attendeesNoMatches")}</p>
          <Button type="button" variant="link" className="h-auto p-0 font-normal" onClick={clearFilters}>
            {t("attendeesClearFilters")}
          </Button>
        </div>
      ) : (
        <>
          {selectedAttendees.length > 0 ? (
            <BulkBar selected={selectedAttendees} eventId={eventId} onClear={() => setSelected(new Set())} />
          ) : null}
          <AttendeeTable rows={rows} selected={selected} onToggle={toggleRow} onToggleAll={toggleAll} onRowClick={openAttendee} />
          <AttendeePager
            page={page}
            perPage={attendeesQuery.data!.per_page}
            total={attendeesQuery.data!.total}
            totalPages={totalPages}
            onPageChange={goToPage}
          />
        </>
      )}

      <AddAttendeeDialog eventId={eventId} open={addAttendeeOpen} onOpenChange={setAddAttendeeOpen} />
      <ImportWizard eventId={eventId} open={importOpen} onOpenChange={setImportOpen} />

      {/* Task 8: mounted (not just shown/hidden) whenever `attendee` is set,
          so a fresh page load with ?attendee=<id> already in the URL
          renders it too (deep-link support) — not only after a row click
          during the current session. */}
      {search.attendee ? (
        <AttendeeDrawer eventId={eventId} attendeeId={search.attendee} onClose={closeAttendee} />
      ) : null}
    </div>
  );
}

function AttendeesTableSkeleton() {
  return (
    <div className="flex flex-col gap-2" data-testid="attendees-table-skeleton">
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-full" />
    </div>
  );
}
