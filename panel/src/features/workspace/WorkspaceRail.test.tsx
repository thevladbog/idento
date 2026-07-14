import { RouterContextProvider, createRootRoute, createRouter } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { WorkspaceRail } from "./WorkspaceRail";
import type { components } from "../../shared/api/schema";
import "../../shared/i18n";

type EventReadinessResponse = components["schemas"]["EventReadinessResponse"];

// WorkspaceRail renders two `Link`s (Overview -> /events/$eventId, Settings ->
// /events/$eventId/settings), which need a router context to resolve hrefs.
// These tests exercise the rail's own rendering, not routing, so the minimal
// single-route harness from LoginScreen.test.tsx / LiveStrip.test.tsx is
// enough — no need to reconstruct the app's real route shape (contrast
// ProtectedLayout.test.tsx / EventWorkspaceStub.test.tsx, which build a
// matching-route-shape harness because they exercise actual navigation /
// `getRouteApi` param resolution). `/events/$eventId/settings` doesn't exist
// in the app's real router yet either (Task 2 adds it) — WorkspaceRail.tsx
// itself casts that one `to` past the Register-derived union, and this
// harness only needs to satisfy `Link`'s runtime need for *a* router in
// context, not a router that actually contains the route.
const testRouter = createRouter({ routeTree: createRootRoute({ component: () => null }) });

function renderRail(ui: ReactNode) {
  return render(<RouterContextProvider router={testRouter}>{ui}</RouterContextProvider>);
}

// Mirrors board 1f's exact snapshot numbers verbatim: attendees/badge/zones/
// staff done, equipment not done -> "4 of 5 ready", zones NOT skipped (so the
// "optional" suffixes stay off in this fixture; that's covered separately).
const FULL_READINESS: EventReadinessResponse = {
  ready: true,
  steps: [
    { key: "attendees", status: "done", count: 340 },
    { key: "badge", status: "done" },
    { key: "zones", status: "done", count: 2 },
    { key: "staff", status: "done", count: 3 },
    { key: "equipment", status: "not_done" },
  ],
};

const ZONES_SKIPPED_READINESS: EventReadinessResponse = {
  ready: false,
  steps: [
    { key: "attendees", status: "done", count: 100 },
    { key: "badge", status: "not_done" },
    { key: "zones", status: "skipped" },
    { key: "staff", status: "done", count: 5 },
    { key: "equipment", status: "not_done" },
  ],
};

describe("WorkspaceRail", () => {
  it("renders the fraction, per-step icons+text labels, and counts for a full readiness snapshot", () => {
    renderRail(<WorkspaceRail eventId="evt-1" readiness={FULL_READINESS} active="overview" />);

    expect(screen.getByText("4 of 5 ready")).toBeInTheDocument();
    expect(screen.getByText("340")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();

    // WCAG 1.4.1: every step's status must have a text label, not just an
    // icon/color. Four steps are done, one is not — both texts must appear.
    expect(screen.getAllByText("Done")).toHaveLength(4);
    expect(screen.getByText("Not done")).toBeInTheDocument();

    // Zones isn't skipped in this fixture, so neither optional suffix shows.
    expect(screen.queryByText("Zones optional")).not.toBeInTheDocument();
    expect(screen.queryByText("optional")).not.toBeInTheDocument();
  });

  it("shows the muted zones-optional suffixes (header + row) only when zones is skipped", () => {
    renderRail(<WorkspaceRail eventId="evt-1" readiness={ZONES_SKIPPED_READINESS} active="overview" />);

    expect(screen.getByText("2 of 4 ready")).toBeInTheDocument();
    expect(screen.getByText("Zones optional")).toBeInTheDocument();
    expect(screen.getByText("optional")).toBeInTheDocument();
    expect(screen.getAllByText("Skipped")).toHaveLength(1);
  });

  it("shows the unlock hint when the event isn't ready", () => {
    renderRail(<WorkspaceRail eventId="evt-1" readiness={ZONES_SKIPPED_READINESS} active="overview" />);
    expect(screen.getByText("Finish the badge and run a test print to unlock check-in.")).toBeInTheDocument();
  });

  it("hides the unlock hint when the event is ready", () => {
    renderRail(<WorkspaceRail eventId="evt-1" readiness={FULL_READINESS} active="overview" />);
    expect(screen.queryByText("Finish the badge and run a test print to unlock check-in.")).not.toBeInTheDocument();
  });

  it("shows skeleton placeholders and no step rows while readiness is loading", () => {
    renderRail(<WorkspaceRail eventId="evt-1" readiness={undefined} active="overview" />);

    expect(screen.queryByText(/of \d+ ready/)).not.toBeInTheDocument();
    expect(screen.queryByText("Attendees")).not.toBeInTheDocument();
    expect(screen.queryByText("Badge")).not.toBeInTheDocument();
    // Check-in/Settings are static nav, not readiness-derived, so they still render.
    expect(screen.getByText("Check-in")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("highlights Overview as active when active is 'overview'", () => {
    renderRail(<WorkspaceRail eventId="evt-1" readiness={FULL_READINESS} active="overview" />);
    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Settings" })).not.toHaveAttribute("aria-current");
  });

  it("highlights Settings as active when active is 'settings'", () => {
    renderRail(<WorkspaceRail eventId="evt-1" readiness={FULL_READINESS} active="settings" />);
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Overview" })).not.toHaveAttribute("aria-current");
  });

  it("renders step rows and the Check-in row as non-links, always locked", () => {
    renderRail(<WorkspaceRail eventId="evt-1" readiness={FULL_READINESS} active="overview" />);

    const linkNames = screen.getAllByRole("link").map((link) => link.textContent);
    expect(linkNames.some((name) => name?.includes("Attendees"))).toBe(false);
    expect(linkNames.some((name) => name?.includes("Check-in"))).toBe(false);

    expect(screen.getByText("Check-in").closest("a")).toBeNull();
    expect(screen.getByText("locked")).toBeInTheDocument();
  });
});
