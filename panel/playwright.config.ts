import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
  ],
  use: {
    baseURL: "http://localhost:5174",
    // Pinned: i18next-browser-languagedetector falls back to navigator.language
    // with no supportedLngs override, so an unpinned context inherits the host
    // OS locale — a ru-* runner would render Russian aria-labels and break every
    // getByLabel(...) selector in the suite even though the app is correct.
    locale: "en-US",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      testIgnore: /mobile-companion\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chromium",
      testMatch: /mobile-companion\.spec\.ts/,
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 390, height: 844 },
        // These journeys mint one-time bearer credentials. A trace archives
        // their response bodies, while screenshots/video can retain the QR
        // that carries the same credential, so this project must not attach
        // any of those artifacts on failure.
        trace: "off",
        screenshot: "off",
        video: "off",
        contextOptions: { screen: { width: 390, height: 844 } },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5174",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
