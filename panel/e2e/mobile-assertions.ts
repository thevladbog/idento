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
  expect(count, "touch target locator must match at least one element").toBeGreaterThan(0);
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
  const exposed = await page.evaluate((secret) => {
    const elements = Array.from(document.querySelectorAll<HTMLElement>("*"));
    const hasSecret = (value: string | null | undefined) => (value ?? "").includes(secret);
    const directText = hasSecret(document.body?.textContent);
    const directAttributes = elements.some((element) =>
      ["aria-label", "alt", "title"].some((name) => hasSecret(element.getAttribute(name))),
    );
    const labelledText = elements.some((element) => {
      const labelledBy = element.getAttribute("aria-labelledby");
      if (!labelledBy) return false;
      return labelledBy.split(/\s+/).some((id) => {
        const source = document.getElementById(id);
        if (!source) return false;
        const controlValue = source instanceof HTMLInputElement
          || source instanceof HTMLTextAreaElement
          || source instanceof HTMLSelectElement
          ? source.value
          : null;
        return hasSecret(source.textContent)
          || hasSecret(source.getAttribute("aria-label"))
          || hasSecret(source.getAttribute("alt"))
          || hasSecret(source.getAttribute("title"))
          || hasSecret(controlValue);
      });
    });
    const controlValues = elements.some((element) =>
      (element instanceof HTMLInputElement
        || element instanceof HTMLTextAreaElement
        || element instanceof HTMLSelectElement)
      && hasSecret(element.value),
    );
    return directText || directAttributes || labelledText || controlValues;
  }, bearer);

  expect(exposed, "rendered DOM and accessible names must not expose the bearer credential").toBe(false);
}
