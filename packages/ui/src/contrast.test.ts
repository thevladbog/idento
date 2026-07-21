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

const AA_NON_TEXT = 3.0;

// WCAG 1.4.11 (Non-text Contrast, AA): a UI component's visual boundary
// against its background must clear 3:1. Button's `default` variant
// (button.tsx) has no border/shadow — bg-primary/bg-primary-hover alone
// delineate the control, so both must individually clear 3:1 against the
// page background they're expected to sit on. Caught during Task 1 review:
// darkening --primary/--primary-hover enough to satisfy 1.4.3 (text-on-fill,
// above) pulls the fill TOWARD the dark theme's very dark --background,
// which can silently fail this DIFFERENT criterion even while 1.4.3 passes —
// dark-mode --primary-hover regressed from 4.44:1 to 2.57:1 vs --background
// in an earlier draft of this fix, caught only by adding this test.
describe("theme.css non-text contrast (WCAG 1.4.11, UI components vs page background)", () => {
  for (const themeName of ["light", "dark"] as const) {
    it(`${themeName}: --primary and --primary-hover clear 3:1 against --background`, () => {
      const blockText = themeName === "light" ? block(":root") : block(".dark");
      const background = tokenValue(blockText, "--background");
      for (const token of ["--primary", "--primary-hover"]) {
        const ratio = contrastRatio(tokenValue(blockText, token), background);
        expect(ratio, `${themeName} ${token} vs --background`).toBeGreaterThanOrEqual(AA_NON_TEXT);
      }
    });
  }
});

// P5.3.3 Task 5 (manual checklist item, WCAG 2.4.7 Focus Visible / 1.4.11
// Non-text Contrast applied to the focus indicator itself): every
// interactive @idento/ui component shares one global `focus-visible:ring-2
// focus-visible:ring-ring` treatment (button.tsx, checkbox.tsx, select.tsx,
// etc. — components that compose Button/inherit it are intentionally not
// re-listed). --ring itself was never in the PAIRS sweep above (it isn't a
// foreground/background text pair), so it had no regression guard at all
// until this block. Checked against both --background and --card since
// focus rings render over either surface throughout the app.
describe("theme.css focus-ring contrast (WCAG 2.4.7 / 1.4.11, --ring vs surfaces)", () => {
  for (const themeName of ["light", "dark"] as const) {
    it(`${themeName}: --ring clears 3:1 against --background and --card`, () => {
      const blockText = themeName === "light" ? block(":root") : block(".dark");
      const ring = tokenValue(blockText, "--ring");
      for (const surface of ["--background", "--card"]) {
        const ratio = contrastRatio(ring, tokenValue(blockText, surface));
        expect(ratio, `${themeName} --ring vs ${surface}`).toBeGreaterThanOrEqual(AA_NON_TEXT);
      }
    });
  }
});

// Simple (non-premultiplied) alpha compositing in sRGB space — matches how
// browsers paint a translucent `bg-*/10` fill over a solid page background,
// and is what axe-core measures live via getComputedStyle.
function blendOverBackground(fgHex: string, alpha: number, bgHex: string): string {
  const fg = hexToRgb(fgHex);
  const bg = hexToRgb(bgHex);
  const out = fg.map((c, i) => Math.round(alpha * c + (1 - alpha) * bg[i])) as [number, number, number];
  return `#${out.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

// WCAG 1.4.3, "self-tint" badges: WorkspaceRail's active-nav-item highlight
// (StatusPill's `ready`/`error` variants, ImportWizard's info badge, etc.)
// render `text-X` on `bg-X/10` — a background that is ITSELF X-tinted, not
// plain --background. That composited background sits closer in luminance
// to the text color than plain --background does, quietly eating into the
// margin the plain --X/--X-foreground pair (above) already clears. Found
// live by the P5.3.3 axe-core/playwright sweep on WorkspaceRail's "active"
// link (the original board-1a --success value measured only 4.32:1 there,
// short of the 4.5:1 the plain-pair test already verifies) — --destructive
// and --info hit the identical arithmetic (StatusPill's `error` variant,
// ImportWizard's info badge) but weren't rendered live by that sweep's 7
// seeded screens, so they're pinned here from the same self-tint formula
// rather than a second live catch. --warning uses the identical idiom too
// (StatusPill's `in_progress` variant, WorkspaceRail, ImportWizard,
// FontsCard, StationPage) and already clears 4.5:1 as-is (4.61:1, found
// during the P5.3.3 final whole-branch review) — included here so that
// margin can't silently regress unnoticed, the same reason the other three
// tokens are pinned. This test pins the darkened replacements (see
// theme.css's comments for each value) so none of them can silently
// regress back below 4.5:1.
describe("theme.css self-tint contrast (WCAG 1.4.3, text-X on bg-X/10 over page background)", () => {
  for (const themeName of ["light", "dark"] as const) {
    for (const token of ["--success", "--destructive", "--info", "--warning"]) {
      it(`${themeName}: ${token} on bg-${token.slice(2)}/10 clears 4.5:1`, () => {
        const blockText = themeName === "light" ? block(":root") : block(".dark");
        const value = tokenValue(blockText, token);
        const background = tokenValue(blockText, "--background");
        const tint = blendOverBackground(value, 0.1, background);
        const ratio = contrastRatio(value, tint);
        expect(ratio, `${themeName} ${token} vs bg-${token.slice(2)}/10 over --background`).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
      });
    }
  }
});
