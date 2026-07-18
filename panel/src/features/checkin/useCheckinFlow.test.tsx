// P4.1 Task 6 -- useCheckinFlow tests. Exercises BOTH MSW origins (the
// backend `http://api.test` AND the print agent `http://agent.test`), same
// combined-origin shape usePrintBadge.test.tsx established -- this hook
// calls the REAL usePrintBadge internally (not a mock), so a "checked_in +
// print_on_checkin" scan genuinely round-trips through the badge-template
// fetch, font loading, agent print, and mark-printed, exactly as it would in
// the running app.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { waitFor } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import { delay, http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { startMswServer } from "../../test/msw";
import type { components } from "../../shared/api/schema";
import { DEFAULT_CHECKIN_SETTINGS, type CheckinSettings } from "./settingsTypes";
import { useCheckinFlow, type UseCheckinFlowOptions } from "./useCheckinFlow";

type Attendee = components["schemas"]["Attendee"];
type CheckinOutcome = "checked_in" | "already_checked_in" | "blocked";

const ATTENDEE: Attendee = {
  id: "att-1",
  event_id: "evt-1",
  first_name: "Ada",
  last_name: "Lovelace",
  email: "ada@example.com",
  company: "Analytical Engines",
  position: "Engineer",
  code: "CODE1",
  checkin_status: false,
  printed_count: 0,
  blocked: false,
  packet_delivered: false,
};

// Same minimal Latin-only, jsdom-viable fixture usePrintBadge.test.tsx uses
// -- generation correctness itself is already pinned by generateZpl.test.ts;
// this file only needs printAttendee's whole pipeline to succeed (or fail,
// for the print-failure test) so useCheckinFlow's OWN state machine can be
// observed.
const TEMPLATE_DOC = {
  width_mm: 90,
  height_mm: 55,
  dpi: 300,
  elements: [{ id: "e1", type: "text", x: 0, y: 0, fontSize: 10, source: "first_name", text: "Guest" }],
};

// Same FontFace/document.fonts stub usePrintBadge.test.tsx uses -- jsdom
// implements neither, and usePrintBadge (called internally by
// useCheckinFlow) needs a terminal fontsStatus before it will generate.
class MockFontFace {
  family: string;
  constructor(family: string, _source: unknown, _descriptors?: { weight?: string; style?: string }) {
    this.family = family;
  }
  load(): Promise<MockFontFace> {
    return Promise.resolve(this);
  }
}
function stubFontFaceApi() {
  (globalThis as unknown as { FontFace: unknown }).FontFace = MockFontFace;
  Object.defineProperty(document, "fonts", { value: { add: () => {} }, configurable: true, writable: true });
}
function unstubFontFaceApi() {
  delete (globalThis as unknown as { FontFace?: unknown }).FontFace;
  // @ts-expect-error -- test-only cleanup of the jsdom `document.fonts`
  // stub; real jsdom has no `fonts` property to restore.
  delete document.fonts;
}

let checkinOutcome: CheckinOutcome = "checked_in";
let checkinHitCount = 0;
let checkinCapturedBody: { attendee_id: string; station_id?: string | null } | null = null;
let attendeesGetCount = 0;
let lastAttendeesCodeParam: string | null = null;
let printedHitCount = 0;
let printedBodyCapture: unknown;
let agentPrintHitCount = 0;
let agentPrintStatus = 200;

// Factored out of the default checkin POST handler below so a Finding-2 test
// can reuse the exact same response-shaping logic behind an ARTIFICIALLY
// DELAYED handler (server.use override) -- forcing a real, deterministic
// window where a checked_in scan resolves while the fonts fetch (delayed
// separately, see that test) is still in flight, rather than relying on
// incidental timing.
function buildCheckinResponse(body: { attendee_id: string; station_id?: string | null }) {
  checkinHitCount += 1;
  checkinCapturedBody = body;
  const attendee: Attendee = {
    ...ATTENDEE,
    id: body.attendee_id,
    checkin_status: checkinOutcome !== "blocked",
    blocked: checkinOutcome === "blocked",
  };
  const checkin =
    checkinOutcome === "blocked"
      ? null
      : { at: "2026-01-01T00:00:00Z", by_email: "staff@example.com", point_name: "Main Door" };
  return { outcome: checkinOutcome, attendee, checkin };
}

// PR #77 bot-review round 2, Finding 2 -- useCheckinFlow's auto-print gate
// now reads `printBadge.fontsStatus` SYNCHRONOUSLY the instant a checked_in
// scan resolves (no internal wait -- see useCheckinFlow.ts's own
// `printFontsPending` doc comment for why). A scan fired the INSTANT a hook
// mounts genuinely races the (still in-flight) fonts-list fetch reaching a
// terminal status, even with an empty list and zero artificial delay --
// react-query's own scheduling for that `useQuery` measurably lags this
// hook's two sequential raw calls (the code lookup GET, then the checkin
// POST mutation). Tests exercising the SUCCESS path settle the fonts fetch
// first, matching a REAL station where an operator's first physical scan
// happens well after mount, not the mount-instant race the dedicated
// "still loading" test below is specifically about.
async function settleFonts() {
  await new Promise((resolve) => setTimeout(resolve, 150));
}

// Same minimal FontListItem/font-bytes fixtures useEventFontFaces.test.tsx
// uses -- only needed by the Finding-2 "fonts still loading" test below.
function fontListItem(id: string, family: string) {
  return {
    id,
    name: family,
    family,
    weight: "normal",
    style: "normal",
    format: "opentype" as const,
    size: 1000,
    created_at: "2026-01-01T00:00:00Z",
  };
}
const FAKE_FONT_BYTES = new TextEncoder().encode("fake-font-bytes").buffer as ArrayBuffer;

const server = startMswServer(
  http.get("http://api.test/api/events/:id/badge-template", () =>
    HttpResponse.json({ template: TEMPLATE_DOC, version: 1 }),
  ),
  http.get("http://api.test/api/events/:eventId/fonts", () => HttpResponse.json([])),
  http.get("http://api.test/api/events/:eventId/attendees", ({ request }) => {
    attendeesGetCount += 1;
    const url = new URL(request.url);
    lastAttendeesCodeParam = url.searchParams.get("code");
    if (lastAttendeesCodeParam === ATTENDEE.code) {
      return HttpResponse.json([ATTENDEE]);
    }
    return HttpResponse.json([]);
  }),
  http.post("http://api.test/api/events/:eventId/checkin", async ({ request }) => {
    const body = (await request.json()) as { attendee_id: string; station_id?: string | null };
    return HttpResponse.json(buildCheckinResponse(body));
  }),
  http.post("http://api.test/api/attendees/:attendeeId/printed", async ({ request }) => {
    printedHitCount += 1;
    const raw = await request.text();
    printedBodyCapture = raw ? JSON.parse(raw) : undefined;
    return HttpResponse.json({ printed_count: printedHitCount });
  }),
  http.get("http://agent.test/health", () => new HttpResponse(null, { status: 200 })),
  http.post("http://agent.test/print", () => {
    agentPrintHitCount += 1;
    if (agentPrintStatus !== 200) return new HttpResponse("printer offline", { status: agentPrintStatus });
    return HttpResponse.json({ status: "printed" });
  }),
);
void server;

function renderFlow(overrides: Partial<UseCheckinFlowOptions> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  const options: UseCheckinFlowOptions = {
    eventId: "evt-1",
    stationId: "st-1",
    settings: DEFAULT_CHECKIN_SETTINGS,
    printerName: "Zebra_ZD421",
    ...overrides,
  };
  return renderHook(() => useCheckinFlow(options), { wrapper });
}

describe("useCheckinFlow", () => {
  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test", AGENT_URL: "http://agent.test" };
    localStorage.clear();
    localStorage.setItem("token", "jwt-test");
    checkinOutcome = "checked_in";
    checkinHitCount = 0;
    checkinCapturedBody = null;
    attendeesGetCount = 0;
    lastAttendeesCodeParam = null;
    printedHitCount = 0;
    printedBodyCapture = undefined;
    agentPrintHitCount = 0;
    agentPrintStatus = 200;
    stubFontFaceApi();
  });

  afterEach(() => {
    unstubFontFaceApi();
  });

  it("resolves a fresh scanned code to the checked_in (allowed) verdict and prints WITHOUT a printContext (the checkin row was already logged by the check-in call itself)", async () => {
    const { result } = renderFlow();
    // PR #77 bot-review round 2, Finding 2 -- auto-print now only fires once
    // `printBadge.fontsStatus` has ALREADY reached a terminal state (see that
    // finding's own dedicated "still loading" test below); this settles the
    // (empty, undelayed) fonts fetch to "ready" first, matching a REAL
    // station where fonts finish loading well before an operator's first
    // physical scan, rather than testing the mount-instant race this finding
    // is specifically about.
    await settleFonts();

    void result.current.submitCode(ATTENDEE.code);

    await waitFor(() => expect(result.current.state.status).toBe("verdict"));

    expect(result.current.state.verdict).toBe("allowed");
    expect(result.current.state.attendee?.id).toBe(ATTENDEE.id);
    expect(result.current.state.checkin?.point_name).toBe("Main Door");
    expect(result.current.state.printError).toBeUndefined();

    expect(lastAttendeesCodeParam).toBe(ATTENDEE.code);
    expect(checkinHitCount).toBe(1);
    expect(checkinCapturedBody).toEqual({ attendee_id: ATTENDEE.id, station_id: "st-1" });

    await waitFor(() => expect(agentPrintHitCount).toBe(1));
    await waitFor(() => expect(printedHitCount).toBe(1));
    // No printContext -- this is the IMPLICIT auto-print fulfilling a
    // check-in that was already logged server-side (Task 3's
    // CheckInAttendee), not a separate loggable reprint action (final
    // cross-task review finding). An empty body (undefined, since the
    // request itself carries no JSON payload) is the pre-existing P3.2
    // counter-only shape -- see this suite's own MSW handler for
    // POST /printed above (`raw ? JSON.parse(raw) : undefined`).
    expect(printedBodyCapture).toBeUndefined();
  });

  it("shows already_checked_in for a repeat scan and never prints", async () => {
    checkinOutcome = "already_checked_in";
    const { result } = renderFlow();

    void result.current.submitCode(ATTENDEE.code);

    await waitFor(() => expect(result.current.state.status).toBe("verdict"));
    expect(result.current.state.verdict).toBe("already_checked_in");
    expect(checkinHitCount).toBe(1);

    // Give a (wrong) print attempt a chance to fire before asserting its
    // absence.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(agentPrintHitCount).toBe(0);
    expect(printedHitCount).toBe(0);
  });

  it("shows blocked for a blocked attendee, with no checkin metadata, and never prints", async () => {
    checkinOutcome = "blocked";
    const { result } = renderFlow();

    void result.current.submitCode(ATTENDEE.code);

    await waitFor(() => expect(result.current.state.status).toBe("verdict"));
    expect(result.current.state.verdict).toBe("no_access");
    expect(result.current.state.checkin).toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(agentPrintHitCount).toBe(0);
    expect(printedHitCount).toBe(0);
  });

  it("resolves an unrecognized code to not_found without ever calling the check-in endpoint", async () => {
    const { result } = renderFlow();

    void result.current.submitCode("NO-SUCH-CODE");

    await waitFor(() => expect(result.current.state.status).toBe("verdict"));
    expect(result.current.state.verdict).toBe("not_registered");
    expect(result.current.state.attendee).toBeUndefined();
    expect(checkinHitCount).toBe(0);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(agentPrintHitCount).toBe(0);
  });

  it("does not print a successful check-in when settings.print_on_checkin is false", async () => {
    const settings: CheckinSettings = { ...DEFAULT_CHECKIN_SETTINGS, print_on_checkin: false };
    const { result } = renderFlow({ settings });

    void result.current.submitCode(ATTENDEE.code);

    await waitFor(() => expect(result.current.state.status).toBe("verdict"));
    expect(result.current.state.verdict).toBe("allowed");

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(agentPrintHitCount).toBe(0);
    expect(printedHitCount).toBe(0);
  });

  it("submitAttendee (manual-search path) skips the code lookup and checks in directly", async () => {
    const settings: CheckinSettings = { ...DEFAULT_CHECKIN_SETTINGS, print_on_checkin: false };
    const { result } = renderFlow({ settings });

    void result.current.submitAttendee(ATTENDEE);

    await waitFor(() => expect(result.current.state.status).toBe("verdict"));
    expect(result.current.state.verdict).toBe("allowed");
    expect(attendeesGetCount).toBe(0);
    expect(checkinHitCount).toBe(1);
  });

  it("keeps the checked_in verdict when the print step fails -- the check-in already committed", async () => {
    agentPrintStatus = 500;
    const { result } = renderFlow();
    await settleFonts();

    void result.current.submitCode(ATTENDEE.code);

    await waitFor(() => expect(result.current.state.status).toBe("verdict"));
    expect(result.current.state.verdict).toBe("allowed");
    expect(result.current.state.attendee?.id).toBe(ATTENDEE.id);
    expect(result.current.state.printError).toBeDefined();
    // The send itself was attempted (and failed) -- mark-printed is never
    // reached because printAttendee throws before getting there.
    await waitFor(() => expect(agentPrintHitCount).toBe(1));
    expect(printedHitCount).toBe(0);
  });

  // PR #77 bot-review round, Finding I -- a MarkPrintedError (the agent
  // print SUCCEEDS but the LATER /printed counter-update call fails) must be
  // distinguished from a genuine print failure: the badge may already be
  // printing/printed, so telling the operator to reprint (printError's own
  // copy) would invite an unnecessary duplicate print.
  it("sets printMarkFailed (not printError) when the print succeeds but mark-printed fails", async () => {
    server.use(
      http.post("http://api.test/api/attendees/:attendeeId/printed", () =>
        HttpResponse.json({ error: "boom" }, { status: 500 }),
      ),
    );
    const { result } = renderFlow();
    await settleFonts();

    void result.current.submitCode(ATTENDEE.code);

    await waitFor(() => expect(result.current.state.status).toBe("verdict"));
    expect(result.current.state.verdict).toBe("allowed");
    await waitFor(() => expect(agentPrintHitCount).toBe(1));
    expect(result.current.state.printMarkFailed).toEqual({ printer: "Zebra_ZD421" });
    expect(result.current.state.printError).toBeUndefined();
  });

  // PR #77 bot-review round 2, Finding 2 -- auto-print must not be ATTEMPTED
  // at all while `printBadge.fontsStatus` hasn't reached a terminal state
  // yet (`ready`/`error`) -- calling printAttendee while fonts are still
  // loading risks its own internal wait resolving against a stale,
  // pre-load `fontFaces.families` closure and throwing a spurious
  // MissingFontError for a purely timing reason. The checkin POST is
  // artificially delayed (buildCheckinResponse-based override) so the
  // checked_in outcome deterministically resolves WHILE the (separately
  // delayed) font-file fetch below is still in flight.
  it("does not call printAttendee (and sets printFontsPending) when a checked_in scan resolves while event fonts are still loading", async () => {
    server.use(
      http.get("http://api.test/api/events/:eventId/fonts", () => HttpResponse.json([fontListItem("f1", "TestFont")])),
      http.get("http://api.test/api/fonts/:id/file", async () => {
        await delay(300);
        return HttpResponse.arrayBuffer(FAKE_FONT_BYTES);
      }),
      http.post("http://api.test/api/events/:eventId/checkin", async ({ request }) => {
        const body = (await request.json()) as { attendee_id: string; station_id?: string | null };
        await delay(100);
        return HttpResponse.json(buildCheckinResponse(body));
      }),
    );
    const { result } = renderFlow();

    void result.current.submitCode(ATTENDEE.code);

    await waitFor(() => expect(result.current.state.status).toBe("verdict"));
    expect(result.current.state.verdict).toBe("allowed");
    expect(result.current.state.printFontsPending).toBe(true);
    expect(result.current.state.printError).toBeUndefined();
    expect(result.current.state.printMarkFailed).toBeUndefined();

    // Give a (wrong) print attempt a chance to fire (and the delayed font
    // file fetch a chance to finish) before asserting the print never
    // happened -- this is a hard skip, not a deferred retry.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(agentPrintHitCount).toBe(0);
    expect(printedHitCount).toBe(0);
  });

  // Regression guard for the fix above: once fonts have genuinely settled to
  // "ready" (settleFonts(), matching a real station where an operator's
  // first physical scan happens well after mount), auto-print must still
  // proceed exactly as before.
  it("still calls printAttendee when fonts are already ready by the time a checked_in scan resolves (no regression)", async () => {
    const { result } = renderFlow();
    await settleFonts();

    void result.current.submitCode(ATTENDEE.code);

    await waitFor(() => expect(result.current.state.status).toBe("verdict"));
    expect(result.current.state.printFontsPending).toBeFalsy();
    await waitFor(() => expect(agentPrintHitCount).toBe(1));
    await waitFor(() => expect(printedHitCount).toBe(1));
  });

  // PR #77 bot-review round 2, Finding 2 -- "terminal" per the OTHER print
  // surfaces' own `fontsStatus !== "ready" && fontsStatus !== "error"`
  // gating (AttendeeDrawer.tsx's reprintFontsBlocking / BulkBar.tsx's
  // printFontsBlocking) means "error" counts as terminal too, not just
  // "ready" -- an errored fonts fetch still unblocks the gate (matching
  // their exact behavior) since generation proceeds native-only rather than
  // waiting forever on a list that will never load.
  it("still attempts auto-print when fontsStatus is 'error' (a terminal state, not loading)", async () => {
    server.use(
      http.get("http://api.test/api/events/:eventId/fonts", () => HttpResponse.json({ error: "boom" }, { status: 500 })),
    );
    const { result } = renderFlow();
    await settleFonts();

    void result.current.submitCode(ATTENDEE.code);

    await waitFor(() => expect(result.current.state.status).toBe("verdict"));
    expect(result.current.state.printFontsPending).toBeFalsy();
    await waitFor(() => expect(agentPrintHitCount).toBe(1));
  });

  // PR #77 bot-review round, Finding F -- a genuine failure resolving the
  // check-in itself (not a print failure, which resolveCheckin already
  // swallows into printError/printMarkFailed) must not leave the flow stuck
  // -- it resets to idle AND records `requestError` so the caller/UI has
  // something to show instead of a scan silently vanishing.
  it("resets to idle and sets requestError when the check-in POST itself fails, and the promise still rejects for a caller that awaits it", async () => {
    server.use(
      http.post("http://api.test/api/events/:eventId/checkin", () =>
        HttpResponse.json({ error: "boom" }, { status: 500 }),
      ),
    );
    const { result } = renderFlow();

    await expect(result.current.submitCode(ATTENDEE.code)).rejects.toBeDefined();

    await waitFor(() => expect(result.current.state.status).toBe("idle"));
    expect(result.current.state.requestError).toBeDefined();
    expect(result.current.state.verdict).toBeUndefined();
  });

  it("clear() resets to idle and cancels a pending auto-dismiss timer", async () => {
    const { result } = renderFlow();

    void result.current.submitCode(ATTENDEE.code);
    await waitFor(() => expect(result.current.state.status).toBe("verdict"));

    result.current.clear();
    await waitFor(() => expect(result.current.state.status).toBe("idle"));
    expect(result.current.state.verdict).toBeUndefined();
  });

  // PR #77 bot-review round 3, Finding 5 -- the station route can be
  // navigated directly from one station's URL to another (browser back/
  // forward, a bookmarked link) without necessarily remounting the whole
  // component tree -- a lingering verdict/pending auto-dismiss timer from
  // the PREVIOUS station must never bleed into a DIFFERENT station's page.
  it("resets to idle and clears the previous station's pending auto-dismiss timer when eventId/stationId change (no remount)", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    function wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    }
    // A dismiss window for the FIRST station long enough that it must NOT
    // have naturally elapsed by the time the tight-timeout check just below
    // observes "idle" -- that check must only be satisfiable by the
    // explicit navigation-reset effect, never by this timer coincidentally
    // firing on its own schedule.
    const stationOneSettings: CheckinSettings = { ...DEFAULT_CHECKIN_SETTINGS, verdict_auto_dismiss_sec: 0.3 };
    // A much longer window for the SECOND station -- irrelevant to this
    // test's own assertions, just far enough out that it can't itself fire
    // during the window being observed below.
    const stationTwoSettings: CheckinSettings = { ...DEFAULT_CHECKIN_SETTINGS, verdict_auto_dismiss_sec: 5 };

    const { result, rerender } = renderHook(
      (props: UseCheckinFlowOptions) => useCheckinFlow(props),
      {
        wrapper,
        initialProps: {
          eventId: "evt-1",
          stationId: "st-1",
          settings: stationOneSettings,
          printerName: "Zebra_ZD421",
        },
      },
    );

    void result.current.submitCode(ATTENDEE.code);
    await waitFor(() => expect(result.current.state.status).toBe("verdict"));
    expect(result.current.state.verdict).toBe("allowed");

    rerender({
      eventId: "evt-2",
      stationId: "st-2",
      settings: stationTwoSettings,
      printerName: "Zebra_ZD421",
    });

    // A DELIBERATELY tight timeout (well under station one's own 300ms
    // dismiss window) -- this can only pass via the explicit
    // navigation-triggered reset, never via station one's timer happening
    // to elapse on its own natural schedule.
    await waitFor(() => expect(result.current.state.status).toBe("idle"), { timeout: 150 });
    expect(result.current.state.verdict).toBeUndefined();

    // A fresh scan on the NEW station, started well before station one's
    // original ~300ms deadline -- proves the busy guard was also reset (a
    // stale "request in flight" flag from station one must not silently
    // drop this), and gives station one's still-pending timer something to
    // wrongly clobber if it was never actually cleared.
    void result.current.submitCode("NO-SUCH-CODE");
    await waitFor(() => expect(result.current.state.status).toBe("verdict"));
    expect(result.current.state.verdict).toBe("not_registered");

    // Past station one's original (now-stale) ~300ms dismiss deadline, but
    // well before station two's own real 5s one -- if the stale timer had
    // NOT been cleared, it fires here and wipes the verdict just set above
    // back to idle.
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(result.current.state.status).toBe("verdict");
    expect(result.current.state.verdict).toBe("not_registered");
  });

  it("auto-dismisses back to idle after settings.verdict_auto_dismiss_sec, without an explicit clear()", async () => {
    // A short-but-real interval rather than fake timers (no fake-timer
    // precedent exists anywhere in this repo, and this hook's dismiss timer
    // races real MSW-mediated network promises -- a real, short interval
    // keeps this deterministic without risking a fake-clock/interceptor
    // interaction bug). 0.1s is well under any reasonable test timeout and
    // still exercises the exact `verdict_auto_dismiss_sec * 1000` math.
    const settings: CheckinSettings = { ...DEFAULT_CHECKIN_SETTINGS, print_on_checkin: false, verdict_auto_dismiss_sec: 0.1 };
    const { result } = renderFlow({ settings });

    void result.current.submitCode(ATTENDEE.code);
    await waitFor(() => expect(result.current.state.status).toBe("verdict"));

    await waitFor(() => expect(result.current.state.status).toBe("idle"), { timeout: 2000 });
    expect(result.current.state.verdict).toBeUndefined();
  });
});
