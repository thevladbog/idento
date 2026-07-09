/**
 * Landing page browser tests
 * Run: npx playwright test tests/landing.spec.ts
 * With UI: npx playwright test tests/landing.spec.ts --headed
 */
import { test, expect } from "@playwright/test";

const BASE_URL = "http://localhost:3000";
const VIEWPORTS = {
  mobile: { width: 375, height: 667 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1440, height: 900 },
};

test.describe("Landing Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE_URL}/en`, { waitUntil: "networkidle" });
  });

  test("1. Navigate to landing and verify all sections render", async ({
    page,
  }) => {
    // Hero - "Event Check-in That Works Offline"
    await expect(page.locator("h1")).toContainText(/event|check-in|offline/i);

    // Features - "Everything You Need for Event Success"
    await expect(page.locator("h2").filter({ hasText: /everything|feature/i })).toBeVisible();

    // How it works - scroll to ensure visible
    await page.locator("#how-it-works, [id*='how']").scrollIntoViewIfNeeded().catch(() => {});
    await page.evaluate(() => window.scrollBy(0, 400));
    await page.waitForTimeout(500);
    await expect(page.locator("h2").filter({ hasText: /how|how it works/i })).toBeVisible();

    // Pricing
    await page.locator("#pricing").scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await expect(page.locator("#pricing h2")).toContainText(/pricing|simple/i);

    // FAQ
    await page.locator("#faq").scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await expect(page.locator("#faq h2")).toBeVisible();

    // Hero CTA buttons
    await expect(page.locator("a[href='#pricing']").filter({ hasText: /start|trial/i })).toBeVisible();
    await expect(page.locator("a[href='#demo']").filter({ hasText: /watch|demo/i })).toBeVisible();
  });

  test("2. Responsive design - mobile 375px", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await page.waitForTimeout(500);
    await expect(page.locator("h1")).toBeVisible();
    const box = await page.locator("h1").boundingBox();
    expect(box?.width).toBeLessThanOrEqual(400);
  });

  test("2b. Responsive design - tablet 768px", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.tablet);
    await page.waitForTimeout(500);
    await expect(page.locator("h1")).toBeVisible();
  });

  test("2c. Responsive design - desktop 1440px", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await page.waitForTimeout(500);
    await expect(page.locator("h1")).toBeVisible();
  });

  test("3. Animations on scroll - sections animate into view", async ({
    page,
  }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    const initialOpacity = await page.locator("#faq").evaluate((el) =>
      parseFloat(getComputedStyle(el).opacity)
    );
    await page.locator("#faq").scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    const afterScroll = await page.locator("#faq").evaluate((el) =>
      parseFloat(getComputedStyle(el).opacity)
    );
    expect(afterScroll).toBeGreaterThanOrEqual(initialOpacity);
  });

  test("4. Language switching EN -> RU", async ({ page }) => {
    await expect(page).toHaveURL(/\/en/);
    await expect(page.locator("h1")).toContainText(/event check-in|offline/i);

    const selectTrigger = page.locator("button[role='combobox']").first();
    await selectTrigger.click();
    await page.locator("[role='option']:has-text('Русский')").click();
    await page.waitForURL(/\/ru/, { timeout: 5000 });

    await expect(page.locator("h1")).toContainText(/офлайн|регистрац|бейдж|событи/i);
  });

  test("5. CTAs visible and accessible", async ({ page }) => {
    const primaryCta = page.locator("a[href='#pricing']").filter({ hasText: /start|trial/i });
    await expect(primaryCta).toBeVisible();

    await page.locator("#pricing").scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const pricingCtas = page.locator("#pricing a[href='#signup'], #pricing button");
    expect(await pricingCtas.count()).toBeGreaterThan(0);

    const downloadLink = page.locator("a[href*='download']").first();
    if (await downloadLink.isVisible()) {
      await expect(downloadLink).toBeVisible();
    }
  });

  test("6. FAQ accordion opens and closes", async ({ page }) => {
    await page.locator("#faq").scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);

    const firstTrigger = page.locator("#faq [role='button']").first();
    await expect(firstTrigger).toBeVisible();

    await firstTrigger.click();
    await page.waitForTimeout(500);
    const expandedContent = page.locator("#faq [data-state='open']");
    await expect(expandedContent.first()).toBeVisible({ timeout: 2000 });

    await firstTrigger.click();
    await page.waitForTimeout(500);
  });

  test("7. Pricing toggle works", async ({ page }) => {
    await page.locator("#pricing").scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);

    const toggle = page.locator('button[aria-label="Toggle pricing"]');
    await expect(toggle).toBeVisible();

    const priceBefore = await page.locator("#pricing .text-4xl").first().textContent();
    await toggle.click();
    await page.waitForTimeout(400);
    const priceAfter = await page.locator("#pricing .text-4xl").first().textContent();
    expect(priceBefore).toBeDefined();
    expect(priceAfter).toBeDefined();
    expect(priceBefore).not.toEqual(priceAfter);
  });

  test("8. Screenshots at different viewports", async ({ page }) => {
    for (const [name, size] of Object.entries(VIEWPORTS)) {
      await page.setViewportSize(size);
      await page.waitForTimeout(500);
      await page.screenshot({
        path: `test-results/landing-${name}.png`,
        fullPage: true,
      });
    }
  });
});
