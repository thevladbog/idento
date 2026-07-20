import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "kiosk-theme.css"), "utf8");

describe("kiosk theme", () => {
  it.each([
    ["--kiosk-bg", "#111413"],
    ["--kiosk-surface", "#161917"],
    ["--kiosk-surface-2", "#1b1f1d"],
    ["--kiosk-border", "#232725"],
    ["--kiosk-border-2", "#2a2f2c"],
    ["--kiosk-outline", "#3a403d"],
    ["--kiosk-brand", "#00935e"],
    ["--kiosk-ok", "#2ee6a8"],
    ["--kiosk-warn", "#f5a300"],
    ["--kiosk-warn-text", "#f5c96a"],
    ["--kiosk-warn-ink", "#241a00"],
    ["--kiosk-danger", "#ce2b37"],
    ["--kiosk-danger-soft", "#ff5c68"],
    ["--kiosk-neutral", "#262c2a"],
    ["--kiosk-text", "#ffffff"],
    ["--kiosk-text-2", "#c8d0cc"],
    ["--kiosk-text-3", "#9aa5a0"],
    ["--kiosk-text-4", "#6b736f"],
  ])("defines %s: %s", (name, value) => {
    expect(css).toContain(`${name}: ${value}`);
  });

  it("maps every color token into @theme inline", () => {
    for (const t of ["bg", "surface", "surface-2", "border", "border-2", "outline", "brand", "ok", "warn", "warn-text", "warn-ink", "danger", "danger-soft", "neutral", "text", "text-2", "text-3", "text-4", "overlay-light", "overlay-ink", "overlay-track"]) {
      expect(css).toContain(`--color-kiosk-${t}: var(--kiosk-${t})`);
    }
  });

  it("steps the type ramp at 1366 and 1024 tiers", () => {
    expect(css).toContain("--kiosk-fs-idle-title: 62px");
    expect(css).toContain("--kiosk-fs-verdict-name: 116px");
    expect(css).toMatch(/max-width: 1679px[\s\S]*--kiosk-fs-idle-title: 48px[\s\S]*--kiosk-fs-verdict-name: 84px/);
    expect(css).toMatch(/max-width: 1179px[\s\S]*--kiosk-fs-idle-title: 38px[\s\S]*--kiosk-fs-verdict-name: 64px/);
  });

  it("defines kiosk keyframes", () => {
    for (const k of ["kiosk-scan", "kiosk-beam", "kiosk-pulse", "kiosk-drift"]) {
      expect(css).toContain(`@keyframes ${k}`);
    }
  });
});
