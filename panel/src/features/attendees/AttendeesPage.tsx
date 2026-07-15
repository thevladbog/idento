import { Button, EmptyState, Skeleton } from "@idento/ui";
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
import type { AttendeesSearch } from "./searchParams";
import type { components } from "../../shared/api/schema";

type EventZone = components["schemas"]["EventZone"];
type EventZoneWithStats = components["schemas"]["EventZoneWithStats"];
type AttendeeStatus = NonNullable<AttendeesSearch["status"]>;

// Same rationale as EventWorkspaceLayout.tsx / WorkspaceOverview.tsx:
// `getRouteApi` with the route's string id avoids a circular import with
// app/router.tsx (which imports this component for the route's `component`).
const routeApi = getRouteApi("/_app/events/$eventId/attendees");

const PER_PAGE = 50;
const SEARCH_DEBOUNCE_MS = 250;

// useEventZones' return type is a union (EventZone[] | EventZoneWithStats[])
// per the raw API contract, not discriminated by any param this page sends
// (Task 4 note) — narrow by checking for the `zone` wrapper field, the same
// pattern WorkspaceOverview.tsx's `zoneName` helper already uses.
function zoneIdentity(entry: EventZone | EventZoneWithStats): { id: string; name: string } {
  return "zone" in entry ? { id: entry.zone.id, name: entry.zone.name } : { id: entry.id, name: entry.name };
}

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

        <select
          aria-label={t("attendeesZoneFilterAll")}
          value={search.zone ?? ""}
          onChange={(e) => updateFilter({ zone: e.target.value || undefined })}
          className="h-9 rounded-full border border-input bg-card px-3 text-body text-foreground"
        >
          <option value="">{t("attendeesZoneFilterAll")}</option>
          {(zonesQuery.data ?? []).map((entry) => {
            const zone = zoneIdentity(entry);
            return (
              <option key={zone.id} value={zone.id}>
                {zone.name}
              </option>
            );
          })}
        </select>

        <select
          aria-label={t("attendeesStatusFilterAny")}
          value={search.status ?? ""}
          onChange={(e) => updateFilter({ status: (e.target.value || undefined) as AttendeeStatus | undefined })}
          className="h-9 rounded-full border border-input bg-card px-3 text-body text-foreground"
        >
          <option value="">{t("attendeesStatusFilterAny")}</option>
          <option value="checked_in">{t("attendeesStatusCheckedIn")}</option>
          <option value="not_checked_in">{t("attendeesStatusNotCheckedIn")}</option>
        </select>

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
      ) : rows.length === 0 && !hasActiveFilters ? (
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
      ) : rows.length === 0 && hasActiveFilters ? (
        <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-border p-6">
          <p className="text-body text-muted-foreground">{t("attendeesNoMatches")}</p>
          <button
            type="button"
            className="text-body text-primary underline-offset-4 hover:underline"
            onClick={clearFilters}
          >
            {t("attendeesClearFilters")}
          </button>
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
