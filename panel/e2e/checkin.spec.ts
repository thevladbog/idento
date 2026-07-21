import { test, expect } from "@playwright/test";
import { seedCheckinEvent } from "./fixtures/seedCheckinEvent";

test.describe("check-in scan → verdict", () => {
  test("checked_in, then already_checked_in, then not_found", async ({ page }) => {
    const seed = await seedCheckinEvent();

    // Bypass the login UI: ProtectedLayout's route guard only checks
    // localStorage token presence (session.ts's hasSession()), never
    // verifies it server-side on route entry.
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

    // 2) Same code again → already_checked_in. No explicit dismiss action
    // exists to click: the wedge input is disabled while status !== "idle"
    // (StationPage's scanEnabled), so Playwright's fill() actionability
    // check waits out the verdict card's own auto-dismiss timer
    // (verdict_auto_dismiss_sec, 4s in the seed) before it can type again —
    // submitCode itself resets state unconditionally on every call, but
    // that's moot until the input re-enables.
    await scanInput.fill(seed.attendeeCode);
    await scanInput.press("Enter");
    await expect(
      page.locator('[data-testid="checkin-verdict-card"][data-verdict="already_checked_in"]')
    ).toBeVisible();
    await expect(page.getByTestId("checkin-first-scan-meta")).toBeVisible();

    // 3) A code that was never created → not_found. submitCode's own
    // GET .../attendees?code= lookup still runs; only the POST /checkin
    // mutation is skipped when it comes back empty — verdict.ts maps that
    // client-side outcome to "not_registered".
    await scanInput.fill(seed.unknownCode);
    await scanInput.press("Enter");
    await expect(
      page.locator('[data-testid="checkin-verdict-card"][data-verdict="not_registered"]')
    ).toBeVisible();
  });
});
