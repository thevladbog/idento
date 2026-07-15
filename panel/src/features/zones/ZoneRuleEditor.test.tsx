import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { ZoneRuleEditor } from "./ZoneRuleEditor";
import { startMswServer } from "../../test/msw";
import "../../shared/i18n";

let rulesResponse: unknown[] = [];
let rulesStatus = 200;
let putBodies: unknown[] = [];
let putStatus = 200;
let putDelayMs = 0;

const server = startMswServer(
  http.get("http://api.test/api/zones/:zoneId/access-rules", () => {
    if (rulesStatus !== 200) {
      return HttpResponse.json({ error: "boom" }, { status: rulesStatus });
    }
    return HttpResponse.json(rulesResponse);
  }),
  http.put("http://api.test/api/zones/:zoneId/access-rules", async ({ request }) => {
    const body = await request.json();
    putBodies.push(body);
    if (putDelayMs) await delay(putDelayMs);
    if (putStatus !== 200) {
      return HttpResponse.json({ error: "boom" }, { status: putStatus });
    }
    return HttpResponse.json({ message: "updated" });
  }),
);
void server;

function simpleRule(id: string, category: string) {
  return {
    id, zone_id: "z1", category, allowed: true, time_from: null, time_to: null, created_at: "2026-01-01T00:00:00Z",
  };
}

function complexRule(
  id: string,
  category: string,
  allowed: boolean,
  timeFrom: string | null,
  timeTo: string | null,
) {
  return {
    id, zone_id: "z1", category, allowed, time_from: timeFrom, time_to: timeTo, created_at: "2026-01-01T00:00:00Z",
  };
}

function renderEditor(overrides?: { onSaved?: () => void; onDirtyChange?: (d: boolean) => void; onBusyChange?: (b: boolean) => void }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onSaved = overrides?.onSaved ?? vi.fn();
  const onDirtyChange = overrides?.onDirtyChange ?? vi.fn();
  const onBusyChange = overrides?.onBusyChange ?? vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <ZoneRuleEditor
        eventId="evt-1"
        zoneId="z1"
        onSaved={onSaved}
        onDirtyChange={onDirtyChange}
        onBusyChange={onBusyChange}
      />
    </QueryClientProvider>,
  );
  return {
    queryClient, onSaved, onDirtyChange, onBusyChange,
  };
}

describe("ZoneRuleEditor", () => {
  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test" };
    rulesResponse = [simpleRule("r1", "vip")];
    rulesStatus = 200;
    putBodies = [];
    putStatus = 200;
    putDelayMs = 0;
  });

  it("renders the sentence UI per simple clause, and + or condition adds a new blank clause", async () => {
    renderEditor();

    expect(await screen.findByText("Access when")).toBeInTheDocument();
    expect(screen.getByText("Category")).toBeInTheDocument();
    expect(screen.getByText("is")).toBeInTheDocument();
    expect(screen.getByLabelText("Category value 1")).toHaveValue("vip");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "+ or condition" }));

    expect(screen.getByLabelText("Category value 2")).toHaveValue("");
  });

  it("removes a clause via its own remove button", async () => {
    rulesResponse = [simpleRule("r1", "vip"), simpleRule("r2", "staff")];
    renderEditor();
    await screen.findByLabelText("Category value 2");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Remove condition 1" }));

    expect(screen.queryByDisplayValue("vip")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Category value 1")).toHaveValue("staff");
  });

  it("renders complex rules (allowed=false, or time-windowed) read-only, and includes them verbatim in the PUT payload alongside simple clauses", async () => {
    rulesResponse = [
      simpleRule("r1", "vip"),
      complexRule("r2", "staff", false, null, null),
      complexRule("r3", "press", true, "09:00", "18:00"),
    ];
    renderEditor();
    await screen.findByLabelText("Category value 1");

    // Read-only rendering: names category + window/denial, no input for these.
    expect(screen.getByText("staff — denied")).toBeInTheDocument();
    expect(screen.getByText("press — 09:00–18:00")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("staff")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("press")).not.toBeInTheDocument();
    // Only the one simple rule is editable.
    expect(screen.queryByLabelText("Category value 2")).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(putBodies).toHaveLength(1));
    expect(putBodies[0]).toEqual([
      { category: "vip", allowed: true },
      { category: "staff", allowed: false, time_from: null, time_to: null },
      { category: "press", allowed: true, time_from: "09:00", time_to: "18:00" },
    ]);
  });

  it("disables Save while any clause is blank (trimmed) or duplicated (case-sensitive exact)", async () => {
    renderEditor();
    await screen.findByLabelText("Category value 1");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "+ or condition" }));

    // Second clause is blank -> Save disabled.
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    // Different case is NOT a duplicate (case-sensitive exact match).
    await user.type(screen.getByLabelText("Category value 2"), "VIP");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();

    // Exact duplicate (after trim) -> Save disabled again.
    await user.clear(screen.getByLabelText("Category value 2"));
    await user.type(screen.getByLabelText("Category value 2"), "  vip  ");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByText("Fill in every condition and remove duplicates before saving.")).toBeInTheDocument();
  });

  it("Save success collapses the editor (onSaved) and invalidates ZONE_RULES_KEY and ZONES_KEY, never setQueryData", async () => {
    const { queryClient, onSaved } = renderEditor();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const setQueryDataSpy = vi.spyOn(queryClient, "setQueryData");
    await screen.findByLabelText("Category value 1");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(setQueryDataSpy).not.toHaveBeenCalled();
    const invalidatedKeys = invalidateSpy.mock.calls.map((call) => (call[0] as { queryKey: unknown[] }).queryKey);
    expect(invalidatedKeys).toContainEqual(["get", "/api/zones/{zone_id}/access-rules", { params: { path: { zone_id: "z1" } } }]);
    expect(invalidatedKeys).toContainEqual(["get", "/api/events/{event_id}/zones", { params: { path: { event_id: "evt-1" } } }]);
  });

  it("Save failure keeps the editor open and shows the error", async () => {
    putStatus = 500;
    const { onSaved } = renderEditor();
    await screen.findByLabelText("Category value 1");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Couldn't save the access rules. Try again.")).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Category value 1")).toHaveValue("vip");
  });

  it("busy-gating: while the PUT is pending, Save/Cancel/the clause input/remove/add are all inert", async () => {
    putDelayMs = 50;
    const onBusyChange = vi.fn();
    renderEditor({ onBusyChange });
    await screen.findByLabelText("Category value 1");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByLabelText("Category value 1")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove condition 1" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "+ or condition" })).toBeDisabled();
    await waitFor(() => expect(onBusyChange).toHaveBeenCalledWith(true));

    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled());
    expect(screen.getByLabelText("Category value 1")).toBeEnabled();
    expect(onBusyChange).toHaveBeenCalledWith(false);
  });

  it("Cancel resets local clauses to the fetched rules", async () => {
    renderEditor();
    await screen.findByLabelText("Category value 1");

    const user = userEvent.setup();
    await user.clear(screen.getByLabelText("Category value 1"));
    await user.type(screen.getByLabelText("Category value 1"), "changed");
    await user.click(screen.getByRole("button", { name: "+ or condition" }));
    expect(screen.getByLabelText("Category value 2")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByLabelText("Category value 1")).toHaveValue("vip");
    expect(screen.queryByLabelText("Category value 2")).not.toBeInTheDocument();
  });

  it("rules fetch error shows error copy only, with no editable surface (never edit over unverifiable state)", async () => {
    rulesStatus = 500;
    renderEditor();

    expect(await screen.findByText("Couldn't load access rules.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ or condition" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });
});
