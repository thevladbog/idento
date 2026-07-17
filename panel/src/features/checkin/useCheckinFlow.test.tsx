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
import { http, HttpResponse } from "msw";
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
    checkinHitCount += 1;
    const body = (await request.json()) as { attendee_id: string; station_id?: string | null };
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
    return HttpResponse.json({ outcome: checkinOutcome, attendee, checkin });
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

  it("clear() resets to idle and cancels a pending auto-dismiss timer", async () => {
    const { result } = renderFlow();

    void result.current.submitCode(ATTENDEE.code);
    await waitFor(() => expect(result.current.state.status).toBe("verdict"));

    result.current.clear();
    await waitFor(() => expect(result.current.state.status).toBe("idle"));
    expect(result.current.state.verdict).toBeUndefined();
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
