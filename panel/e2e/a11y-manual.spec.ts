import { test, expect } from "@playwright/test";
import { seedWorkspaceEvent } from "./fixtures/seedWorkspaceEvent";

// P5.3.3 Task 5 — manual WCAG 2.2 checklist spot-checks that the axe-core
// screen sweep (a11y.spec.ts, Task 4) structurally can't reach: axe only
// inspects whatever's in the DOM on page load for each of its 7 seeded
// screens, so anything gated behind a click (a Dialog, a Sheet, a dropdown)
// is invisible to it. These specs deliberately open that state first.

test.describe("WCAG 2.5.8 target size (24x24 minimum) — icon-only affordances", () => {
  test("badge editor: ElementsPane remove-element button and ZplPreviewModal close button", async ({ page }) => {
    const seed = await seedWorkspaceEvent();
    await page.addInitScript((token) => {
      window.localStorage.setItem("token", token);
    }, seed.token);

    await page.goto(`/events/${seed.eventId}/badge`);
    await page.waitForSelector('[data-testid="badge-pane-elements"]');

    const removeBox = await page.getByRole("button", { name: /Remove element/i }).first().boundingBox();
    expect(removeBox, "ElementsPane remove-element button should be mounted").not.toBeNull();
    expect(removeBox!.width).toBeGreaterThanOrEqual(24);
    expect(removeBox!.height).toBeGreaterThanOrEqual(24);

    await page.getByRole("button", { name: /ZPL preview/i }).click();
    const closeBox = await page.getByRole("button", { name: /^Close$/ }).boundingBox();
    expect(closeBox, "DialogContent close button should be mounted once the dialog is open").not.toBeNull();
    expect(closeBox!.width).toBeGreaterThanOrEqual(24);
    expect(closeBox!.height).toBeGreaterThanOrEqual(24);
  });

  test("attendees: AttendeeDrawer sheet close button, zone chip, and footer links", async ({ page }) => {
    const seed = await seedWorkspaceEvent();
    await page.addInitScript((token) => {
      window.localStorage.setItem("token", token);
    }, seed.token);

    await page.goto(`/events/${seed.eventId}/attendees`);
    await page.getByRole("button", { name: /^Open /i }).first().click();

    const closeBox = await page.getByRole("button", { name: /^Close$/ }).boundingBox();
    expect(closeBox, "SheetContent close button should be mounted once the drawer is open").not.toBeNull();
    expect(closeBox!.width).toBeGreaterThanOrEqual(24);
    expect(closeBox!.height).toBeGreaterThanOrEqual(24);

    // 3 more sub-24px targets found incidentally while investigating the
    // Sheet close button above (Task 5 report) — same drawer, same
    // text-caption-with-thin-padding root cause, fixed at the source
    // (AttendeeDrawer.tsx's own py-0.5->py-1 / added py-1).
    const zoneChipBox = await page.getByRole("button", { name: "+ Zone" }).boundingBox();
    expect(zoneChipBox, "'+ Zone' chip should be mounted").not.toBeNull();
    expect(zoneChipBox!.height).toBeGreaterThanOrEqual(24);

    const regenerateBox = await page.getByRole("button", { name: "Regenerate code…" }).boundingBox();
    expect(regenerateBox, "'Regenerate code…' footer link should be mounted").not.toBeNull();
    expect(regenerateBox!.height).toBeGreaterThanOrEqual(24);

    const deleteBox = await page.getByRole("button", { name: "Delete…" }).boundingBox();
    expect(deleteBox, "'Delete…' footer link should be mounted").not.toBeNull();
    expect(deleteBox!.height).toBeGreaterThanOrEqual(24);
  });
});

test.describe("WCAG 2.4.11 focus not obscured (new in 2.2)", () => {
  test("workspace overview: every keyboard-focused element resolves to itself at its own center point", async ({
    page,
  }) => {
    const seed = await seedWorkspaceEvent();
    await page.addInitScript((token) => {
      window.localStorage.setItem("token", token);
    }, seed.token);

    await page.goto(`/events/${seed.eventId}`);
    await page.waitForSelector("nav");

    await page.locator("body").click({ position: { x: 5, y: 5 } });

    // A full lap around WorkspaceRail's focus order (header links + language/
    // theme toggles + launch CTA + rail steps) comfortably fits in 14 stops
    // (see tmp investigation in the Task 5 report) — 20 gives headroom
    // without risking an infinite/flaky loop if the DOM ever grows a couple
    // more stops.
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press("Tab");
      const obscured = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return false;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false; // not visible, N/A
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const topEl = document.elementFromPoint(cx, cy);
        return topEl !== el && !el.contains(topEl) && !(topEl && topEl.contains(el));
      });
      expect(obscured, `Tab stop #${i + 1} is visually obscured by a different element`).toBe(false);
    }
  });
});

test.describe("WCAG 2.3.3 prefers-reduced-motion", () => {
  test("animate-pulse collapses to a near-zero duration once the OS preference is set", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/login");
    const normalDuration = await page.evaluate(() => {
      const el = document.createElement("div");
      el.className = "animate-pulse";
      document.body.appendChild(el);
      const d = getComputedStyle(el).animationDuration;
      el.remove();
      return d;
    });
    expect(parseFloat(normalDuration)).toBeGreaterThan(0.01);

    await page.emulateMedia({ reducedMotion: "reduce" });
    const reducedDuration = await page.evaluate(() => {
      const el = document.createElement("div");
      el.className = "animate-pulse";
      document.body.appendChild(el);
      const d = getComputedStyle(el).animationDuration;
      el.remove();
      return d;
    });
    // theme.css pins this to 0.01ms == 1e-5s under `prefers-reduced-motion:
    // reduce`; parseFloat handles the browser's "1e-05s" vs "0.00001s"
    // formatting either way.
    expect(parseFloat(reducedDuration)).toBeLessThanOrEqual(0.00001);
  });
});
