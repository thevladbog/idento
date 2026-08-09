import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page } from "@playwright/test";

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

export async function expectNoBodyOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(widths.scroll).toBe(widths.client);
}

export async function expectTouchTargetsAtLeast44(locator: Locator) {
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    const target = locator.nth(index);
    if (!(await target.isVisible())) continue;
    const box = await target.boundingBox();
    expect(box, `touch target ${index} must have a box`).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
}

export async function expectNoAxeViolations(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  expect(result.violations, JSON.stringify(result.violations, null, 2)).toEqual([]);
}

export async function expectBearerAbsent(page: Page, bearer: string) {
  const bodyContainsBearer = (await page.locator("body").innerText()).includes(bearer);
  expect(bodyContainsBearer, "body text must not expose the bearer credential").toBe(false);
  const namedContainsBearer = await page.locator("[aria-label]").evaluateAll(
    (nodes, secret) => nodes.some((node) => (node.getAttribute("aria-label") ?? "").includes(secret)),
    bearer,
  );
  expect(namedContainsBearer, "accessible names must not expose the bearer credential").toBe(false);
}
