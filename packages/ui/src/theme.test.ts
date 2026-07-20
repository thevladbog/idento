import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(HERE, "theme.css"), "utf8");

const SEMANTIC_TOKENS = [
  "--background", "--foreground", "--card", "--popover", "--primary",
  "--primary-hover", "--secondary", "--muted", "--muted-foreground",
  "--accent", "--destructive", "--success", "--warning", "--info",
  "--border", "--input", "--ring", "--overlay", "--radius",
];

function block(selector: string): string {
  const start = css.indexOf(selector);
  expect(start, `${selector} block missing`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("}", css.indexOf("{", start)));
}

describe("theme.css tokens", () => {
  it("defines every semantic token in :root (light)", () => {
    const root = block(":root");
    for (const t of SEMANTIC_TOKENS) expect(root, `${t} missing in :root`).toContain(`${t}:`);
  });

  it("defines every semantic token in .dark", () => {
    const dark = block(".dark");
    for (const t of SEMANTIC_TOKENS.filter((t) => t !== "--radius")) {
      expect(dark, `${t} missing in .dark`).toContain(`${t}:`);
    }
  });

  it("uses the board-1a palette values", () => {
    const root = block(":root");
    expect(root).toContain("--success: #00935e");
    expect(root).toContain("--warning: #d97706");
    expect(root).toContain("--info: #2563eb");
    expect(root).toContain("--destructive: #dc2626");
    expect(root).toContain("--primary-hover: #00714a");
    const dark = block(".dark");
    expect(dark).toContain("--success: #2fd598");
    expect(dark).toContain("--warning: #fbbf24");
    expect(dark).toContain("--info: #7ba6f7");
    expect(dark).toContain("--destructive: #f87171");
  });

  it("maps verdict tokens onto semantic families in @theme", () => {
    expect(css).toContain("--color-verdict-allowed: var(--success)");
    expect(css).toContain("--color-verdict-no-access: var(--destructive)");
    expect(css).toContain("--color-verdict-not-registered: var(--warning)");
    expect(css).toContain("--color-verdict-repeat: var(--info)");
  });

  it("keeps --overlay dark in both themes (modal scrim, not text-derived)", () => {
    const root = block(":root");
    const dark = block(".dark");
    expect(root).toContain("--overlay: #09090b");
    expect(dark).toContain("--overlay: #09090b");
  });

  it("sets the base body color and background from semantic tokens", () => {
    // Text with no explicit color class INHERITS — without a base rule it
    // inherits the browser default (black), which coincidentally matches
    // the light theme and turns invisible in .dark (the 2026-07-20 event
    // workspace dark-mode bug). The base layer is the single place that
    // guarantee lives; consumers must not need to remember text-foreground
    // on every layout root.
    const layerStart = css.indexOf("@layer base");
    expect(layerStart, "@layer base block missing").toBeGreaterThan(-1);
    const bodyStart = css.indexOf("body", layerStart);
    expect(bodyStart, "body rule missing inside @layer base").toBeGreaterThan(-1);
    const body = css.slice(bodyStart, css.indexOf("}", bodyStart));
    expect(body).toContain("color: var(--color-foreground)");
    expect(body).toContain("background-color: var(--color-background)");
  });

  it("defines the Inter type ramp utilities", () => {
    for (const u of ["text-page-title", "text-section-title", "text-card-title", "text-body", "text-caption", "text-code"]) {
      expect(css).toContain(`@utility ${u}`);
    }
    expect(css).toContain('"Inter Variable"');
  });
});
