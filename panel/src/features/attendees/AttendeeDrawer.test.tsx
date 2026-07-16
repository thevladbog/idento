import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { AttendeeDrawer } from "./AttendeeDrawer";
import { useAttendeesPage } from "./hooks";
import { useEventReadiness } from "../events/hooks";
import { startMswServer } from "../../test/msw";
import "../../shared/i18n";

const ADA = {
  id: "a1",
  event_id: "evt-1",
  first_name: "Ada",
  last_name: "Lovelace",
  email: "ada@example.com",
  company: "Analytical Engines",
  position: "Engineer",
  code: "PD-0107",
  checkin_status: true,
  checked_in_at: "2026-07-14T09:12:00Z",
  checked_in_point_name: "Entrance A",
  printed_count: 0,
  blocked: false,
  packet_delivered: false,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const ZONES = [
  { id: "z1", event_id: "evt-1", name: "Main hall", zone_type: "general", order_index: 0, is_registration_zone: true, requires_registration: false, is_active: true, created_at: "2026-01-01T00:00:00Z" },
  { id: "z2", event_id: "evt-1", name: "VIP lounge", zone_type: "general", order_index: 1, is_registration_zone: false, requires_registration: false, is_active: true, created_at: "2026-01-01T00:00:00Z" },
];

const ZONE_ACCESS = [
  { id: "za1", attendee_id: "a1", zone_id: "z1", allowed: true, notes: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
  { id: "za2", attendee_id: "a1", zone_id: "z2", allowed: true, notes: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
  { id: "za3", attendee_id: "a1", zone_id: "z-unknown", allowed: true, notes: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
  { id: "za4", attendee_id: "a1", zone_id: "z1", allowed: false, notes: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
];

function historyEntry(id: string, isoTime: string, zoneName: string) {
  return {
    checkin: { id, attendee_id: "a1", zone_id: "z1", checked_in_at: isoTime, event_day: "2026-07-14T00:00:00Z" },
    zone_name: zoneName,
    zone_type: "general",
  };
}

// Deliberately most-recent-first, and zone_name is NOT alphabetically
// sorted the same way — proves the component renders API order verbatim
// rather than re-sorting by time or by name.
const ZONE_HISTORY = [
  historyEntry("h1", "2026-07-14T10:15:00Z", "VIP lounge"),
  // Deliberately NOT "Entrance A" (the fixed attendee's checked_in_point_name)
  // — a collision there would let a bug in the status-pill/activity-row
  // separation slip past these tests undetected.
  historyEntry("h2", "2026-07-14T09:12:00Z", "Front desk"),
  historyEntry("h3", "2026-07-14T09:10:00Z", "Main hall"),
  historyEntry("h4", "2026-07-14T09:05:00Z", "Loading dock"),
  historyEntry("h5", "2026-07-14T09:00:00Z", "Registration"),
];

let attendeeResponse: unknown = ADA;
let attendeeStatus = 200;
let attendeeGetHitCount = 0;
let zoneAccessResponse: (typeof ZONE_ACCESS)[number][] = ZONE_ACCESS;
let zoneAccessStatus = 200;
let zoneHistoryResponse: unknown = ZONE_HISTORY;
let zoneHistoryStatus = 200;
let listHitCount = 0;

let patchAttendeeCount = 0;
let lastPatchAttendeeBody: unknown;
let patchAttendeeStatusOverride: number | null = null;

let deleteAttendeeCount = 0;
let lastDeletedAttendeeId: string | undefined;
let deleteAttendeeStatusOverride: number | null = null;

let addZoneAccessCount = 0;
let lastAddZoneAccessBody: unknown;

let removeZoneAccessCount = 0;
let lastRemovedZoneAccessId: string | undefined;

let readinessHitCount = 0;

const server = startMswServer(
  http.get("http://api.test/api/events/:id/readiness", () => {
    readinessHitCount += 1;
    return HttpResponse.json({ ready: false, steps: [] });
  }),
  http.get("http://api.test/api/attendees/:id", () => {
    attendeeGetHitCount += 1;
    if (attendeeStatus !== 200) return HttpResponse.json({ error: "boom" }, { status: attendeeStatus });
    return HttpResponse.json(attendeeResponse);
  }),
  http.get("http://api.test/api/attendees/:attendeeId/zone-access", () => {
    if (zoneAccessStatus !== 200) return HttpResponse.json({ error: "boom" }, { status: zoneAccessStatus });
    return HttpResponse.json(zoneAccessResponse);
  }),
  http.get("http://api.test/api/attendees/:attendeeId/zone-history", () => {
    if (zoneHistoryStatus !== 200) return HttpResponse.json({ error: "boom" }, { status: zoneHistoryStatus });
    return HttpResponse.json(zoneHistoryResponse);
  }),
  http.get("http://api.test/api/events/:eventId/zones", () => HttpResponse.json(ZONES)),
  http.get("http://api.test/api/events/:eventId/attendees", () => {
    listHitCount += 1;
    return HttpResponse.json({ attendees: [], total: 0, page: 1, per_page: 50 });
  }),
  http.patch("http://api.test/api/attendees/:id", async ({ request }) => {
    patchAttendeeCount += 1;
    lastPatchAttendeeBody = await request.json();
    if (patchAttendeeStatusOverride) {
      return HttpResponse.json({ error: "boom" }, { status: patchAttendeeStatusOverride });
    }
    attendeeResponse = { ...(attendeeResponse as object), ...(lastPatchAttendeeBody as object) };
    return HttpResponse.json(attendeeResponse);
  }),
  http.delete("http://api.test/api/attendees/:id", ({ params }) => {
    deleteAttendeeCount += 1;
    lastDeletedAttendeeId = params.id as string;
    if (deleteAttendeeStatusOverride) {
      return HttpResponse.json({ error: "boom" }, { status: deleteAttendeeStatusOverride });
    }
    return new HttpResponse(null, { status: 204 });
  }),
  http.post("http://api.test/api/attendees/:attendeeId/zone-access", async ({ request }) => {
    addZoneAccessCount += 1;
    const body = (await request.json()) as { zone_id: string; allowed: boolean };
    lastAddZoneAccessBody = body;
    const newRow = {
      id: `za-new-${addZoneAccessCount}`,
      attendee_id: "a1",
      zone_id: body.zone_id,
      allowed: body.allowed,
      notes: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    zoneAccessResponse = [...zoneAccessResponse, newRow];
    return HttpResponse.json(newRow, { status: 201 });
  }),
  http.delete("http://api.test/api/attendee-zone-access/:id", ({ params }) => {
    removeZoneAccessCount += 1;
    lastRemovedZoneAccessId = params.id as string;
    zoneAccessResponse = zoneAccessResponse.filter((row) => row.id !== params.id);
    return HttpResponse.json({ message: "deleted" });
  }),
);
void server;

function renderWithProviders(ui: ReactNode, queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return { queryClient, ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>) };
}

// Same ListObserver pattern as DangerZoneCard.test.tsx: keeps the attendees
// list query actively subscribed so `queryClient.invalidateQueries` on
// ATTENDEES_LIST_KEY actually triggers an observable refetch.
function AttendeesListObserver() {
  useAttendeesPage("evt-1", { page: 1 });
  return null;
}

// Same pattern for GET /api/events/:id/readiness (ReadinessObserver, as in
// AddAttendeeDialog.test.tsx): a genuinely subscribed useQuery consumer so
// READINESS_KEY invalidation produces an OBSERVABLE refetch
// (readinessHitCount above), not just an asserted invalidate call.
function ReadinessObserver({ eventId }: { eventId: string }) {
  useEventReadiness(eventId);
  return null;
}

// Same shape as ImportWizard.test.tsx's `createGate()`: a deterministic,
// manually-released promise for a delayed MSW handler to await, so a test
// can synchronize on the handler having settled (via the returned
// non-optional `resolve`, always called and always followed by a `waitFor`)
// instead of a fixed-duration sleep "long enough" for it to probably have
// finished.
function createGate() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("AttendeeDrawer", () => {
  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test" };
    attendeeResponse = ADA;
    attendeeStatus = 200;
    attendeeGetHitCount = 0;
    zoneAccessResponse = ZONE_ACCESS;
    zoneAccessStatus = 200;
    zoneHistoryResponse = ZONE_HISTORY;
    zoneHistoryStatus = 200;
    listHitCount = 0;
    patchAttendeeCount = 0;
    lastPatchAttendeeBody = undefined;
    patchAttendeeStatusOverride = null;
    deleteAttendeeCount = 0;
    lastDeletedAttendeeId = undefined;
    deleteAttendeeStatusOverride = null;
    addZoneAccessCount = 0;
    lastAddZoneAccessBody = undefined;
    removeZoneAccessCount = 0;
    lastRemovedZoneAccessId = undefined;
    readinessHitCount = 0;
  });

  it("shows a single whole-body skeleton while the attendee is loading, not the real sections", async () => {
    // Never resolves within this test — asserts the pre-data render only.
    server.use(http.get("http://api.test/api/attendees/:id", () => new Promise(() => {})));
    renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />);

    expect(await screen.findByTestId("attendee-drawer-skeleton")).toBeInTheDocument();
    expect(screen.queryByText("Ada Lovelace")).not.toBeInTheDocument();
  });

  it("shows an i18n'd error message and nothing else when the attendee fetch fails", async () => {
    attendeeStatus = 500;
    renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />);

    expect(await screen.findByText("Couldn't load this attendee.")).toBeInTheDocument();
    expect(screen.queryByText("Ada Lovelace")).not.toBeInTheDocument();
    expect(screen.queryByTestId("attendee-drawer-skeleton")).not.toBeInTheDocument();
  });

  it("renders the header, checked-in pill with time and point, resolved zone chips, and up to 3 activity rows in API order", async () => {
    renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />);

    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("AL")).toBeInTheDocument(); // initials avatar
    expect(screen.getByTestId("attendee-drawer-subline")).toHaveTextContent("Analytical Engines · PD-0107");

    // WCAG 1.4.1: icon + text + color together for the checked-in pill.
    expect(screen.getByText("Checked in · 09:12 · Entrance A")).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText("Main hall")).toBeInTheDocument());
    expect(screen.getByText("VIP lounge")).toBeInTheDocument();
    // allowed=false row for z1 must not add a second chip beyond the one
    // allowed=true chip already resolved for z1.
    expect(screen.getAllByText("Main hall")).toHaveLength(1);
    // Unresolvable zone id falls back gracefully instead of crashing.
    expect(screen.getByText("z-unknow")).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText("10:15 — VIP lounge")).toBeInTheDocument());
    expect(screen.getByText("09:12 — Front desk")).toBeInTheDocument();
    expect(screen.getByText("09:10 — Main hall")).toBeInTheDocument();
    expect(screen.queryByText("09:05 — Loading dock")).not.toBeInTheDocument();
    expect(screen.queryByText("09:00 — Registration")).not.toBeInTheDocument();
  });

  it("omits the company separator gracefully when company is blank", async () => {
    attendeeResponse = { ...ADA, company: "" };
    renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />);

    expect(await screen.findByText("PD-0107")).toBeInTheDocument();
    expect(screen.queryByText(/·\s*PD-0107/)).not.toBeInTheDocument();
  });

  it("omits the checked-in point segment gracefully when checked_in_point_name is null", async () => {
    attendeeResponse = { ...ADA, checked_in_point_name: null };
    renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />);

    expect(await screen.findByText("Checked in · 09:12")).toBeInTheDocument();
    expect(screen.queryByText(/Entrance A/)).not.toBeInTheDocument();
  });

  it("shows a muted 'Not checked in' pill (icon + text) when checkin_status is false", async () => {
    attendeeResponse = { ...ADA, checkin_status: false, checked_in_at: null, checked_in_point_name: null };
    renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />);

    expect(await screen.findByText("Not checked in")).toBeInTheDocument();
    expect(screen.queryByText(/Checked in/)).not.toBeInTheDocument();
  });

  it("shows 'No activity yet' when the attendee has no movement history", async () => {
    zoneHistoryResponse = [];
    renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />);

    expect(await screen.findByText("No activity yet")).toBeInTheDocument();
  });

  // Regression test: `zone_name` can come back as "" server-side (e.g. a
  // zone deleted after the checkin was recorded). Before this fix, the
  // entry line was built as a literal template `"HH:MM — " + zone_name`,
  // so an empty zone_name produced a dangling "10:15 — " row with nothing
  // after the separator — instead it must fall back to an i18n'd label.
  it("falls back to an i18n'd label instead of a dangling separator when an activity entry's zone_name is empty", async () => {
    zoneHistoryResponse = [historyEntry("h1", "2026-07-14T10:15:00Z", "")];
    renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />);

    expect(await screen.findByText("10:15 — unknown zone")).toBeInTheDocument();
    // Proves the separator never dangles with nothing after it.
    expect(screen.queryByText("10:15 —")).not.toBeInTheDocument();
  });

  it("shows only the dashed '+ Zone' placeholder when the attendee has no allowed zone access", async () => {
    zoneAccessResponse = [];
    renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />);

    await screen.findByText("Ada Lovelace");
    expect(await screen.findByText("+ Zone")).toBeInTheDocument();
    expect(screen.queryByText("Main hall")).not.toBeInTheDocument();
  });

  // Regression test: the disabled "+ Zone" placeholder must render for an
  // EXPLICIT "we don't know yet" reason while zone-access/zones are still
  // loading — not by coincidence of `availableZones` computing empty because
  // both queries are `undefined` at that point. Proven by gating only the
  // zones fetch while leaving a genuinely available (ungranted) zone once it
  // resolves — if the disabled state were solely an artifact of an empty
  // `availableZones` array, the button would flip to the interactive
  // dropdown as soon as zone-access alone finished loading, before zones
  // themselves ever arrive.
  it("keeps the '+ Zone' add-affordance disabled while zones are still loading, not just when zero zones are truly available", async () => {
    const zonesGate = createGate();
    server.use(
      http.get("http://api.test/api/events/:eventId/zones", async () => {
        await zonesGate.promise;
        return HttpResponse.json(ZONES);
      }),
    );
    // Leaves VIP lounge (z2) ungranted, so once zones finish loading there
    // genuinely IS a zone available to add.
    zoneAccessResponse = [ZONE_ACCESS[0]];
    renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />);

    await screen.findByText("Ada Lovelace");
    const addZoneButton = await screen.findByRole("button", { name: "+ Zone" });
    expect(addZoneButton).toBeDisabled();

    zonesGate.resolve();
    await waitFor(() => expect(screen.getByRole("button", { name: "+ Zone" })).toBeEnabled());
  });

  it("shows a distinct i18n'd error message (not the empty state) when the zone-access fetch fails, and hides '+ Zone'", async () => {
    zoneAccessStatus = 500;
    renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />);

    await screen.findByText("Ada Lovelace");
    expect(await screen.findByText("Couldn't load zone access.")).toBeInTheDocument();
    // Must not be mistaken for "no zone access" or for a still-resolvable state.
    expect(screen.queryByText("Main hall")).not.toBeInTheDocument();
    expect(screen.queryByText("VIP lounge")).not.toBeInTheDocument();
    // Offering to add MORE zones while we don't know current access is confusing — hidden on error.
    expect(screen.queryByRole("button", { name: "+ Zone" })).not.toBeInTheDocument();
  });

  it("shows a distinct i18n'd error message (not the empty state) when the zone-history fetch fails", async () => {
    zoneHistoryStatus = 500;
    renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />);

    await screen.findByText("Ada Lovelace");
    expect(await screen.findByText("Couldn't load activity.")).toBeInTheDocument();
    // Must not be mistaken for "no activity yet".
    expect(screen.queryByText("No activity yet")).not.toBeInTheDocument();
    expect(screen.queryByText(/10:15 — VIP lounge/)).not.toBeInTheDocument();
  });

  it("renders Edit details, Regenerate code…, and Delete… as enabled controls, and permanently disables Reprint badge (Task 9)", async () => {
    renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />);

    await screen.findByText("Ada Lovelace");
    expect(screen.getByRole("button", { name: "Edit details" })).toBeEnabled();
    const reprintButton = screen.getByRole("button", { name: "Reprint badge — coming with the badge editor" });
    expect(reprintButton).toBeDisabled();
    // Lock icon accompanies the text (WCAG 1.4.1) — the same structural
    // idiom (icon + text + native disabled) unified onto BulkBar's "Print
    // badges" locked control (Task 8).
    expect(reprintButton.querySelector("svg")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Regenerate code…" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Delete…" })).toBeEnabled();
    // Fixture ZONE_ACCESS already grants both real event zones (z1/z2), so
    // there's nothing left to add — the affordance stays visible but disabled.
    await waitFor(() => expect(screen.getByRole("button", { name: "+ Zone" })).toBeDisabled());
  });

  it("calls onClose when the built-in Sheet close affordance is used", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={onClose} />);

    await screen.findByText("Ada Lovelace");
    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("has an accessible dialog title even while the attendee is still loading", async () => {
    server.use(http.get("http://api.test/api/attendees/:id", () => new Promise(() => {})));
    renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />);

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    // sr-only fallback title, present before the real attendee name loads.
    expect(within(screen.getByRole("dialog")).getByText("Attendee details")).toBeInTheDocument();
  });
});

describe("AttendeeDrawer — Task 9 mutations", () => {
  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test" };
    attendeeResponse = ADA;
    attendeeStatus = 200;
    attendeeGetHitCount = 0;
    zoneAccessResponse = ZONE_ACCESS;
    zoneAccessStatus = 200;
    zoneHistoryResponse = ZONE_HISTORY;
    zoneHistoryStatus = 200;
    listHitCount = 0;
    patchAttendeeCount = 0;
    lastPatchAttendeeBody = undefined;
    patchAttendeeStatusOverride = null;
    deleteAttendeeCount = 0;
    lastDeletedAttendeeId = undefined;
    deleteAttendeeStatusOverride = null;
    addZoneAccessCount = 0;
    lastAddZoneAccessBody = undefined;
    removeZoneAccessCount = 0;
    lastRemovedZoneAccessId = undefined;
    readinessHitCount = 0;
  });

  it("edit details PATCHes only the changed field", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <AttendeesListObserver />
        <AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />
      </>,
    );
    await screen.findByText("Ada Lovelace");
    await user.click(screen.getByRole("button", { name: "Edit details" }));

    const positionInput = await screen.findByLabelText("Position");
    await user.clear(positionInput);
    await user.type(positionInput, "Senior Engineer");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(patchAttendeeCount).toBe(1));
    expect(lastPatchAttendeeBody).toEqual({ position: "Senior Engineer" });

    // Returns to the read view and invalidates both queries.
    expect(await screen.findByRole("button", { name: "Edit details" })).toBeInTheDocument();
    await waitFor(() => expect(listHitCount).toBeGreaterThan(0));
    await waitFor(() => expect(attendeeGetHitCount).toBeGreaterThan(1));
  });

  // Regression test: the PATCH-body dirty-check must compare the RAW form
  // value against the RAW baseline (matching `isDirty`'s own logic), not the
  // TRIMMED value against the raw baseline. A baseline imported with messy
  // whitespace (e.g. from a bad CSV) must not make an untouched field look
  // "changed" just because trimming it happens to differ from the untrimmed
  // baseline — only the field the user actually edited should appear in the
  // PATCH body.
  it("does not include an untouched field in the PATCH body even when its baseline has leading/trailing whitespace", async () => {
    attendeeResponse = { ...ADA, company: "  Acme Corp" };
    const user = userEvent.setup();
    renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />);
    await screen.findByText("Ada Lovelace");
    await user.click(screen.getByRole("button", { name: "Edit details" }));

    // Only touch Position — Company is left exactly as loaded.
    const positionInput = await screen.findByLabelText("Position");
    await user.clear(positionInput);
    await user.type(positionInput, "Senior Engineer");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(patchAttendeeCount).toBe(1));
    // Company must be entirely absent from the body — not present with its
    // silently-trimmed value — since the user never touched it.
    expect(lastPatchAttendeeBody).toEqual({ position: "Senior Engineer" });
    expect(lastPatchAttendeeBody).not.toHaveProperty("company");
  });

  // Regression test for the same stale-PATCH-response race GeneralCard.test.tsx
  // covers: `patchAttendee.reset()` on every keystroke only clears the
  // mutation observer's local state, it does NOT cancel the first, still
  // in-flight PATCH — that response must not overwrite a newer, still-unsaved
  // edit made while it was pending.
  it("does not let a stale PATCH response overwrite a newer, still-unsaved edit made while the first save was pending", async () => {
    // Same `createGate()` shape as ImportWizard.test.tsx's chunk gates: a
    // non-optional releaser (definite-assignment, not `| undefined`) that
    // the test MUST call and await settling via `waitFor`, rather than a
    // fixed-duration sleep "long enough" for the response to have probably
    // landed.
    const firstPatchGate = createGate();
    server.use(
      http.patch("http://api.test/api/attendees/:id", async ({ request }) => {
        patchAttendeeCount += 1;
        lastPatchAttendeeBody = await request.json();
        await firstPatchGate.promise;
        return HttpResponse.json({ ...ADA, ...(lastPatchAttendeeBody as object) });
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />);
    await screen.findByText("Ada Lovelace");
    await user.click(screen.getByRole("button", { name: "Edit details" }));

    const positionInput = await screen.findByLabelText("Position");
    await user.clear(positionInput);
    await user.type(positionInput, "First edit");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(patchAttendeeCount).toBe(1));
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    // A legitimate second edit while the first save is still pending —
    // `reset()` (fired by this edit) re-enables Save without cancelling the
    // in-flight request.
    await user.clear(positionInput);
    await user.type(positionInput, "Second edit");

    const attendeeGetHitCountBeforeRelease = attendeeGetHitCount;
    firstPatchGate.resolve();

    // The stale onSuccess still runs its unconditional cache invalidation
    // (see EditAttendeeForm.tsx's comment on that) even though the version
    // guard skips applying the response — waiting for that invalidation's
    // refetch to land against the always-subscribed attendee-detail query is
    // a deterministic signal that the stale onSuccess has fully executed,
    // rather than a fixed-duration sleep hoping it "probably" has.
    await waitFor(() => expect(attendeeGetHitCount).toBeGreaterThan(attendeeGetHitCountBeforeRelease));

    expect(screen.getByLabelText("Position")).toHaveValue("Second edit");
    // Still in edit mode — a stale success must not have returned to the
    // read view out from under the newer, unsaved edit.
    expect(screen.queryByRole("button", { name: "Edit details" })).not.toBeInTheDocument();
  });

  // Regression test: the outer Sheet must refuse to close (Escape/outside-
  // click) while EditAttendeeForm's PATCH is genuinely in flight — otherwise
  // the whole drawer unmounts mid-save and the user has no way to know
  // whether their edit actually persisted.
  it("does not let Escape close the drawer while an edit-mode save is pending, but allows it again once the save resolves", async () => {
    const editPatchGate = createGate();
    server.use(
      http.patch("http://api.test/api/attendees/:id", async ({ request }) => {
        patchAttendeeCount += 1;
        lastPatchAttendeeBody = await request.json();
        await editPatchGate.promise;
        return HttpResponse.json({ ...ADA, ...(lastPatchAttendeeBody as object) });
      }),
    );

    const onClose = vi.fn();
    const user = userEvent.setup();
    // `open` is hardcoded `true` on AttendeeDrawer's own Sheet — in the real
    // app it's the PARENT unmounting AttendeeDrawer on `onClose` that
    // actually makes the dialog disappear (see AttendeesPage.tsx's
    // `?attendee=` handling). Rendered standalone here, so "did Escape close
    // it" is asserted via `onClose` call counts, not dialog presence.
    renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={onClose} />);
    await screen.findByText("Ada Lovelace");
    await user.click(screen.getByRole("button", { name: "Edit details" }));

    const positionInput = await screen.findByLabelText("Position");
    await user.clear(positionInput);
    await user.type(positionInput, "Senior Engineer");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(patchAttendeeCount).toBe(1));
    // Cancel is disabled too while the save is pending.
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();

    await user.keyboard("{Escape}");
    // onClose must not have been called — Escape was a no-op while the save
    // is genuinely in flight, and the edit form must still be showing.
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Position")).toHaveValue("Senior Engineer");

    editPatchGate.resolve();
    // Save resolved — back to the read view.
    expect(await screen.findByRole("button", { name: "Edit details" })).toBeInTheDocument();

    // Now that nothing is busy, Escape dismisses the drawer normally.
    await user.keyboard("{Escape}");
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("+ Zone opens a picker of ungranted zones, POSTs the right body on selection, and refetches zone access", async () => {
    // Leave VIP lounge (z2) ungranted so there's something to add.
    zoneAccessResponse = [ZONE_ACCESS[0]];
    const user = userEvent.setup();
    renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />);
    await screen.findByText("Ada Lovelace");
    await waitFor(() => expect(screen.getByRole("button", { name: "+ Zone" })).toBeEnabled());

    await user.click(screen.getByRole("button", { name: "+ Zone" }));
    await user.click(await screen.findByRole("menuitem", { name: "VIP lounge" }));

    await waitFor(() => expect(addZoneAccessCount).toBe(1));
    expect(lastAddZoneAccessBody).toEqual({ zone_id: "z2", allowed: true });

    // Refetch of the zone-access query reflects the newly-granted zone.
    await waitFor(() => expect(screen.getByText("VIP lounge")).toBeInTheDocument());
  });

  it("removes a zone chip via DELETE using the zone-access row id (not the zone id), then refetches", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />);
    await screen.findByText("Ada Lovelace");
    await waitFor(() => expect(screen.getByText("Main hall")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Remove Main hall" }));

    await waitFor(() => expect(removeZoneAccessCount).toBe(1));
    // za1 is the zone-access ROW id for the Main hall (z1) grant — the
    // component must send that, never the zone id "z1" itself.
    expect(lastRemovedZoneAccessId).toBe("za1");

    await waitFor(() => expect(screen.queryByText("Main hall")).not.toBeInTheDocument());
  });

  // Fix (Codex, PR #65): a zone-access change can affect whether this
  // attendee still matches an active `zone` filter on the attendees table,
  // so both add and remove must also invalidate the attendees list query —
  // not just the drawer's own zone-access query.
  it("invalidates the attendees list (not just zone access) when a zone is added", async () => {
    zoneAccessResponse = [ZONE_ACCESS[0]];
    listHitCount = 0;
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <AttendeesListObserver />
        <AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />
      </>,
    );
    await screen.findByText("Ada Lovelace");
    await waitFor(() => expect(listHitCount).toBe(1));
    await waitFor(() => expect(screen.getByRole("button", { name: "+ Zone" })).toBeEnabled());

    await user.click(screen.getByRole("button", { name: "+ Zone" }));
    await user.click(await screen.findByRole("menuitem", { name: "VIP lounge" }));

    await waitFor(() => expect(listHitCount).toBeGreaterThan(1));
  });

  it("invalidates the attendees list (not just zone access) when a zone is removed", async () => {
    listHitCount = 0;
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <AttendeesListObserver />
        <AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />
      </>,
    );
    await screen.findByText("Ada Lovelace");
    await waitFor(() => expect(listHitCount).toBe(1));
    await waitFor(() => expect(screen.getByText("Main hall")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Remove Main hall" }));

    await waitFor(() => expect(listHitCount).toBeGreaterThan(1));
  });

  // Fix (Codex, PR #65): addZoneAccess previously had no onError handling —
  // a failed POST just closed the dropdown with no explanation.
  it("shows an inline error when adding a zone fails, and clears it once a retry succeeds", async () => {
    zoneAccessResponse = [ZONE_ACCESS[0]];
    let shouldFail = true;
    server.use(
      http.post("http://api.test/api/attendees/:attendeeId/zone-access", async ({ request }) => {
        if (shouldFail) {
          return HttpResponse.json({ error: "boom" }, { status: 500 });
        }
        addZoneAccessCount += 1;
        lastAddZoneAccessBody = await request.json();
        return HttpResponse.json({ id: "za2", attendee_id: "a1", zone_id: "z2", allowed: true }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />);
    await screen.findByText("Ada Lovelace");
    await waitFor(() => expect(screen.getByRole("button", { name: "+ Zone" })).toBeEnabled());

    await user.click(screen.getByRole("button", { name: "+ Zone" }));
    await user.click(await screen.findByRole("menuitem", { name: "VIP lounge" }));

    expect(await screen.findByText("Couldn't add that zone. Try again.")).toBeInTheDocument();

    shouldFail = false;
    await user.click(screen.getByRole("button", { name: "+ Zone" }));
    await user.click(await screen.findByRole("menuitem", { name: "VIP lounge" }));

    await waitFor(() => expect(addZoneAccessCount).toBe(1));
    await waitFor(() => expect(screen.queryByText("Couldn't add that zone. Try again.")).not.toBeInTheDocument());
  });

  // Regression test: `removeZoneAccess` is a SINGLE mutation instance shared
  // by every zone chip's remove button. Before this fix, each chip derived
  // its own "removing" state from that shared mutation's `.variables` —
  // which only ever reflects the MOST RECENTLY fired call. Removing chip A
  // then chip B (before A's DELETE resolves) overwrote `.variables` to B's
  // params, making chip A's button read as "not removing" (re-enabled)
  // while A's DELETE was still genuinely in flight — a double-click on A at
  // that point would fire a second DELETE for an already-being-deleted row,
  // which the backend correctly 404s on (DeleteAttendeeZoneAccess is not
  // idempotent). The fix tracks pending removal per-row in a `Set` instead.
  it("keeps a zone chip's own remove button disabled for its whole in-flight DELETE, even after a different chip's remove is clicked before it resolves", async () => {
    const releasers: Record<string, () => void> = {};
    const deleteCallCounts: Record<string, number> = {};
    server.use(
      http.delete("http://api.test/api/attendee-zone-access/:id", async ({ params }) => {
        const id = params.id as string;
        deleteCallCounts[id] = (deleteCallCounts[id] ?? 0) + 1;
        removeZoneAccessCount += 1;
        lastRemovedZoneAccessId = id;
        await new Promise<void>((resolve) => {
          releasers[id] = resolve;
        });
        zoneAccessResponse = zoneAccessResponse.filter((row) => row.id !== id);
        return HttpResponse.json({ message: "deleted" });
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />);
    await screen.findByText("Ada Lovelace");
    await waitFor(() => expect(screen.getByText("Main hall")).toBeInTheDocument());
    expect(screen.getByText("VIP lounge")).toBeInTheDocument();

    const removeMainHall = screen.getByRole("button", { name: "Remove Main hall" });
    const removeVipLounge = screen.getByRole("button", { name: "Remove VIP lounge" });

    // Remove chip A (za1) — its DELETE hangs until released below.
    await user.click(removeMainHall);
    await waitFor(() => expect(deleteCallCounts.za1).toBe(1));
    expect(removeMainHall).toBeDisabled();

    // Before A's DELETE resolves, remove chip B (za2) — this is the moment
    // that overwrites the shared mutation's `.variables` to za2's params.
    await user.click(removeVipLounge);
    await waitFor(() => expect(deleteCallCounts.za2).toBe(1));

    // Both DELETEs are genuinely still in flight — both buttons must stay
    // disabled. Pre-fix, chip A's button would have re-enabled here.
    expect(removeMainHall).toBeDisabled();
    expect(removeVipLounge).toBeDisabled();

    releasers.za1?.();
    releasers.za2?.();

    await waitFor(() => expect(screen.queryByText("Main hall")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.queryByText("VIP lounge")).not.toBeInTheDocument());

    // Exactly one DELETE per row — no duplicate fired for za1 while it was
    // already being removed.
    expect(deleteCallCounts.za1).toBe(1);
    expect(deleteCallCounts.za2).toBe(1);
  });

  it("regenerates the code via PATCH with a UUID-shaped code and invalidates both queries", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <AttendeesListObserver />
        <AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />
      </>,
    );
    await screen.findByText("Ada Lovelace");
    await waitFor(() => expect(listHitCount).toBe(1));

    await user.click(screen.getByRole("button", { name: "Regenerate code…" }));
    const dialog = await screen.findByRole("dialog", { name: "Regenerate code" });
    await user.click(within(dialog).getByRole("button", { name: "Regenerate" }));

    await waitFor(() => expect(patchAttendeeCount).toBe(1));
    expect(lastPatchAttendeeBody).toMatchObject({
      code: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
    });
    await waitFor(() => expect(listHitCount).toBeGreaterThan(1));
    await waitFor(() => expect(attendeeGetHitCount).toBeGreaterThan(1));
    // The confirm dialog itself closes on success — the drawer (also a
    // `role="dialog"` Sheet) stays open throughout, so this must check the
    // confirm dialog's own accessible name rather than "no dialog at all".
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Regenerate code" })).not.toBeInTheDocument());
  });

  // Regression test for the cancel-during-pending race (same class as
  // DangerZoneCard.test.tsx's equivalent): the PATCH is still in flight when
  // the user clicks Cancel. The late response must not surface an error or
  // otherwise react once the dialog session has moved on.
  it("does not surface an error if the regenerate confirm dialog is cancelled before a pending PATCH resolves", async () => {
    server.use(
      http.patch("http://api.test/api/attendees/:id", async ({ request }) => {
        patchAttendeeCount += 1;
        lastPatchAttendeeBody = await request.json();
        await delay(50);
        return HttpResponse.json({ error: "server error" }, { status: 500 });
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={vi.fn()} />);
    await screen.findByText("Ada Lovelace");

    await user.click(screen.getByRole("button", { name: "Regenerate code…" }));
    const dialog = await screen.findByRole("dialog", { name: "Regenerate code" });
    await user.click(within(dialog).getByRole("button", { name: "Regenerate" }));
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Regenerate code" })).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(patchAttendeeCount).toBe(1));
    expect(screen.queryByText("Couldn't save changes. Try again.")).not.toBeInTheDocument();
  });

  it("delete: DELETEs the attendee, invalidates the list AND readiness (the deletion changes the rail's attendees count), and closes the whole drawer", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <AttendeesListObserver />
        <ReadinessObserver eventId="evt-1" />
        <AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={onClose} />
      </>,
    );
    await screen.findByText("Ada Lovelace");
    await waitFor(() => expect(listHitCount).toBe(1));
    await waitFor(() => expect(readinessHitCount).toBe(1));

    await user.click(screen.getByRole("button", { name: "Delete…" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete attendee" });
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(deleteAttendeeCount).toBe(1));
    expect(lastDeletedAttendeeId).toBe("a1");
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(listHitCount).toBeGreaterThan(1));
    // The genuinely subscribed readiness observer actually refetches —
    // not just an invalidateQueries call asserted in isolation.
    await waitFor(() => expect(readinessHitCount).toBeGreaterThan(1));
  });

  it("keeps the delete confirm dialog open with an inline error when the delete fails", async () => {
    deleteAttendeeStatusOverride = 500;
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={onClose} />);
    await screen.findByText("Ada Lovelace");

    await user.click(screen.getByRole("button", { name: "Delete…" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete attendee" });
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(deleteAttendeeCount).toBe(1));
    expect(await within(dialog).findByText("Couldn't save changes. Try again.")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Delete attendee" })).toBe(dialog);
    expect(onClose).not.toHaveBeenCalled();
  });

  // Regression test for the cancel-during-pending race, mirroring
  // DangerZoneCard.test.tsx's equivalent for event deletion.
  it("does not close the drawer or surface an error if the delete confirm dialog is cancelled before a pending DELETE resolves", async () => {
    const onClose = vi.fn();
    server.use(
      http.delete("http://api.test/api/attendees/:id", async ({ params }) => {
        deleteAttendeeCount += 1;
        lastDeletedAttendeeId = params.id as string;
        await delay(50);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<AttendeeDrawer eventId="evt-1" attendeeId="a1" onClose={onClose} />);
    await screen.findByText("Ada Lovelace");

    await user.click(screen.getByRole("button", { name: "Delete…" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete attendee" });
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Delete attendee" })).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(deleteAttendeeCount).toBe(1));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByText("Couldn't save changes. Try again.")).not.toBeInTheDocument();
  });
});
