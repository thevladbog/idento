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
// `getRouteApi` param resolution). Both routes are registered in the app's
// real router (router.tsx) by now, so `Link`'s `to`/`params` typecheck
// normally with no cast — this harness only needs to satisfy `Link`'s
// runtime need for *a* router in context, not one that actually contains
// the route.
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

  it("colors each step icon by status — success for done, muted for not_done/skipped", () => {
    // ZONES_SKIPPED_READINESS has one of every status (2 done, 2 not_done,
    // 1 skipped), so a wrong/hardcoded color mapping shows up immediately.
    // Icon color is asserted on the <svg> itself (not the row's text color)
    // via the same `text-success`/`text-muted-foreground` token classes the
    // rest of this component and ReadinessCell already use — the Check-in
    // row's Lock icon has no color class of its own (inherits from its
    // parent), so it can't false-positive into these counts.
    const { container } = renderRail(<WorkspaceRail eventId="evt-1" readiness={ZONES_SKIPPED_READINESS} active="overview" />);

    expect(container.querySelectorAll("svg.text-success")).toHaveLength(2); // attendees, staff
    expect(container.querySelectorAll("svg.text-muted-foreground")).toHaveLength(3); // badge, zones, equipment
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

  it("hides the unlock hint while readiness is still loading (undefined), even though ready !== true", () => {
    // Regression guard: `readiness?.ready !== true` is true both while
    // loading (readiness undefined) and once loaded-but-not-ready — only the
    // latter should render the hint. Rendering it during loading asserts
    // "not ready yet" before the component actually knows the answer.
    renderRail(<WorkspaceRail eventId="evt-1" readiness={undefined} active="overview" />);
    expect(screen.queryByText("Finish the badge and run a test print to unlock check-in.")).not.toBeInTheDocument();
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

  it("renders the still-locked step rows (badge/zones/staff/equipment) and the Check-in row as non-links, always locked", () => {
    renderRail(<WorkspaceRail eventId="evt-1" readiness={FULL_READINESS} active="overview" />);

    const linkNames = screen.getAllByRole("link").map((link) => link.textContent);
    expect(linkNames.some((name) => name?.includes("Badge"))).toBe(false);
    expect(linkNames.some((name) => name?.includes("Zones"))).toBe(false);
    expect(linkNames.some((name) => name?.includes("Staff"))).toBe(false);
    expect(linkNames.some((name) => name?.includes("Equipment"))).toBe(false);
    expect(linkNames.some((name) => name?.includes("Check-in"))).toBe(false);

    expect(screen.getByText("Check-in").closest("a")).toBeNull();
    expect(screen.getByText("locked")).toBeInTheDocument();
  });

  it("renders the attendees step row as a real Link (unlike the other still-locked steps) and marks it active on the attendees route", () => {
    renderRail(<WorkspaceRail eventId="evt-1" readiness={FULL_READINESS} active="attendees" />);

    const attendeesLink = screen.getByRole("link", { name: /Attendees/ });
    expect(attendeesLink).toHaveAttribute("href", "/events/evt-1/attendees");
    expect(attendeesLink).toHaveAttribute("aria-current", "page");
  });

  it("does not mark the attendees link active when a different rail tab is active", () => {
    renderRail(<WorkspaceRail eventId="evt-1" readiness={FULL_READINESS} active="overview" />);

    const attendeesLink = screen.getByRole("link", { name: /Attendees/ });
    expect(attendeesLink).not.toHaveAttribute("aria-current");
  });
});
