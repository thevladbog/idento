// P3.2 Task 8 -- usePrintBadge tests.
//
// The shared print-one-attendee flow (drawer Reprint + Task 9's bulk loop
// both consume this hook). Exercises BOTH MSW origins: the backend
// (`http://api.test`, for the badge-template/fonts/printed/list/detail
// endpoints) and the agent (`http://agent.test`, for `agentClient.print`) --
// same combined-origin shape TestPrintDialog.test.tsx established.
//
// Generation correctness itself (native vs. raster text, exact ZPL strings)
// is already pinned by generateZpl.test.ts -- this file only needs ONE Latin
// (native-path, jsdom-viable) fixture to prove the hook wires template fetch
// -> generation -> agent print -> mark-printed -> invalidation correctly.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { MarkPrintedError, NoTemplateError, usePrintBadge } from "./usePrintBadge";
import { useAttendeeDetail } from "../../attendees/hooks";
import { useAttendeesPage } from "../../attendees/hooks";
import { startMswServer } from "../../../test/msw";
import type { components } from "../../../shared/api/schema";

type Attendee = components["schemas"]["Attendee"];

const ATTENDEE: Attendee = {
  id: "a1",
  event_id: "evt-1",
  first_name: "Ada",
  last_name: "Lovelace",
  email: "ada@example.com",
  company: "Analytical Engines",
  position: "Engineer",
  code: "PD-0107",
  checkin_status: false,
  printed_count: 0,
  blocked: false,
  packet_delivered: false,
};

const TEMPLATE_DOC = {
  width_mm: 90,
  height_mm: 55,
  dpi: 300,
  elements: [{ id: "e1", type: "text", x: 0, y: 0, fontSize: 10, source: "first_name", text: "Guest" }],
};

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

let templateResponse: { template: Record<string, unknown> | null; version: number } = {
  template: TEMPLATE_DOC,
  version: 1,
};
let printCapture: { printer_name: string; zpl: string } | null = null;
let printHitCount = 0;
let printStatus = 200;
let markPrintedStatus = 200;
let markPrintedHitCount = 0;
let listHitCount = 0;
let detailHitCount = 0;

const server = startMswServer(
  http.get("http://api.test/api/events/:id/badge-template", () => HttpResponse.json(templateResponse)),
  http.get("http://api.test/api/events/:eventId/fonts", () => HttpResponse.json([])),
  http.get("http://api.test/api/events/:eventId/attendees", () => {
    listHitCount += 1;
    return HttpResponse.json({ attendees: [], total: 0, page: 1, per_page: 50 });
  }),
  http.get("http://api.test/api/attendees/:id", () => {
    detailHitCount += 1;
    return HttpResponse.json(ATTENDEE);
  }),
  http.post("http://api.test/api/attendees/:attendeeId/printed", () => {
    markPrintedHitCount += 1;
    if (markPrintedStatus !== 200) {
      return HttpResponse.json({ error: "boom" }, { status: markPrintedStatus });
    }
    return HttpResponse.json({ printed_count: markPrintedHitCount });
  }),
  http.get("http://agent.test/health", () => new HttpResponse(null, { status: 200 })),
  http.post("http://agent.test/print", async ({ request }) => {
    printHitCount += 1;
    printCapture = (await request.json()) as { printer_name: string; zpl: string };
    if (printStatus !== 200) return new HttpResponse("printer offline", { status: printStatus });
    return HttpResponse.json({ status: "printed" });
  }),
);
void server;

// Genuinely subscribed observers (AttendeeDrawer.test.tsx's own
// AttendeesListObserver pattern) -- proves the hook's invalidation calls
// produce an OBSERVABLE refetch, not just an asserted `invalidateQueries`
// call in isolation.
function ListObserver() {
  useAttendeesPage("evt-1", { page: 1 });
  return null;
}
function DetailObserver() {
  useAttendeeDetail("a1");
  return null;
}

function renderPrintBadge(withObservers = false) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {withObservers ? (
          <>
            <ListObserver />
            <DetailObserver />
          </>
        ) : null}
        {children}
      </QueryClientProvider>
    );
  }
  return renderHook(() => usePrintBadge("evt-1"), { wrapper });
}

describe("usePrintBadge", () => {
  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test", AGENT_URL: "http://agent.test" };
    templateResponse = { template: TEMPLATE_DOC, version: 1 };
    printCapture = null;
    printHitCount = 0;
    printStatus = 200;
    markPrintedStatus = 200;
    markPrintedHitCount = 0;
    listHitCount = 0;
    detailHitCount = 0;
    stubFontFaceApi();
  });

  afterEach(() => {
    unstubFontFaceApi();
  });

  it("prints the resolved attendee data, marks the attendee printed, and invalidates the list AND detail queries", async () => {
    const { result } = renderPrintBadge(true);
    await waitFor(() => expect(result.current.fontsStatus).toBe("ready"));
    await waitFor(() => expect(listHitCount).toBe(1));
    await waitFor(() => expect(detailHitCount).toBe(1));

    await act(async () => {
      await result.current.printAttendee(ATTENDEE, "Zebra_ZD421");
    });

    expect(printCapture?.printer_name).toBe("Zebra_ZD421");
    // Resolved `first_name` binding ("Ada"), not the element's literal
    // fallback text ("Guest") -- proves attendeeToPreviewData actually fed
    // the generator, not some other snapshot.
    expect(printCapture?.zpl).toContain("^FDAda^FS");
    expect(printCapture?.zpl).not.toContain("Guest");
    expect(markPrintedHitCount).toBe(1);

    await waitFor(() => expect(listHitCount).toBeGreaterThan(1));
    await waitFor(() => expect(detailHitCount).toBeGreaterThan(1));
  });

  it("throws a typed NoTemplateError and never calls the agent when the event has no badge template", async () => {
    templateResponse = { template: null, version: 0 };
    const { result } = renderPrintBadge();

    await expect(result.current.printAttendee(ATTENDEE, "Zebra_ZD421")).rejects.toThrow(NoTemplateError);

    expect(printCapture).toBeNull();
    expect(printHitCount).toBe(0);
    expect(markPrintedHitCount).toBe(0);
  });

  it("throws a typed MarkPrintedError (not a generic failure) when mark-printed 500s after a successful send, and does not retry the print", async () => {
    markPrintedStatus = 500;
    const { result } = renderPrintBadge(true);
    await waitFor(() => expect(result.current.fontsStatus).toBe("ready"));
    await waitFor(() => expect(listHitCount).toBe(1));
    await waitFor(() => expect(detailHitCount).toBe(1));

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.printAttendee(ATTENDEE, "Zebra_ZD421");
      } catch (error) {
        caught = error;
      }
    });

    expect(caught).toBeInstanceOf(MarkPrintedError);
    // The send genuinely happened -- exactly once, never retried because the
    // DOWNSTREAM mark-printed call failed.
    expect(printHitCount).toBe(1);
    expect(printCapture?.printer_name).toBe("Zebra_ZD421");

    // Unconditional invalidation: the send happened even though mark-printed
    // failed, so both queries still refetch.
    await waitFor(() => expect(listHitCount).toBeGreaterThan(1));
    await waitFor(() => expect(detailHitCount).toBeGreaterThan(1));
  });

  it("skips invalidation for this call when skipInvalidate is set (Task 9's bulk loop dedupe)", async () => {
    const { result } = renderPrintBadge(true);
    await waitFor(() => expect(result.current.fontsStatus).toBe("ready"));
    await waitFor(() => expect(listHitCount).toBe(1));
    await waitFor(() => expect(detailHitCount).toBe(1));

    await act(async () => {
      await result.current.printAttendee(ATTENDEE, "Zebra_ZD421", { skipInvalidate: true });
    });

    expect(markPrintedHitCount).toBe(1);
    // Give any (incorrect) async invalidation a chance to fire before asserting its absence.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(listHitCount).toBe(1);
    expect(detailHitCount).toBe(1);
  });
});
