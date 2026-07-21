import { test, expect } from "@playwright/test";
import { seedCheckinEvent } from "./fixtures/seedCheckinEvent";

test.describe("check-in scan → verdict", () => {
  test("scanning a known code produces a checked_in verdict", async ({ page }) => {
    const seed = await seedCheckinEvent();

    // Bypass the login UI: the panel's route guard only checks localStorage
    // token presence (panel/src/app/shell/ProtectedLayout.tsx), matching
    // the panel's own StationPage.test.tsx setup pattern.
    await page.addInitScript((token) => {
      window.localStorage.setItem("token", token);
    }, seed.token);

    await page.goto(`/events/${seed.eventId}/checkin?station=${seed.stationId}`);

    const scanInput = page.getByLabel("Badge scanner input");
    await expect(scanInput).toBeVisible();

    await scanInput.fill(seed.attendeeCode);
    await scanInput.press("Enter");

    await expect(
      page.locator('[data-testid="checkin-verdict-card"][data-verdict="allowed"]')
    ).toBeVisible();
  });
});
