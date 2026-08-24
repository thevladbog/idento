/* global module, require */
/* eslint-disable @typescript-eslint/no-require-imports */
const { chromium } = require("@playwright/test");

module.exports = {
  ci: {
    collect: {
      url: ["http://127.0.0.1:4174/"],
      numberOfRuns: 3,
      startServerCommand: "npm run preview -- --host 127.0.0.1 --port 4174",
      startServerReadyPattern: "Local",
      puppeteerScript: "./scripts/lighthouse-login.cjs",
      // LHCI 0.15 expects Puppeteer's former synchronous executablePath API.
      // Reuse the Chromium installed for the required Playwright job instead.
      chromePath: chromium.executablePath(),
      settings: {
        disableStorageReset: true,
        formFactor: "mobile",
        screenEmulation: {
          mobile: true,
          width: 390,
          height: 844,
          deviceScaleFactor: 2,
          disabled: false,
        },
      },
    },
    assert: {
      assertions: {
        "categories:performance": ["warn", { minScore: 0.8 }],
        "categories:accessibility": ["warn", { minScore: 0.95 }],
      },
    },
    upload: {
      target: "filesystem",
      outputDir: "./lighthouse-reports",
    },
  },
};
