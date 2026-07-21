import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(HERE, "theme.css"), "utf8");

// WCAG 2.x relative-luminance contrast ratio (the same formula used to
// derive the fixed hex values in Task 1's commit message / the spec).
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}
function relLum([r, g, b]: [number, number, number]): number {
  const [R, G, B] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}
function contrastRatio(hex1: string, hex2: string): number {
  const L1 = relLum(hexToRgb(hex1));
  const L2 = relLum(hexToRgb(hex2));
  const [lighter, darker] = L1 > L2 ? [L1, L2] : [L2, L1];
  return (lighter + 0.05) / (darker + 0.05);
}

function block(selector: string): string {
  const start = css.indexOf(selector);
  expect(start, `${selector} block missing`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("}", css.indexOf("{", start)));
}

function tokenValue(blockText: string, token: string): string {
  const m = blockText.match(new RegExp(`${token}:\\s*(#[0-9a-fA-F]{6})`));
  expect(m, `${token} not found or not a hex color`).not.toBeNull();
  return m![1];
}

// Every semantic foreground/background pair actually defined in theme.css
// (packages/ui/src/theme.css's :root/.dark blocks + @theme inline mapping).
const PAIRS: Array<[string, string]> = [
  ["--background", "--foreground"],
  ["--card", "--card-foreground"],
  ["--popover", "--popover-foreground"],
  ["--primary", "--primary-foreground"],
  ["--secondary", "--secondary-foreground"],
  ["--muted", "--muted-foreground"],
  ["--accent", "--accent-foreground"],
  ["--destructive", "--destructive-foreground"],
  ["--success", "--success-foreground"],
  ["--warning", "--warning-foreground"],
  ["--info", "--info-foreground"],
];

const AA_NORMAL_TEXT = 4.5;

describe("theme.css contrast (WCAG 1.4.3, AA normal text)", () => {
  for (const themeName of ["light", "dark"] as const) {
    describe(themeName, () => {
      const blockText = themeName === "light" ? block(":root") : block(".dark");
      for (const [bg, fg] of PAIRS) {
        it(`${bg} / ${fg} clears 4.5:1`, () => {
          const ratio = contrastRatio(tokenValue(blockText, bg), tokenValue(blockText, fg));
          expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
        });
      }
    });
  }

  it("keeps --primary-hover meaningfully darker than --primary in both themes (hover affordance)", () => {
    for (const themeName of ["light", "dark"] as const) {
      const blockText = themeName === "light" ? block(":root") : block(".dark");
      const primaryLum = relLum(hexToRgb(tokenValue(blockText, "--primary")));
      const hoverLum = relLum(hexToRgb(tokenValue(blockText, "--primary-hover")));
      // hover must be at least 10% relatively darker than primary — an
      // arbitrary-but-concrete floor chosen to catch a near-collision like
      // the one found during P5.3.3 planning (darkened dark-mode --primary
      // landed within ~1% of the existing --primary-hover).
      expect(hoverLum, `${themeName} --primary-hover not meaningfully darker than --primary`).toBeLessThan(primaryLum * 0.9);
    }
  });
});
