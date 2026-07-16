import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  render, screen, waitFor, within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { ZoneFormDialog } from "./ZoneFormDialog";
import { useEventReadiness } from "../events/hooks";
import { startMswServer } from "../../test/msw";
import "../../shared/i18n";
import type { components } from "../../shared/api/schema";

// Genuinely subscribed observer for GET /api/events/:id/readiness — same
// pattern as DangerZoneCard.test.tsx's ListObserver.
function ReadinessObserver({ eventId }: { eventId: string }) {
  useEventReadiness(eventId);
  return null;
}

type EventZone = components["schemas"]["EventZone"];
type EventZoneWithStats = components["schemas"]["EventZoneWithStats"];

function zoneWithStats(id: string, orderIndex: number, color?: string): EventZoneWithStats {
  return {
    zone: {
      id,
      event_id: "evt-1",
      name: `Zone ${id}`,
      zone_type: "general",
      order_index: orderIndex,
      is_registration_zone: false,
      requires_registration: false,
      is_active: true,
      settings: color ? { color } : undefined,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
    total_checkins: 0,
    today_checkins: 0,
    assigned_staff: 0,
    access_rules_count: 0,
  };
}

const FULL_ZONE: EventZone = {
  id: "z-vip",
  event_id: "evt-1",
  name: "VIP Lounge",
  zone_type: "vip",
  order_index: 3,
  open_time: "09:00",
  close_time: "18:00",
  is_registration_zone: false,
  requires_registration: true,
  is_active: true,
  settings: { color: "blue", external_id: "crm-42" },
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
};

let existingZones: EventZoneWithStats[] = [];
let createCount = 0;
let lastCreateBody: unknown;
let createDelayMs = 0;
let updateCount = 0;
let lastUpdateBody: unknown;
let lastUpdateId: string | undefined;
let zonesFetchCount = 0;
let zonesGetStatus = 200;
let readinessHitCount = 0;

const server = startMswServer(
  http.get("http://api.test/api/events/:id/readiness", () => {
    readinessHitCount += 1;
    return HttpResponse.json({ ready: false, steps: [] });
  }),
  http.get("http://api.test/api/events/:eventId/zones", () => {
    zonesFetchCount += 1;
    if (zonesGetStatus !== 200) {
      return HttpResponse.json({ error: "boom" }, { status: zonesGetStatus });
    }
    return HttpResponse.json(existingZones);
  }),
  http.post("http://api.test/api/events/:eventId/zones", async ({ request }) => {
    createCount += 1;
    lastCreateBody = await request.json();
    if (createDelayMs) await delay(createDelayMs);
    return HttpResponse.json({ ...FULL_ZONE, id: "z-new" }, { status: 201 });
  }),
  http.put("http://api.test/api/zones/:id", async ({ request, params }) => {
    updateCount += 1;
    lastUpdateId = params.id as string;
    lastUpdateBody = await request.json();
    if (createDelayMs) await delay(createDelayMs);
    return HttpResponse.json(FULL_ZONE);
  }),
);
void server;

function renderWithProviders(ui: ReactNode, queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return { queryClient, ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>) };
}

describe("ZoneFormDialog", () => {
  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test" };
    existingZones = [];
    createCount = 0;
    lastCreateBody = undefined;
    createDelayMs = 0;
    updateCount = 0;
    lastUpdateBody = undefined;
    lastUpdateId = undefined;
    zonesFetchCount = 0;
    zonesGetStatus = 200;
    readinessHitCount = 0;
  });

  describe("create mode", () => {
    it("shows a name-required error (message key) and does not call the API when the name is empty", async () => {
      const user = userEvent.setup();
      renderWithProviders(<ZoneFormDialog eventId="evt-1" open onOpenChange={vi.fn()} />);

      await user.click(screen.getByRole("button", { name: "Create zone" }));

      expect(await screen.findByText("Give the zone a name.")).toBeInTheDocument();
      expect(createCount).toBe(0);
    });

    it("renders 4 color swatches as a radio group, defaulting to the first color not used by an existing zone", async () => {
      existingZones = [zoneWithStats("z1", 0, "green"), zoneWithStats("z2", 1, "amber"), zoneWithStats("z3", 2, "blue")];
      renderWithProviders(<ZoneFormDialog eventId="evt-1" open onOpenChange={vi.fn()} />);

      const group = await screen.findByRole("radiogroup");
      const radios = within(group).getAllByRole("radio");
      expect(radios).toHaveLength(4);
      await waitFor(() => expect(screen.getByRole("radio", { name: "Slate" })).toBeChecked());
      expect(screen.getByRole("radio", { name: "Green" })).not.toBeChecked();
    });

    it("defaults to green when every color is already used by an existing zone", async () => {
      existingZones = [
        zoneWithStats("z1", 0, "green"),
        zoneWithStats("z2", 1, "amber"),
        zoneWithStats("z3", 2, "blue"),
        zoneWithStats("z4", 3, "slate"),
      ];
      renderWithProviders(<ZoneFormDialog eventId="evt-1" open onOpenChange={vi.fn()} />);

      await screen.findByRole("radiogroup");
      await waitFor(() => expect(zonesFetchCount).toBeGreaterThan(0));
      expect(screen.getByRole("radio", { name: "Green" })).toBeChecked();
    });

    it("defaults to green when there are no existing zones", async () => {
      renderWithProviders(<ZoneFormDialog eventId="evt-1" open onOpenChange={vi.fn()} />);

      await screen.findByRole("radiogroup");
      await waitFor(() => expect(zonesFetchCount).toBeGreaterThan(0));
      expect(screen.getByRole("radio", { name: "Green" })).toBeChecked();
    });

    it("posts the exact create body: name, zone_type general, order_index = max existing + 1, defaults, and the picked color", async () => {
      existingZones = [zoneWithStats("z1", 0, "green"), zoneWithStats("z2", 1, "amber")];
      const user = userEvent.setup();
      renderWithProviders(<ZoneFormDialog eventId="evt-1" open onOpenChange={vi.fn()} />);

      await screen.findByRole("radiogroup");
      await user.type(screen.getByLabelText("Name"), "Backstage");
      await user.click(screen.getByRole("button", { name: "Create zone" }));

      await waitFor(() => expect(createCount).toBe(1));
      expect(lastCreateBody).toEqual({
        name: "Backstage",
        zone_type: "general",
        order_index: 2,
        is_active: true,
        is_registration_zone: false,
        requires_registration: false,
        settings: { color: "blue" },
      });
    });

    it("closes the dialog and invalidates ZONES_KEY AND readiness (P2 fix — creating a zone changes the zones-readiness step) on a successful create", async () => {
      const user = userEvent.setup();
      const onOpenChange = vi.fn();
      const { queryClient } = renderWithProviders(
        <>
          <ReadinessObserver eventId="evt-1" />
          <ZoneFormDialog eventId="evt-1" open onOpenChange={onOpenChange} />
        </>,
      );
      await waitFor(() => expect(readinessHitCount).toBe(1));
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

      await user.type(screen.getByLabelText("Name"), "Backstage");
      await user.click(screen.getByRole("button", { name: "Create zone" }));

      await waitFor(() => expect(createCount).toBe(1));
      expect(onOpenChange).toHaveBeenCalledWith(false);
      await waitFor(() =>
        expect(invalidateSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            queryKey: ["get", "/api/events/{event_id}/zones", { params: { path: { event_id: "evt-1" } } }],
          }),
        ),
      );
      // The genuinely subscribed readiness observer actually refetches.
      await waitFor(() => expect(readinessHitCount).toBeGreaterThan(1));
    });

    it("blocks Cancel/Escape/outside-click dismissal while the create request is in flight", async () => {
      createDelayMs = 60;
      const user = userEvent.setup();
      const onOpenChange = vi.fn();
      renderWithProviders(<ZoneFormDialog eventId="evt-1" open onOpenChange={onOpenChange} />);

      await user.type(screen.getByLabelText("Name"), "Backstage");
      await user.click(screen.getByRole("button", { name: "Create zone" }));

      await waitFor(() => expect(createCount).toBe(1));
      const cancelButtons = screen.getAllByRole("button", { name: "Cancel" });
      expect(cancelButtons).toHaveLength(1);
      expect(cancelButtons[0]).toBeDisabled();

      await user.click(cancelButtons[0]);
      await user.keyboard("{Escape}");
      expect(onOpenChange).not.toHaveBeenCalled();
      expect(screen.getByRole("dialog")).toBeInTheDocument();

      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    });

    it("blocks submit (no POST) and shows the load error when the zones list fetch fails — never fabricates order_index/color from the empty fallback", async () => {
      zonesGetStatus = 500;
      const user = userEvent.setup();
      renderWithProviders(<ZoneFormDialog eventId="evt-1" open onOpenChange={vi.fn()} />);

      // Let the zones GET settle to ERROR (isLoading is false from here on,
      // which is exactly the state that must still block submission).
      await waitFor(() => expect(zonesFetchCount).toBeGreaterThan(0));
      expect(await screen.findByText("Couldn't load zones.")).toBeInTheDocument();

      await user.type(screen.getByLabelText("Name"), "Backstage");
      const submitButton = screen.getByRole("button", { name: "Create zone" });
      expect(submitButton).toBeDisabled();

      await user.click(submitButton);
      expect(createCount).toBe(0);
    });

    it("does not let a stale success close or reset a dialog session that was already closed and reopened", async () => {
      createDelayMs = 80;
      const user = userEvent.setup();
      const onOpenChange = vi.fn();
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const { rerender } = render(
        <QueryClientProvider client={queryClient}>
          <ZoneFormDialog eventId="evt-1" open onOpenChange={onOpenChange} />
        </QueryClientProvider>,
      );

      await user.type(screen.getByLabelText("Name"), "Backstage");
      await user.click(screen.getByRole("button", { name: "Create zone" }));
      await waitFor(() => expect(createCount).toBe(1));

      // Force-close (simulating a parent closing it out from under the
      // pending request) and reopen for a fresh session.
      rerender(
        <QueryClientProvider client={queryClient}>
          <ZoneFormDialog eventId="evt-1" open={false} onOpenChange={onOpenChange} />
        </QueryClientProvider>,
      );
      rerender(
        <QueryClientProvider client={queryClient}>
          <ZoneFormDialog eventId="evt-1" open onOpenChange={onOpenChange} />
        </QueryClientProvider>,
      );

      expect(screen.getByLabelText("Name")).toHaveValue("");

      await user.type(screen.getByLabelText("Name"), "New Session Zone");
      onOpenChange.mockClear();

      // Let the first (stale) create's delayed response resolve well after
      // the reopen — it must not close the new session.
      await new Promise((resolve) => setTimeout(resolve, 120));

      expect(onOpenChange).not.toHaveBeenCalled();
      expect(screen.getByLabelText("Name")).toHaveValue("New Session Zone");
    });
  });

  describe("edit mode", () => {
    it("prefills the name and the color swatch from the zone", async () => {
      renderWithProviders(<ZoneFormDialog eventId="evt-1" open onOpenChange={vi.fn()} zone={FULL_ZONE} />);

      expect(await screen.findByLabelText("Name")).toHaveValue("VIP Lounge");
      expect(screen.getByRole("radio", { name: "Blue" })).toBeChecked();
    });

    it("PUTs the complete merged body — every zone field verbatim except the edited name/color, foreign settings keys preserved", async () => {
      const user = userEvent.setup();
      renderWithProviders(<ZoneFormDialog eventId="evt-1" open onOpenChange={vi.fn()} zone={FULL_ZONE} />);

      const nameInput = await screen.findByLabelText("Name");
      await user.clear(nameInput);
      await user.type(nameInput, "VIP Lounge Updated");
      await user.click(screen.getByRole("radio", { name: "Amber" }));
      await user.click(screen.getByRole("button", { name: "Save changes" }));

      await waitFor(() => expect(updateCount).toBe(1));
      expect(lastUpdateId).toBe("z-vip");
      expect(lastUpdateBody).toEqual({
        name: "VIP Lounge Updated",
        zone_type: "vip",
        order_index: 3,
        open_time: "09:00",
        close_time: "18:00",
        is_registration_zone: false,
        requires_registration: true,
        is_active: true,
        settings: { color: "amber", external_id: "crm-42" },
      });
    });

    it("is not blocked by a failed zones list fetch — the edit body is built from the zone prop, never the list", async () => {
      zonesGetStatus = 500;
      const user = userEvent.setup();
      renderWithProviders(<ZoneFormDialog eventId="evt-1" open onOpenChange={vi.fn()} zone={FULL_ZONE} />);

      await waitFor(() => expect(zonesFetchCount).toBeGreaterThan(0));
      const submitButton = screen.getByRole("button", { name: "Save changes" });
      expect(submitButton).toBeEnabled();

      await user.click(submitButton);
      await waitFor(() => expect(updateCount).toBe(1));
    });

    it("closes the dialog and invalidates ZONES_KEY on a successful edit", async () => {
      const user = userEvent.setup();
      const onOpenChange = vi.fn();
      const { queryClient } = renderWithProviders(
        <ZoneFormDialog eventId="evt-1" open onOpenChange={onOpenChange} zone={FULL_ZONE} />,
      );
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

      await user.click(await screen.findByRole("button", { name: "Save changes" }));

      await waitFor(() => expect(updateCount).toBe(1));
      expect(onOpenChange).toHaveBeenCalledWith(false);
      await waitFor(() =>
        expect(invalidateSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            queryKey: ["get", "/api/events/{event_id}/zones", { params: { path: { event_id: "evt-1" } } }],
          }),
        ),
      );
    });

    // P2 fix scope: a zone EDIT never changes any readiness step's count
    // (only create/delete do), so unlike create mode above, a successful
    // edit must not invalidate READINESS_KEY.
    it("does NOT invalidate readiness on a successful edit — editing a zone changes no counts", async () => {
      const user = userEvent.setup();
      const onOpenChange = vi.fn();
      const { queryClient } = renderWithProviders(
        <ZoneFormDialog eventId="evt-1" open onOpenChange={onOpenChange} zone={FULL_ZONE} />,
      );
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

      await user.click(await screen.findByRole("button", { name: "Save changes" }));

      await waitFor(() => expect(updateCount).toBe(1));
      expect(invalidateSpy).not.toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: ["get", "/api/events/{id}/readiness", { params: { path: { id: "evt-1" } } }],
        }),
      );
    });
  });
});
