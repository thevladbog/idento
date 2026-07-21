import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { seedWorkspaceEvent } from "./fixtures/seedWorkspaceEvent";

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

async function expectNoViolations(page: import("@playwright/test").Page) {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

test.describe("WCAG 2.2 AA sweep", () => {
  test("login screen", async ({ page }) => {
    await page.goto("/login");
    await expectNoViolations(page);
  });

  test("authenticated screens", async ({ page }) => {
    const seed = await seedWorkspaceEvent();
    await page.addInitScript((token) => {
      window.localStorage.setItem("token", token);
    }, seed.token);

    await page.goto("/");
    await expectNoViolations(page);

    await page.goto(`/events/${seed.eventId}`);
    await expectNoViolations(page);

    await page.goto(`/events/${seed.eventId}/settings`);
    await expectNoViolations(page);

    await page.goto(`/events/${seed.eventId}/attendees`);
    await expectNoViolations(page);

    await page.goto(`/events/${seed.eventId}/badge`);
    await expectNoViolations(page);

    await page.goto(`/events/${seed.eventId}/checkin?station=${seed.stationId}`);
    await expectNoViolations(page);
  });
});
