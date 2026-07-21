import { test, expect, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { seedWorkspaceEvent } from "./fixtures/seedWorkspaceEvent";

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

// `ready` is a locator for something that only exists once the screen's
// SEEDED data has actually rendered (not just page.goto's `load` event,
// which fires before React Query's initial fetch resolves) -- without
// this, a scan can race the fetch and inspect a loading/skeleton DOM
// instead of the real content, silently under-auditing whatever hadn't
// rendered yet.
async function expectNoViolations(page: Page, ready: Locator) {
  await ready.waitFor({ state: "visible" });
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

test.describe("WCAG 2.2 AA sweep", () => {
  test("login screen", async ({ page }) => {
    await page.goto("/login");
    await expectNoViolations(page, page.locator("#login-email"));
  });

  test("authenticated screens", async ({ page }) => {
    const seed = await seedWorkspaceEvent();
    await page.addInitScript((token) => {
      window.localStorage.setItem("token", token);
    }, seed.token);

    await page.goto("/");
    await expectNoViolations(page, page.getByRole("heading", { name: "Upcoming" }));

    await page.goto(`/events/${seed.eventId}`);
    await expectNoViolations(page, page.getByRole("heading", { name: "Overview" }));

    await page.goto(`/events/${seed.eventId}/settings`);
    await expectNoViolations(page, page.getByRole("heading", { name: "Settings" }));

    await page.goto(`/events/${seed.eventId}/attendees`);
    await expectNoViolations(page, page.locator('[data-testid="attendee-table"]'));

    await page.goto(`/events/${seed.eventId}/badge`);
    await expectNoViolations(page, page.locator('[data-testid="badge-pane-elements"]'));

    await page.goto(`/events/${seed.eventId}/checkin?station=${seed.stationId}`);
    await expectNoViolations(page, page.locator('[data-testid="checkin-station-page"]'));
  });
});
