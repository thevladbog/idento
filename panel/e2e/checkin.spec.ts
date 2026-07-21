import { test, expect } from "@playwright/test";
import { seedCheckinEvent } from "./fixtures/seedCheckinEvent";

test.describe("check-in scan → verdict", () => {
  test("checked_in, then already_checked_in, then not_found", async ({ page }) => {
    const seed = await seedCheckinEvent();

    await page.addInitScript((token) => {
      window.localStorage.setItem("token", token);
    }, seed.token);

    await page.goto(`/events/${seed.eventId}/checkin?station=${seed.stationId}`);

    const scanInput = page.getByLabel("Badge scanner input");
    await expect(scanInput).toBeVisible();

    // 1) First scan of a real attendee code → checked_in.
    await scanInput.fill(seed.attendeeCode);
    await scanInput.press("Enter");
    await expect(
      page.locator('[data-testid="checkin-verdict-card"][data-verdict="allowed"]')
    ).toBeVisible();

    // 2) Same code again, no dismiss needed (submitCode resets state
    // unconditionally on every call) → already_checked_in.
    await scanInput.fill(seed.attendeeCode);
    await scanInput.press("Enter");
    await expect(
      page.locator('[data-testid="checkin-verdict-card"][data-verdict="already_checked_in"]')
    ).toBeVisible();
    await expect(page.getByTestId("checkin-first-scan-meta")).toBeVisible();

    // 3) A code that was never created → not_found (resolved client-side,
    // no server round trip — verdict.ts maps it to "not_registered").
    await scanInput.fill(seed.unknownCode);
    await scanInput.press("Enter");
    await expect(
      page.locator('[data-testid="checkin-verdict-card"][data-verdict="not_registered"]')
    ).toBeVisible();
  });
});
