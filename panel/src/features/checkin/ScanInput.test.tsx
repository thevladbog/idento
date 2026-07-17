// P4.1 Task 7 -- ScanInput tests. Renders the real useScanInput hook (not
// mocked) against the agent MSW origin, and the real useAttendeesPage
// (Task 5, unmodified) against the backend MSW origin -- same combined-
// origin convention as usePrintBadge.test.tsx / useCheckinFlow.test.tsx.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { ScanInput } from "./ScanInput";
import { startMswServer } from "../../test/msw";
import type { components } from "../../shared/api/schema";
import "../../shared/i18n";

type Attendee = components["schemas"]["Attendee"];

const ADA: Attendee = {
  id: "att-1",
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
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

let attendeesHitCount = 0;
let lastSearchParam: string | null = null;
let scanLastResponse: { code: string; time: string } = { code: "", time: "0001-01-01T00:00:00Z" };
let scanLastShouldError = false;

const server = startMswServer(
  http.get("http://api.test/api/events/:eventId/attendees", ({ request }) => {
    attendeesHitCount += 1;
    const url = new URL(request.url);
    lastSearchParam = url.searchParams.get("search");
    const matches = lastSearchParam && "Ada Lovelace ada@example.com PD-0107".includes(lastSearchParam) ? [ADA] : [];
    return HttpResponse.json({ attendees: matches, total: matches.length, page: 1, per_page: 8 });
  }),
  http.get("http://agent.test/scan/last", () => {
    if (scanLastShouldError) return new HttpResponse(null, { status: 500 });
    return HttpResponse.json(scanLastResponse);
  }),
  http.post("http://agent.test/scan/clear", () => HttpResponse.json({ status: "cleared" })),
);
void server;

function renderScanInput(
  overrides: {
    mode?: "wedge" | "scanner" | "manual";
    enabled?: boolean;
    readOnly?: boolean;
    manualSearchEnabled?: boolean;
  } = {},
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onCode = vi.fn();
  const onPickAttendee = vi.fn();
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  const utils = render(
    <ScanInput
      eventId="evt-1"
      mode={overrides.mode ?? "wedge"}
      enabled={overrides.enabled ?? true}
      readOnly={overrides.readOnly}
      manualSearchEnabled={overrides.manualSearchEnabled ?? true}
      onCode={onCode}
      onPickAttendee={onPickAttendee}
    />,
    { wrapper },
  );
  return { ...utils, onCode, onPickAttendee };
}

const SEARCH_PLACEHOLDER = "Search by name, email, or code…";

describe("ScanInput", () => {
  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test", AGENT_URL: "http://agent.test" };
    attendeesHitCount = 0;
    lastSearchParam = null;
    scanLastResponse = { code: "", time: "0001-01-01T00:00:00Z" };
    scanLastShouldError = false;
  });

  it.each(["wedge", "scanner", "manual"] as const)(
    "renders the manual search box in %s mode when manual_search_enabled is true (the default)",
    (mode) => {
      renderScanInput({ mode });
      expect(screen.getByPlaceholderText(SEARCH_PLACEHOLDER)).toBeInTheDocument();
    },
  );

  it("wedge mode: renders a focused hidden scan input and emits onCode once on Enter", async () => {
    const user = userEvent.setup();
    const { onCode } = renderScanInput({ mode: "wedge" });

    const wedgeInput = screen.getByLabelText("Badge scanner input");
    expect(wedgeInput).toHaveFocus();

    await user.type(wedgeInput, "PD-0107{Enter}");

    expect(onCode).toHaveBeenCalledTimes(1);
    expect(onCode).toHaveBeenCalledWith("PD-0107");
  });

  it("scanner mode: shows a waiting hint normally, and a degraded hint once the agent is unreachable", async () => {
    scanLastShouldError = true;
    renderScanInput({ mode: "scanner" });

    await waitFor(() =>
      expect(screen.getByText("Can't reach the handheld scanner — use manual search below.")).toBeInTheDocument(),
    );
  });

  it("scanner mode: shows the waiting hint (not the degraded one) while the agent is reachable", async () => {
    renderScanInput({ mode: "scanner" });

    await waitFor(() =>
      expect(screen.getByText("Waiting for a scan from the handheld scanner…")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Can't reach the handheld scanner — use manual search below.")).not.toBeInTheDocument();
  });

  it("manual search: typing debounces a ?search= request, and picking a result calls onPickAttendee then clears the box", async () => {
    const user = userEvent.setup();
    const { onPickAttendee } = renderScanInput({ mode: "manual" });

    const searchBox = screen.getByPlaceholderText(SEARCH_PLACEHOLDER);
    await user.type(searchBox, "Ada");

    // Debounced -- no request yet immediately after typing.
    expect(lastSearchParam).toBeNull();

    await waitFor(() => expect(lastSearchParam).toBe("Ada"));
    await waitFor(() => expect(screen.getByText("Ada Lovelace")).toBeInTheDocument());

    await user.click(screen.getByText("Ada Lovelace"));

    expect(onPickAttendee).toHaveBeenCalledTimes(1);
    expect(onPickAttendee).toHaveBeenCalledWith(ADA);
    await waitFor(() => expect(searchBox).toHaveValue(""));
  });

  it("manual search: shows a no-matches message when the search comes back empty", async () => {
    const user = userEvent.setup();
    renderScanInput({ mode: "manual" });

    const searchBox = screen.getByPlaceholderText(SEARCH_PLACEHOLDER);
    await user.type(searchBox, "Nobody");

    await waitFor(() => expect(lastSearchParam).toBe("Nobody"));
    await waitFor(() => expect(screen.getByText("No matching attendees.")).toBeInTheDocument());
  });

  it("does not fire a search request before any text is typed", async () => {
    renderScanInput({ mode: "manual" });
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(attendeesHitCount).toBe(0);
  });

  // P4.1 Task 10 -- degraded mode's "read-only manual search" requirement:
  // StationPage passes `readOnly` while offline so a scan/search can still
  // LOOK someone up, but there is no check-in CTA to attempt (the brief's
  // "look someone up, no check-in button").
  describe("readOnly", () => {
    it("still shows a matched result, but as plain text -- no check-in button, and clicking it calls nothing", async () => {
      const user = userEvent.setup();
      const { onPickAttendee } = renderScanInput({ mode: "manual", readOnly: true });

      const searchBox = screen.getByPlaceholderText(SEARCH_PLACEHOLDER);
      await user.type(searchBox, "Ada");
      await waitFor(() => expect(screen.getByText("Ada Lovelace")).toBeInTheDocument());

      expect(screen.queryByRole("button", { name: /Ada Lovelace/ })).not.toBeInTheDocument();

      await user.click(screen.getByText("Ada Lovelace"));
      expect(onPickAttendee).not.toHaveBeenCalled();
    });

    it("renders a real check-in button (not readOnly) by default", async () => {
      const user = userEvent.setup();
      renderScanInput({ mode: "manual" });

      const searchBox = screen.getByPlaceholderText(SEARCH_PLACEHOLDER);
      await user.type(searchBox, "Ada");
      await waitFor(() => expect(screen.getByRole("button", { name: /Ada Lovelace/ })).toBeInTheDocument());
    });
  });

  // Final cross-task review finding -- `manual_search_enabled`
  // (settingsTypes.ts, Task 5) previously had no consumer at all: the
  // launch ceremony (Task 11) let the operator toggle it and persisted it,
  // but nothing at the station read it back, so the manual search box
  // stayed fully functional regardless of the setting's value. StationPage
  // now threads `settings.manual_search_enabled` into ScanInput as
  // `manualSearchEnabled`.
  describe("manualSearchEnabled", () => {
    it.each(["wedge", "scanner", "manual"] as const)(
      "removes the manual search box entirely in %s mode when manualSearchEnabled is false",
      (mode) => {
        renderScanInput({ mode, manualSearchEnabled: false });
        expect(screen.queryByPlaceholderText(SEARCH_PLACEHOLDER)).not.toBeInTheDocument();
      },
    );

    it("never fires a search request while disabled, even though the box can't be typed into", async () => {
      renderScanInput({ mode: "manual", manualSearchEnabled: false });
      await new Promise((resolve) => setTimeout(resolve, 350));
      expect(attendeesHitCount).toBe(0);
    });

    it("does not affect the wedge scan-input mechanism -- the hidden wedge input still renders and still emits onCode", async () => {
      const user = userEvent.setup();
      const { onCode } = renderScanInput({ mode: "wedge", manualSearchEnabled: false });

      const wedgeInput = screen.getByLabelText("Badge scanner input");
      expect(wedgeInput).toHaveFocus();

      await user.type(wedgeInput, "PD-0107{Enter}");

      expect(onCode).toHaveBeenCalledTimes(1);
      expect(onCode).toHaveBeenCalledWith("PD-0107");
      expect(screen.queryByPlaceholderText(SEARCH_PLACEHOLDER)).not.toBeInTheDocument();
    });

    it("does not affect the scanner mode's own status hint", async () => {
      renderScanInput({ mode: "scanner", manualSearchEnabled: false });

      await waitFor(() =>
        expect(screen.getByText("Waiting for a scan from the handheld scanner…")).toBeInTheDocument(),
      );
      expect(screen.queryByPlaceholderText(SEARCH_PLACEHOLDER)).not.toBeInTheDocument();
    });
  });
});
