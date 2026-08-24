import { describe, expect, it } from "vitest";
import config from "./playwright.config";

describe("Playwright report configuration", () => {
  it("retains terminal list output and writes a non-opening HTML report for CI artifact upload", () => {
    expect(config.reporter).toEqual([
      ["list"],
      ["html", { outputFolder: "playwright-report", open: "never" }],
    ]);
  });
});
