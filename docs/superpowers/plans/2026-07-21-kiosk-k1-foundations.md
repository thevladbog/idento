# Kiosk K1 — Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put `desktop` into the npm workspace, build the kiosk-strict design system as `@idento/ui/kiosk` (tokens + components + tests), and regenerate desktop app/tray icons from the logo-handoff assets.

**Architecture:** Kiosk components are presentational primitives in `packages/ui/src/kiosk/` (strings via props, no i18n/fetch/router), themed exclusively by CSS variables in `src/kiosk/kiosk-theme.css` (Tailwind 4 `@theme inline` mapping). The desktop app itself is rewritten in K2; K3 does sidecar/updater/release CI. Spec: `docs/superpowers/specs/2026-07-21-kiosk-desktop-v2-design.md`.

**Tech Stack:** npm workspaces, React 18-compatible TSX (peer `react >=18`), Tailwind 4 tokens, cva/clsx/tailwind-merge, lucide-react, Vitest + Testing Library (jsdom), rsvg-convert + ImageMagick + `tauri icon` for icons.

## Global Constraints

- Registry pinned: every npm project uses `.npmrc` with `registry=https://registry.npmjs.com/` (root one already exists — keep it).
- `@idento/ui` rules (packages/ui/AGENTS.md): no i18n/axios/router imports; never import from apps; strings arrive via props; lucide-react icons only, no emoji in UI; status/verdict UI is always icon + text + color.
- Colors: **only** in theme CSS files. Kiosk colors live only in `packages/ui/src/kiosk/kiosk-theme.css`; the `no-hardcoded-colors` test enforces this (Task 2 adds the exemption).
- Kiosk subtree is **dark-only in K1** (light pair is a later phase) — this amends the package "both themes" rule for `src/kiosk/` only.
- React-19-only APIs are banned inside `packages/ui` (peer is `react >=18`).
- Verify commands for every packages/ui task, from repo root:
  `npm test -w @idento/ui && npm run typecheck -w @idento/ui && npm run lint -w @idento/ui`
- Canvas source of truth: design project `165a9ba5-4bb1-4ede-9048-546ccb1742af`, file `Idento Kiosk.dc.html` (fixed: chips «1e», layouts 1a/1c, full-screen verdicts, hardware-scanner idle, pre-flight rail).
- Commit after every task (small commits, `git add` only the listed files).

---

### Task 1: desktop joins the npm workspace

**Files:**
- Modify: `package.json` (repo root)
- Modify: `desktop/package.json`
- Delete: `desktop/package-lock.json`
- Modify: `.github/workflows/ci.yml` (paths-filter `desktop`, job `build-desktop`)
- Modify: `desktop/README.md` (install instructions)

**Interfaces:**
- Consumes: nothing.
- Produces: `npm ci` at root installs desktop deps; `@idento/ui` resolvable from desktop (`"@idento/ui": "*"`); root `package-lock.json` is the single lockfile; `desktop` runs React 19.2.7 (matching `panel`).

**Amendment (post-dispatch, discovered during implementation):** joining the workspace while `desktop` stayed pinned to React 18 alongside `panel`'s React 19 broke `desktop`'s `tsc -b` build — npm hoists `react`/`@types/react` for `desktop` from its own 18.x range (genuine conflict, so it nests), but peer-range-only libraries (`lucide-react`, `react-router-dom`, `sonner`) hoist to the *root* 19.x types since their peer ranges accept both majors, so `desktop`'s own JSX resolves against React 18 types while these libraries' `.d.ts` resolve against React 19 types — a real `ReactNode` mismatch (React 19 added `bigint`), not a fluke (reproduced from a clean `npm ci`). The design spec (`docs/superpowers/specs/2026-07-21-kiosk-desktop-v2-design.md` §3.2) already calls for desktop to run "React 19" in the rewrite, and Task 2 Step 6 of this plan already amends `packages/ui/AGENTS.md` to say "the desktop kiosk runs React 19" — so the version bump is not a new decision, it's completing one this plan already made elsewhere. Step 2 below now includes it.

- [ ] **Step 1: Add desktop to workspaces**

In root `package.json` change:

```json
  "workspaces": ["packages/*", "panel", "desktop"],
```

- [ ] **Step 2: Reference @idento/ui from desktop, bump to React 19**

In `desktop/package.json` `dependencies` add (keep the rest as-is):

```json
    "@idento/ui": "*",
```

And align `dependencies`/`devDependencies` with `panel/package.json`'s React major (avoids the hoisting conflict below — `@idento/ui`'s peer range `>=18` already allows this, and `desktop`'s other deps — `react-router-dom@7`, `sonner@2`, `lucide-react` — already advertise React 19 support in their own peer ranges):

```json
    "react": "^19.2.7",
    "react-dom": "^19.2.7",
```

```json
    "@types/react": "^19.2.7",
    "@types/react-dom": "^19.0.0",
```

(`@vitejs/plugin-react` stays `^5` — already compatible with both majors.)

- [ ] **Step 3: Remove the separate lockfile and reinstall**

```bash
git rm desktop/package-lock.json
npm install
```

Expected: root `package-lock.json` now contains `desktop` and `node_modules/@idento/ui` links; `desktop/node_modules` is mostly empty (hoisted).

- [ ] **Step 4: Verify desktop still builds and lints from the workspace**

```bash
npm run build -w idento-desktop
npm run lint -w idento-desktop
npm run typecheck -w @idento/ui
```

Expected: all pass (build emits `desktop/dist/`).

- [ ] **Step 5: Update CI**

In `.github/workflows/ci.yml`:

a) paths-filter — `desktop` must also react to shared-package changes:

```yaml
            desktop:
              - 'desktop/**'
              - 'packages/**'
              - 'package.json'
              - 'package-lock.json'
              - '.npmrc'
```

b) `build-desktop` job — install at root, run via workspace:

```yaml
      - uses: actions/setup-node@v5
        with:
          node-version: "24"
          cache: "npm"
          cache-dependency-path: package-lock.json
      - name: Install Rust
        uses: dtolnay/rust-toolchain@stable
      - name: Install dependencies
        run: npm ci
      - name: Lint (desktop)
        run: npm run lint -w idento-desktop
```

Keep the Tauri system-deps and `cd desktop && npm run tauri build` steps unchanged (`npm run` resolves the hoisted `@tauri-apps/cli`).

- [ ] **Step 6: Update desktop/README.md**

Replace the Development section's install line with: install from **repo root** (`npm install`), then `npm run tauri dev -w idento-desktop` or `cd desktop && npm run tauri dev`.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json desktop/package.json .github/workflows/ci.yml desktop/README.md
git commit -m "chore(desktop): join npm workspace, single root lockfile"
```

---

### Task 2: kiosk theme — tokens, ramp, keyframes

**Files:**
- Create: `packages/ui/src/kiosk/kiosk-theme.css`
- Create: `packages/ui/src/kiosk/kiosk-theme.test.ts`
- Modify: `packages/ui/src/no-hardcoded-colors.test.ts` (EXEMPT set)
- Modify: `packages/ui/package.json` (exports)
- Modify: `packages/ui/AGENTS.md`

**Interfaces:**
- Consumes: nothing.
- Produces: CSS vars `--kiosk-*`; Tailwind classes `bg-kiosk-*`, `text-kiosk-*`, `border-kiosk-*` (via `@theme inline`); plain type-ramp classes `kiosk-type-idle-title`, `kiosk-type-idle-sub`, `kiosk-type-verdict-name`, `kiosk-type-verdict-title`; keyframes `kiosk-scan`, `kiosk-beam`, `kiosk-pulse`, `kiosk-drift`; size vars `--kiosk-bar-h`, `--kiosk-banner-h`, `--kiosk-footer-h`, `--kiosk-panel-w`. Exports `@idento/ui/kiosk` and `@idento/ui/kiosk-theme.css`.

- [ ] **Step 1: Write the failing theme test**

`packages/ui/src/kiosk/kiosk-theme.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test -w @idento/ui -- src/kiosk/kiosk-theme.test.ts`
Expected: FAIL (file not found).

- [ ] **Step 3: Write `packages/ui/src/kiosk/kiosk-theme.css`**

```css
/* Kiosk-strict theme (dark-only for now). The ONLY place kiosk colors may appear.
   Font: Inter is bundled by the consuming app (desktop ships the woff2s) — this file
   only names it. Canvas: Idento Kiosk.dc.html (fixed decisions: chips 1e, 1a/1c). */

:root {
  --kiosk-bg: #111413;
  --kiosk-surface: #161917;
  --kiosk-surface-2: #1b1f1d;
  --kiosk-border: #232725;
  --kiosk-border-2: #2a2f2c;
  --kiosk-outline: #3a403d;
  --kiosk-brand: #00935e;
  --kiosk-ok: #2ee6a8;
  --kiosk-warn: #f5a300;
  --kiosk-warn-text: #f5c96a;
  --kiosk-warn-ink: #241a00;
  --kiosk-danger: #ce2b37;
  --kiosk-danger-soft: #ff5c68;
  --kiosk-neutral: #262c2a;
  --kiosk-text: #ffffff;
  --kiosk-text-2: #c8d0cc;
  --kiosk-text-3: #9aa5a0;
  --kiosk-text-4: #6b736f;
  --kiosk-overlay-light: rgb(255 255 255 / 18%);
  --kiosk-overlay-ink: rgb(0 0 0 / 25%);
  --kiosk-overlay-track: rgb(255 255 255 / 25%);

  --kiosk-font: "Inter", system-ui, sans-serif;

  /* chrome sizes (1920-tier) */
  --kiosk-bar-h: 76px;
  --kiosk-banner-h: 112px;
  --kiosk-footer-h: 88px;
  --kiosk-panel-w: 440px;

  /* type ramp (1920-tier) */
  --kiosk-fs-idle-title: 62px;
  --kiosk-fs-idle-sub: 28px;
  --kiosk-fs-verdict-name: 116px;
  --kiosk-fs-verdict-title: 46px;
  --kiosk-fs-chrome: 20px;
  --kiosk-fs-chrome-lg: 24px;
}

@media (max-width: 1679px) {
  :root {
    --kiosk-bar-h: 64px;
    --kiosk-banner-h: 96px;
    --kiosk-footer-h: 72px;
    --kiosk-panel-w: 380px;
    --kiosk-fs-idle-title: 48px;
    --kiosk-fs-idle-sub: 24px;
    --kiosk-fs-verdict-name: 84px;
    --kiosk-fs-verdict-title: 38px;
    --kiosk-fs-chrome: 17px;
    --kiosk-fs-chrome-lg: 21px;
  }
}

@media (max-width: 1179px) {
  :root {
    --kiosk-bar-h: 56px;
    --kiosk-banner-h: 84px;
    --kiosk-footer-h: 0px; /* лог убирается — экран мал для трёх зон */
    --kiosk-panel-w: 320px;
    --kiosk-fs-idle-title: 38px;
    --kiosk-fs-idle-sub: 20px;
    --kiosk-fs-verdict-name: 64px;
    --kiosk-fs-verdict-title: 30px;
    --kiosk-fs-chrome: 15px;
    --kiosk-fs-chrome-lg: 18px;
  }
}

@theme inline {
  --color-kiosk-bg: var(--kiosk-bg);
  --color-kiosk-surface: var(--kiosk-surface);
  --color-kiosk-surface-2: var(--kiosk-surface-2);
  --color-kiosk-border: var(--kiosk-border);
  --color-kiosk-border-2: var(--kiosk-border-2);
  --color-kiosk-outline: var(--kiosk-outline);
  --color-kiosk-brand: var(--kiosk-brand);
  --color-kiosk-ok: var(--kiosk-ok);
  --color-kiosk-warn: var(--kiosk-warn);
  --color-kiosk-warn-text: var(--kiosk-warn-text);
  --color-kiosk-warn-ink: var(--kiosk-warn-ink);
  --color-kiosk-danger: var(--kiosk-danger);
  --color-kiosk-danger-soft: var(--kiosk-danger-soft);
  --color-kiosk-neutral: var(--kiosk-neutral);
  --color-kiosk-text: var(--kiosk-text);
  --color-kiosk-text-2: var(--kiosk-text-2);
  --color-kiosk-text-3: var(--kiosk-text-3);
  --color-kiosk-text-4: var(--kiosk-text-4);
  --color-kiosk-overlay-light: var(--kiosk-overlay-light);
  --color-kiosk-overlay-ink: var(--kiosk-overlay-ink);
  --color-kiosk-overlay-track: var(--kiosk-overlay-track);
}

/* type-ramp helpers (plain classes — no tailwind-merge involvement) */
.kiosk-type-idle-title { font-size: var(--kiosk-fs-idle-title); font-weight: 800; letter-spacing: -0.02em; }
.kiosk-type-idle-sub { font-size: var(--kiosk-fs-idle-sub); }
.kiosk-type-verdict-name { font-size: var(--kiosk-fs-verdict-name); font-weight: 800; letter-spacing: -0.025em; line-height: 1.04; overflow-wrap: anywhere; }
.kiosk-type-verdict-title { font-size: var(--kiosk-fs-verdict-title); font-weight: 800; letter-spacing: 0.08em; }

/* motion (transform/opacity-only — cheap on Pi) */
@keyframes kiosk-scan { 0% { top: 8%; opacity: 1; } 48% { top: 88%; opacity: 1; } 52%, 100% { top: 8%; opacity: 0; } }
@keyframes kiosk-beam { 0%, 100% { transform: translateX(-170px); } 50% { transform: translateX(170px); } }
@keyframes kiosk-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
@keyframes kiosk-drift { 0%, 100% { transform: translate(0, 0); } 25% { transform: translate(9px, 5px); } 50% { transform: translate(0, 10px); } 75% { transform: translate(-9px, 5px); } }
```

- [ ] **Step 4: Exempt the kiosk theme from the hardcoded-color scan**

In `packages/ui/src/no-hardcoded-colors.test.ts`:

```ts
const EXEMPT = new Set(["theme.css", "theme.test.ts", "kiosk-theme.css", "kiosk-theme.test.ts"]);
```

- [ ] **Step 5: Add package exports**

In `packages/ui/package.json`:

```json
  "exports": {
    ".": "./src/index.ts",
    "./theme.css": "./src/theme.css",
    "./kiosk": "./src/kiosk/index.ts",
    "./kiosk-theme.css": "./src/kiosk/kiosk-theme.css"
  },
```

Create a placeholder `packages/ui/src/kiosk/index.ts` (filled by later tasks):

```ts
export {};
```

- [ ] **Step 6: Amend AGENTS.md**

In `packages/ui/AGENTS.md`: change the React-compat line to say the desktop kiosk runs React 19 (peer stays `>=18`; React-19-only APIs still banned in the package), and append:

```markdown
- **kiosk/ subtree (`@idento/ui/kiosk`):** kiosk-strict design system for the desktop kiosk.
  Dark-only for now (light pair is a planned later phase) — the "both themes" rule does not
  apply inside `src/kiosk/` yet. Kiosk colors live ONLY in `src/kiosk/kiosk-theme.css`.
  Everything else (props-only strings, lucide-only, icon+text+color) applies unchanged.
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm test -w @idento/ui`
Expected: PASS (kiosk-theme tests green, no-hardcoded-colors green).

- [ ] **Step 8: Commit**

```bash
git add packages/ui/src/kiosk packages/ui/src/no-hardcoded-colors.test.ts packages/ui/package.json packages/ui/AGENTS.md
git commit -m "feat(ui/kiosk): kiosk-strict theme tokens, type ramp, keyframes"
```

---

### Task 3: station status model

**Files:**
- Create: `packages/ui/src/kiosk/station-status.ts`
- Test: `packages/ui/src/kiosk/station-status.test.ts`
- Modify: `packages/ui/src/kiosk/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:

```ts
export type KioskNodeLevel = "ok" | "warn" | "error";
export interface KioskNode {
  id: string;              // "server" | "agent" | "printer" | "scanner" | custom
  label: string;           // display name, already localized by the app
  level: KioskNodeLevel;
  detail?: string;         // "12 мс" / "v1.4.2" / "нет ленты" — shown by chips/panel
  live?: boolean;          // breathing dot (e.g. serial scanner listening)
}
export type StationLevel = "ok" | "degraded" | "blocked";
export function stationLevel(nodes: KioskNode[]): StationLevel;
```

- [ ] **Step 1: Write the failing test**

`packages/ui/src/kiosk/station-status.test.ts`:

```ts
import { stationLevel, type KioskNode } from "./station-status";

const node = (level: KioskNode["level"]): KioskNode => ({ id: "n", label: "N", level });

describe("stationLevel", () => {
  it("is ok when all nodes are ok", () => {
    expect(stationLevel([node("ok"), node("ok")])).toBe("ok");
  });
  it("is degraded when any node warns (регистрация продолжается)", () => {
    expect(stationLevel([node("ok"), node("warn")])).toBe("degraded");
  });
  it("is blocked when any node errors (линия стоит), even alongside warns", () => {
    expect(stationLevel([node("warn"), node("error")])).toBe("blocked");
  });
  it("is ok for an empty list", () => {
    expect(stationLevel([])).toBe("ok");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @idento/ui -- src/kiosk/station-status.test.ts`
Expected: FAIL ("station-status" not found).

- [ ] **Step 3: Implement `station-status.ts`**

```ts
export type KioskNodeLevel = "ok" | "warn" | "error";

export interface KioskNode {
  id: string;
  label: string;
  level: KioskNodeLevel;
  detail?: string;
  live?: boolean;
}

/** Единые правила эскалации: зелёная тишина → янтарь (работа продолжается) → красный (линия стоит). */
export type StationLevel = "ok" | "degraded" | "blocked";

export function stationLevel(nodes: KioskNode[]): StationLevel {
  if (nodes.some((n) => n.level === "error")) return "blocked";
  if (nodes.some((n) => n.level === "warn")) return "degraded";
  return "ok";
}
```

Add to `packages/ui/src/kiosk/index.ts` (replace the `export {}` placeholder):

```ts
export { stationLevel, type KioskNode, type KioskNodeLevel, type StationLevel } from "./station-status";
```

- [ ] **Step 4: Run tests, verify pass, commit**

```bash
npm test -w @idento/ui -- src/kiosk/station-status.test.ts
git add packages/ui/src/kiosk
git commit -m "feat(ui/kiosk): station escalation model (ok/degraded/blocked)"
```

---

### Task 4: StatusChip, TopStatusBar, BlockingBanner

**Files:**
- Create: `packages/ui/src/kiosk/status-chip.tsx`, `packages/ui/src/kiosk/top-status-bar.tsx`, `packages/ui/src/kiosk/blocking-banner.tsx`
- Test: `packages/ui/src/kiosk/status-chip.test.tsx`, `packages/ui/src/kiosk/top-status-bar.test.tsx`, `packages/ui/src/kiosk/blocking-banner.test.tsx`
- Modify: `packages/ui/src/kiosk/index.ts`

**Interfaces:**
- Consumes: `KioskNode` from Task 3; `cn` from `../lib/cn`.
- Produces:

```ts
export interface StatusChipProps { node: KioskNode; className?: string }
export function StatusChip(props: StatusChipProps): JSX.Element;

export interface TopStatusBarProps {
  eventName: string;
  locationLabel?: string;        // "Главный вход · День 2"
  modeLabel?: string;            // "Регистрация · автопечать"
  nodes: KioskNode[];
  counterLabel: string;          // "Отмечено"
  counterValue: number;
  clock?: string;                // "14:32"
  className?: string;
}
export function TopStatusBar(props: TopStatusBarProps): JSX.Element;

export interface BlockingBannerProps {
  title: string;                 // "Нет связи с сервером"
  subtitle?: string;             // "Отметки не записываются · последняя успешная 14:33"
  retryLabel: string;            // "Повторить сейчас"
  onRetry: () => void;
  retryHint?: string;            // "авто-повтор через 12 с"
  className?: string;
}
export function BlockingBanner(props: BlockingBannerProps): JSX.Element;
```

- [ ] **Step 1: Write the failing tests**

`status-chip.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { StatusChip } from "./status-chip";

describe("StatusChip", () => {
  it("ok: quiet dot + label", () => {
    render(<StatusChip node={{ id: "server", label: "Сервер", level: "ok" }} />);
    const chip = screen.getByText("Сервер").closest("[data-level]")!;
    expect(chip).toHaveAttribute("data-level", "ok");
  });
  it("live ok node breathes", () => {
    render(<StatusChip node={{ id: "scanner", label: "Сканер COM3", level: "ok", live: true }} />);
    expect(screen.getByText("Сканер COM3").closest("[data-level]")!.querySelector(".animate-\\[kiosk-pulse_2s_infinite\\]")).toBeTruthy();
  });
  it("warn: amber pill with icon, label and detail", () => {
    render(<StatusChip node={{ id: "printer", label: "Принтер", level: "warn", detail: "нет ленты" }} />);
    const chip = screen.getByText(/Принтер/).closest("[data-level]")!;
    expect(chip).toHaveAttribute("data-level", "warn");
    expect(chip).toHaveClass("bg-kiosk-warn");
    expect(chip.textContent).toContain("нет ленты");
    expect(chip.querySelector("svg")).toBeTruthy(); // icon duplicates the color (WCAG 1.4.1)
  });
  it("error: red pill with icon", () => {
    render(<StatusChip node={{ id: "server", label: "Сервер", level: "error", detail: "нет связи" }} />);
    const chip = screen.getByText(/Сервер/).closest("[data-level]")!;
    expect(chip).toHaveClass("bg-kiosk-danger");
    expect(chip.querySelector("svg")).toBeTruthy();
  });
});
```

`top-status-bar.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { TopStatusBar } from "./top-status-bar";

const nodes = [
  { id: "server", label: "Сервер", level: "ok" as const },
  { id: "printer", label: "Zebra ZD421", level: "ok" as const },
];

describe("TopStatusBar", () => {
  it("renders event, location, mode pill, chips, counter and clock", () => {
    render(
      <TopStatusBar eventName="Технопром-2026" locationLabel="Главный вход · День 2" modeLabel="Регистрация · автопечать" nodes={nodes} counterLabel="Отмечено" counterValue={412} clock="14:32" />,
    );
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByText("Технопром-2026")).toBeInTheDocument();
    expect(screen.getByText("Регистрация · автопечать")).toBeInTheDocument();
    expect(screen.getByText("Zebra ZD421")).toBeInTheDocument();
    expect(screen.getByText("412")).toBeInTheDocument();
    expect(screen.getByText("14:32")).toBeInTheDocument();
  });
});
```

`blocking-banner.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BlockingBanner } from "./blocking-banner";

describe("BlockingBanner", () => {
  it("renders alert with title, subtitle, hint and working retry", async () => {
    const onRetry = vi.fn();
    render(<BlockingBanner title="Нет связи с сервером" subtitle="Отметки не записываются" retryHint="авто-повтор через 12 с" retryLabel="Повторить сейчас" onRetry={onRetry} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveClass("bg-kiosk-danger");
    expect(screen.getByText("Отметки не записываются")).toBeInTheDocument();
    expect(screen.getByText("авто-повтор через 12 с")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Повторить сейчас" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
```

Note: if `@testing-library/user-event` is not yet a devDependency of `packages/ui`, add it (`npm install -D -w @idento/ui @testing-library/user-event`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @idento/ui -- src/kiosk`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement**

`status-chip.tsx`:

```tsx
import { TriangleAlert, X } from "lucide-react";
import { cn } from "../lib/cn";
import type { KioskNode } from "./station-status";

export interface StatusChipProps {
  node: KioskNode;
  className?: string;
}

/** Чип 1e: ok — тихая точка с подписью; warn — янтарная пилюля; error — красная. */
export function StatusChip({ node, className }: StatusChipProps) {
  const text = node.detail && node.level !== "ok" ? `${node.label}: ${node.detail}` : node.label;

  if (node.level === "ok") {
    return (
      <span data-level="ok" className={cn("flex items-center gap-2.5 text-kiosk-text-3", node.live && "font-semibold text-kiosk-text", className)} style={{ fontSize: "var(--kiosk-fs-chrome)" }}>
        <span aria-hidden className={cn("size-3 rounded-full bg-kiosk-ok", node.live && "animate-[kiosk-pulse_2s_infinite]")} />
        {text}
      </span>
    );
  }

  const warn = node.level === "warn";
  const Icon = warn ? TriangleAlert : X;
  return (
    <span
      data-level={node.level}
      className={cn("flex items-center gap-2.5 rounded-full px-4 py-2 font-bold", warn ? "bg-kiosk-warn text-kiosk-warn-ink" : "bg-kiosk-danger text-kiosk-text", className)}
      style={{ fontSize: "var(--kiosk-fs-chrome)" }}
    >
      <Icon aria-hidden className="size-[1.1em] shrink-0" />
      {text}
    </span>
  );
}
```

`top-status-bar.tsx`:

```tsx
import { cn } from "../lib/cn";
import type { KioskNode } from "./station-status";
import { StatusChip } from "./status-chip";

export interface TopStatusBarProps {
  eventName: string;
  locationLabel?: string;
  modeLabel?: string;
  nodes: KioskNode[];
  counterLabel: string;
  counterValue: number;
  clock?: string;
  className?: string;
}

/** Компоновка 1a: статус-полоса сверху, 76px (var), «зелёная тишина». */
export function TopStatusBar({ eventName, locationLabel, modeLabel, nodes, counterLabel, counterValue, clock, className }: TopStatusBarProps) {
  return (
    <header
      className={cn("flex shrink-0 items-center gap-5 border-b border-kiosk-border bg-kiosk-surface px-9 text-kiosk-text", className)}
      style={{ height: "var(--kiosk-bar-h)", fontFamily: "var(--kiosk-font)" }}
    >
      <div className="font-bold" style={{ fontSize: "var(--kiosk-fs-chrome-lg)" }}>{eventName}</div>
      {locationLabel && <div className="text-kiosk-text-4" style={{ fontSize: "var(--kiosk-fs-chrome)" }}>{locationLabel}</div>}
      {modeLabel && (
        <div className="rounded-full border border-kiosk-border-2 bg-kiosk-surface-2 px-4 py-1.5 font-semibold text-kiosk-text-2" style={{ fontSize: "var(--kiosk-fs-chrome)" }}>
          {modeLabel}
        </div>
      )}
      <div className="ml-auto flex items-center gap-6">
        {nodes.map((n) => <StatusChip key={n.id} node={n} />)}
        <span aria-hidden className="h-8 w-px bg-kiosk-border-2" />
        <span className="text-kiosk-text-3" style={{ fontSize: "var(--kiosk-fs-chrome)" }}>
          {counterLabel}&nbsp;<b className="text-kiosk-text" style={{ fontSize: "var(--kiosk-fs-chrome-lg)" }}>{counterValue}</b>
        </span>
        {clock && <span className="text-kiosk-text-4 tabular-nums" style={{ fontSize: "var(--kiosk-fs-chrome)" }}>{clock}</span>}
      </div>
    </header>
  );
}
```

`blocking-banner.tsx`:

```tsx
import { X } from "lucide-react";
import { cn } from "../lib/cn";

export interface BlockingBannerProps {
  title: string;
  subtitle?: string;
  retryLabel: string;
  onRetry: () => void;
  retryHint?: string;
  className?: string;
}

/** Красный баннер блокировки (112px, var): занимает место статус-полосы, всегда с действием. */
export function BlockingBanner({ title, subtitle, retryLabel, onRetry, retryHint, className }: BlockingBannerProps) {
  return (
    <div role="alert" className={cn("flex shrink-0 items-center gap-6 bg-kiosk-danger px-9 text-kiosk-text", className)} style={{ height: "var(--kiosk-banner-h)", fontFamily: "var(--kiosk-font)" }}>
      <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-full bg-kiosk-overlay-ink">
        <X className="size-6" strokeWidth={3} />
      </span>
      <span className="min-w-0">
        <span className="block truncate font-extrabold" style={{ fontSize: "var(--kiosk-fs-chrome-lg)" }}>{title}</span>
        {subtitle && <span className="block truncate opacity-85" style={{ fontSize: "var(--kiosk-fs-chrome)" }}>{subtitle}</span>}
      </span>
      {retryHint && <span className="ml-auto shrink-0 opacity-85" style={{ fontSize: "var(--kiosk-fs-chrome)" }}>{retryHint}</span>}
      <button type="button" onClick={onRetry} className={cn("shrink-0 rounded-xl bg-kiosk-text px-7 py-3.5 font-extrabold text-kiosk-danger", !retryHint && "ml-auto")} style={{ fontSize: "var(--kiosk-fs-chrome-lg)" }}>
        {retryLabel}
      </button>
    </div>
  );
}
```

Append to `packages/ui/src/kiosk/index.ts`:

```ts
export { StatusChip, type StatusChipProps } from "./status-chip";
export { TopStatusBar, type TopStatusBarProps } from "./top-status-bar";
export { BlockingBanner, type BlockingBannerProps } from "./blocking-banner";
```

- [ ] **Step 4: Run tests, verify pass, commit**

```bash
npm test -w @idento/ui -- src/kiosk && npm run typecheck -w @idento/ui && npm run lint -w @idento/ui
git add packages/ui/src/kiosk packages/ui/package.json package-lock.json
git commit -m "feat(ui/kiosk): StatusChip, TopStatusBar, BlockingBanner (1e/1a escalation chrome)"
```

---

### Task 5: RecentLog and OperatorPanel

**Files:**
- Create: `packages/ui/src/kiosk/recent-log.tsx`, `packages/ui/src/kiosk/operator-panel.tsx`
- Test: `packages/ui/src/kiosk/recent-log.test.tsx`, `packages/ui/src/kiosk/operator-panel.test.tsx`
- Modify: `packages/ui/src/kiosk/index.ts`

**Interfaces:**
- Consumes: `Verdict` from `../lib/verdict`; `KioskNode`, `StatusChip`, `cn`.
- Produces:

```ts
export interface RecentLogEntry { time: string; name: string; outcome: Verdict }
export interface RecentLogProps {
  title?: string;                  // "ПОСЛЕДНИЕ" (bar layout only)
  entries: RecentLogEntry[];
  layout?: "bar" | "panel";        // bar = horizontal footer (88px), panel = column
  trailing?: string;               // e.g. "2 бейджа ждут печати" (bar layout, amber, right)
  className?: string;
}
export function RecentLog(props: RecentLogProps): JSX.Element;

export interface OperatorPanelProps {
  eventName: string;
  locationLabel?: string;
  modeLabel?: string;
  nodes: KioskNode[];              // ok rows: dot + label + detail right; warn/error rows grow into cards
  counterValue: number;
  counterLabel: string;            // "отмечено сегодня"
  log: RecentLogEntry[];
  className?: string;
}
export function OperatorPanel(props: OperatorPanelProps): JSX.Element;
```

- [ ] **Step 1: Write the failing tests**

`recent-log.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { RecentLog } from "./recent-log";

const entries = [
  { time: "14:32", name: "Александра Константинопольская", outcome: "allowed" as const },
  { time: "14:31", name: "Пётр Верещагин", outcome: "already_checked_in" as const },
];

describe("RecentLog", () => {
  it("bar layout: title, rows with time+name+outcome icon, trailing note", () => {
    render(<RecentLog title="ПОСЛЕДНИЕ" entries={entries} trailing="2 бейджа ждут печати" />);
    expect(screen.getByText("ПОСЛЕДНИЕ")).toBeInTheDocument();
    expect(screen.getByText("Пётр Верещагин")).toBeInTheDocument();
    expect(screen.getByText("2 бейджа ждут печати")).toBeInTheDocument();
    expect(screen.getByText("14:32").parentElement!.querySelector("svg")).toBeTruthy();
  });
  it("panel layout: column without title", () => {
    render(<RecentLog entries={entries} layout="panel" />);
    expect(screen.queryByText("ПОСЛЕДНИЕ")).not.toBeInTheDocument();
    expect(screen.getByText("Пётр Верещагин")).toBeInTheDocument();
  });
});
```

`operator-panel.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { OperatorPanel } from "./operator-panel";

describe("OperatorPanel", () => {
  it("renders event, statuses with details, counter and log (1c)", () => {
    render(
      <OperatorPanel
        eventName="Технопром-2026"
        locationLabel="Главный вход · День 2"
        modeLabel="Регистрация · автопечать"
        nodes={[
          { id: "server", label: "Сервер", level: "ok", detail: "12 мс" },
          { id: "printer", label: "Принтер", level: "warn", detail: "нет ленты" },
        ]}
        counterValue={412}
        counterLabel="отмечено сегодня"
        log={[{ time: "14:32", name: "Мария Свиридова", outcome: "allowed" }]}
      />,
    );
    expect(screen.getByRole("complementary")).toBeInTheDocument();
    expect(screen.getByText("12 мс")).toBeInTheDocument();
    expect(screen.getByText(/нет ленты/)).toBeInTheDocument(); // warn row grows into amber card
    expect(screen.getByText("412")).toBeInTheDocument();
    expect(screen.getByText("Мария Свиридова")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @idento/ui -- src/kiosk/recent-log src/kiosk/operator-panel`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement**

`recent-log.tsx`:

```tsx
import { Check, CircleHelp, TriangleAlert, X } from "lucide-react";
import { cn } from "../lib/cn";
import type { Verdict } from "../lib/verdict";

export interface RecentLogEntry {
  time: string;
  name: string;
  outcome: Verdict;
}

export interface RecentLogProps {
  title?: string;
  entries: RecentLogEntry[];
  layout?: "bar" | "panel";
  trailing?: string;
  className?: string;
}

const OUTCOME_ICON: Record<Verdict, { Icon: typeof Check; cls: string }> = {
  allowed: { Icon: Check, cls: "text-kiosk-ok" },
  already_checked_in: { Icon: TriangleAlert, cls: "text-kiosk-warn" },
  not_registered: { Icon: CircleHelp, cls: "text-kiosk-text-3" },
  no_access: { Icon: X, cls: "text-kiosk-danger-soft" },
};

function Row({ entry, layout }: { entry: RecentLogEntry; layout: "bar" | "panel" }) {
  const { Icon, cls } = OUTCOME_ICON[entry.outcome];
  return (
    <span className="flex min-w-0 items-center gap-3 text-kiosk-text-2" style={{ fontSize: "var(--kiosk-fs-chrome)" }}>
      <span className="shrink-0 text-kiosk-text-4 tabular-nums">{entry.time}</span>
      <span className={cn(layout === "panel" && "truncate")}>{entry.name}</span>
      <Icon aria-hidden className={cn("size-[1.1em] shrink-0 font-bold", cls, layout === "panel" && "ml-auto")} strokeWidth={3} />
    </span>
  );
}

/** Лог последних отметок: bar — футер 88px (1a), panel — колонка в панели оператора (1c). */
export function RecentLog({ title, entries, layout = "bar", trailing, className }: RecentLogProps) {
  if (layout === "panel") {
    return (
      <div className={cn("flex flex-col gap-3 border-t border-kiosk-border pt-6", className)}>
        {entries.map((e, i) => <Row key={i} entry={e} layout="panel" />)}
      </div>
    );
  }
  return (
    <footer className={cn("flex shrink-0 items-center gap-10 border-t border-kiosk-border px-9", className)} style={{ height: "var(--kiosk-footer-h)", fontFamily: "var(--kiosk-font)" }}>
      {title && <span className="font-semibold tracking-[.06em] text-kiosk-text-4" style={{ fontSize: "var(--kiosk-fs-chrome)" }}>{title}</span>}
      {entries.map((e, i) => <Row key={i} entry={e} layout="bar" />)}
      {trailing && <span className="ml-auto font-semibold text-kiosk-warn-text" style={{ fontSize: "var(--kiosk-fs-chrome)" }}>{trailing}</span>}
    </footer>
  );
}
```

`operator-panel.tsx`:

```tsx
import { TriangleAlert, X } from "lucide-react";
import { cn } from "../lib/cn";
import { RecentLog, type RecentLogEntry } from "./recent-log";
import type { KioskNode } from "./station-status";

export interface OperatorPanelProps {
  eventName: string;
  locationLabel?: string;
  modeLabel?: string;
  nodes: KioskNode[];
  counterValue: number;
  counterLabel: string;
  log: RecentLogEntry[];
  className?: string;
}

function NodeRow({ node }: { node: KioskNode }) {
  if (node.level === "ok") {
    return (
      <div className="flex items-center gap-3.5 text-kiosk-text-3" style={{ fontSize: "var(--kiosk-fs-chrome)" }}>
        <span aria-hidden className={cn("size-3 rounded-full bg-kiosk-ok", node.live && "animate-[kiosk-pulse_2s_infinite]")} />
        {node.label}
        {node.detail && <span className="ml-auto text-kiosk-text-4">{node.detail}</span>}
      </div>
    );
  }
  const warn = node.level === "warn";
  const Icon = warn ? TriangleAlert : X;
  return (
    <div data-level={node.level} className={cn("flex items-start gap-3 rounded-xl p-4 font-bold", warn ? "bg-kiosk-warn text-kiosk-warn-ink" : "bg-kiosk-danger text-kiosk-text")} style={{ fontSize: "var(--kiosk-fs-chrome)" }}>
      <Icon aria-hidden className="mt-0.5 size-[1.1em] shrink-0" />
      <span>
        {node.label}
        {node.detail && <span className="block font-semibold opacity-90">{node.detail}</span>}
      </span>
    </div>
  );
}

/** Компоновка 1c: постоянная панель оператора слева (440px, var), тёмная при любом вердикте. */
export function OperatorPanel({ eventName, locationLabel, modeLabel, nodes, counterValue, counterLabel, log, className }: OperatorPanelProps) {
  return (
    <aside className={cn("flex shrink-0 flex-col border-r border-kiosk-border bg-kiosk-surface px-9 py-10 text-kiosk-text", className)} style={{ width: "var(--kiosk-panel-w)", fontFamily: "var(--kiosk-font)" }}>
      <div className="font-extrabold leading-tight tracking-tight" style={{ fontSize: "calc(var(--kiosk-fs-chrome-lg) * 1.33)" }}>{eventName}</div>
      {locationLabel && <div className="mt-2 text-kiosk-text-4" style={{ fontSize: "var(--kiosk-fs-chrome)" }}>{locationLabel}</div>}
      {modeLabel && (
        <div className="mt-5 self-start rounded-xl border border-kiosk-border-2 bg-kiosk-surface-2 px-4 py-3 font-semibold text-kiosk-text-2" style={{ fontSize: "var(--kiosk-fs-chrome)" }}>
          {modeLabel}
        </div>
      )}
      <div className="mt-11 flex flex-col gap-4">
        {nodes.map((n) => <NodeRow key={n.id} node={n} />)}
      </div>
      <div className="mt-auto">
        <div className="font-extrabold leading-none tracking-tighter" style={{ fontSize: "calc(var(--kiosk-fs-verdict-name) * 0.72)" }}>{counterValue}</div>
        <div className="mt-1.5 text-kiosk-text-4" style={{ fontSize: "var(--kiosk-fs-chrome)" }}>{counterLabel}</div>
        <RecentLog entries={log} layout="panel" className="mt-7" />
      </div>
    </aside>
  );
}
```

Append to `index.ts`:

```ts
export { RecentLog, type RecentLogEntry, type RecentLogProps } from "./recent-log";
export { OperatorPanel, type OperatorPanelProps } from "./operator-panel";
```

- [ ] **Step 4: Run tests, verify pass, commit**

```bash
npm test -w @idento/ui -- src/kiosk && npm run typecheck -w @idento/ui && npm run lint -w @idento/ui
git add packages/ui/src/kiosk
git commit -m "feat(ui/kiosk): RecentLog and OperatorPanel (1c side layout)"
```

---

### Task 6: VerdictScreen

**Files:**
- Create: `packages/ui/src/kiosk/verdict-screen.tsx`
- Test: `packages/ui/src/kiosk/verdict-screen.test.tsx`
- Modify: `packages/ui/src/kiosk/index.ts`

**Interfaces:**
- Consumes: `Verdict` from `../lib/verdict`; `cn`.
- Produces:

```ts
export interface VerdictAction { label: string; onClick: () => void; kind: "solid" | "outline" }
export interface VerdictScreenProps {
  verdict: Verdict;
  title: string;                        // "ОТМЕЧЕНА" / "УЖЕ ОТМЕЧЕН" / "КОД НЕ НАЙДЕН" / "ПРОПУСК АННУЛИРОВАН"
  name?: string;                        // huge name (allowed/already/no_access)
  message?: string;                     // e.g. "Этого кода нет в списке события" (not_registered) or self-service instruction
  meta?: { label: string; value: string }[];
  highlight?: string;                   // "Ранее: сегодня 12:04 · Вход Б · станция 3"
  cornerNote?: string;                  // "14:32 · впервые"
  actions?: VerdictAction[];
  autoReturn?: { label: string; progress: number };   // progress 0..1; таймер живёт в приложении
  privacy?: boolean;                    // self-service: только имя + инструкция, по центру
  className?: string;
}
export function VerdictScreen(props: VerdictScreenProps): JSX.Element;
```

Color/icon mapping (canvas 1l/1m/1n/1o/1q): `allowed` → `bg-kiosk-brand`, Check; `already_checked_in` → `bg-kiosk-warn text-kiosk-warn-ink`, TriangleAlert; `not_registered` → `bg-kiosk-neutral`, CircleHelp; `no_access` → `bg-kiosk-danger`, X. Feedback ≤200 мс достигается тем, что фон/иконка рисуются без ожидания деталей (детали — просто пропсы, могут прийти вторым рендером).

- [ ] **Step 1: Write the failing test**

`verdict-screen.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VerdictScreen } from "./verdict-screen";

describe("VerdictScreen", () => {
  it("allowed: brand field, name, meta, auto-return progress", () => {
    render(
      <VerdictScreen verdict="allowed" title="ОТМЕЧЕНА" name="Александра Константинопольская" cornerNote="14:32 · впервые" meta={[{ label: "Категория", value: "VIP · все зоны" }]} autoReturn={{ label: "Возврат к сканированию · 5 с", progress: 0.58 }} />,
    );
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("data-verdict", "allowed");
    expect(region).toHaveClass("bg-kiosk-brand");
    expect(screen.getByText("Александра Константинопольская")).toBeInTheDocument();
    expect(screen.getByText("VIP · все зоны")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "58");
  });

  it("already_checked_in: amber field, highlight callout, actions work, no auto-return", async () => {
    const pass = vi.fn();
    render(
      <VerdictScreen verdict="already_checked_in" title="УЖЕ ОТМЕЧЕН" name="Пётр Верещагин" highlight="Ранее: сегодня 12:04 · Вход Б · станция 3" actions={[{ label: "Всё равно пропустить", onClick: pass, kind: "solid" }, { label: "Следующий", onClick: () => {}, kind: "outline" }]} />,
    );
    expect(screen.getByRole("status")).toHaveClass("bg-kiosk-warn");
    expect(screen.getByText(/Ранее: сегодня 12:04/)).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Всё равно пропустить" }));
    expect(pass).toHaveBeenCalledOnce();
  });

  it("not_registered: neutral dark (не красный), message instead of name", () => {
    render(<VerdictScreen verdict="not_registered" title="КОД НЕ НАЙДЕН" message="Этого кода нет в списке события" meta={[{ label: "Код", value: "EVT-2026-88410-X" }]} />);
    const region = screen.getByRole("status");
    expect(region).toHaveClass("bg-kiosk-neutral");
    expect(screen.getByText("Этого кода нет в списке события")).toBeInTheDocument();
  });

  it("no_access: red field", () => {
    render(<VerdictScreen verdict="no_access" title="ПРОПУСК АННУЛИРОВАН" name="Игорь Малахов" meta={[{ label: "Причина", value: "Возврат билета · 08.07.2026" }]} />);
    expect(screen.getByRole("status")).toHaveClass("bg-kiosk-danger");
  });

  it("privacy: centered self-service variant with message and auto-return", () => {
    render(<VerdictScreen verdict="allowed" title="Добро пожаловать" privacy name="Добро пожаловать, Александра!" message="Ваш бейдж печатается — заберите его в лотке ниже" autoReturn={{ label: "экран сменится автоматически", progress: 0.35 }} />);
    expect(screen.getByRole("status")).toHaveAttribute("data-privacy", "true");
    expect(screen.getByText(/бейдж печатается/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @idento/ui -- src/kiosk/verdict-screen`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `verdict-screen.tsx`**

```tsx
import { Check, CircleHelp, TriangleAlert, X } from "lucide-react";
import { cn } from "../lib/cn";
import type { Verdict } from "../lib/verdict";

export interface VerdictAction {
  label: string;
  onClick: () => void;
  kind: "solid" | "outline";
}

export interface VerdictScreenProps {
  verdict: Verdict;
  title: string;
  name?: string;
  message?: string;
  meta?: { label: string; value: string }[];
  highlight?: string;
  cornerNote?: string;
  actions?: VerdictAction[];
  autoReturn?: { label: string; progress: number };
  privacy?: boolean;
  className?: string;
}

const STYLES: Record<Verdict, { field: string; disc: string; icon: typeof Check; iconCls: string; solid: string; outline: string; muted: string; highlight: string; track: string }> = {
  allowed: {
    field: "bg-kiosk-brand text-kiosk-text", disc: "bg-kiosk-overlay-light", icon: Check, iconCls: "text-kiosk-text",
    solid: "bg-kiosk-text text-kiosk-brand", outline: "border-[3px] border-kiosk-text/50",
    muted: "opacity-70", highlight: "border-kiosk-overlay-light bg-kiosk-overlay-light", track: "bg-kiosk-overlay-track",
  },
  already_checked_in: {
    field: "bg-kiosk-warn text-kiosk-warn-ink", disc: "bg-kiosk-warn-ink", icon: TriangleAlert, iconCls: "text-kiosk-warn",
    solid: "bg-kiosk-warn-ink text-kiosk-warn-text", outline: "border-[3px] border-kiosk-warn-ink/40",
    muted: "opacity-65", highlight: "border-kiosk-warn-ink/30 bg-kiosk-warn-ink/10", track: "bg-kiosk-warn-ink/25",
  },
  not_registered: {
    field: "bg-kiosk-neutral text-kiosk-text", disc: "bg-kiosk-overlay-light", icon: CircleHelp, iconCls: "text-kiosk-text",
    solid: "bg-kiosk-brand text-kiosk-text", outline: "border-[3px] border-kiosk-outline text-kiosk-text-2",
    muted: "text-kiosk-text-3", highlight: "border-kiosk-outline bg-kiosk-overlay-light", track: "bg-kiosk-overlay-track",
  },
  no_access: {
    field: "bg-kiosk-danger text-kiosk-text", disc: "bg-kiosk-overlay-ink", icon: X, iconCls: "text-kiosk-text",
    solid: "bg-kiosk-text text-kiosk-danger", outline: "border-[3px] border-kiosk-text/50",
    muted: "opacity-75", highlight: "border-kiosk-overlay-ink bg-kiosk-overlay-ink", track: "bg-kiosk-overlay-track",
  },
};

function AutoReturn({ label, progress, track }: { label: string; progress: number; track: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  return (
    <div className="flex items-center gap-7">
      <span className="shrink-0 opacity-85" style={{ fontSize: "var(--kiosk-fs-idle-sub)" }}>{label}</span>
      <span role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} className={cn("block h-2.5 flex-1 overflow-hidden rounded-[5px]", track)}>
        <span className="block h-full rounded-[5px] bg-kiosk-text" style={{ width: `${pct}%` }} />
      </span>
    </div>
  );
}

/** Полноэкранный вердикт: цвет всегда дублирован иконкой и подписью; privacy — self-service вариант. */
export function VerdictScreen({ verdict, title, name, message, meta, highlight, cornerNote, actions, autoReturn, privacy, className }: VerdictScreenProps) {
  const s = STYLES[verdict];
  const Icon = s.icon;

  if (privacy) {
    return (
      <section role="status" data-verdict={verdict} data-privacy="true" className={cn("relative flex h-full flex-col items-center justify-center gap-11 p-20 text-center", s.field, className)} style={{ fontFamily: "var(--kiosk-font)" }}>
        <span aria-hidden className={cn("grid size-36 place-items-center rounded-full", s.disc)}>
          <Icon className={cn("size-20", s.iconCls)} strokeWidth={3} />
        </span>
        {name && <div className="kiosk-type-verdict-name">{name}</div>}
        {message && <div className="font-bold opacity-95" style={{ fontSize: "calc(var(--kiosk-fs-verdict-title) * 0.96)" }}>{message}</div>}
        {autoReturn && <div className="absolute inset-x-20 bottom-16"><AutoReturn {...autoReturn} track={s.track} /></div>}
      </section>
    );
  }

  return (
    <section role="status" data-verdict={verdict} className={cn("flex h-full flex-col p-[clamp(32px,6vh,88px)_clamp(36px,5vw,96px)]", s.field, className)} style={{ fontFamily: "var(--kiosk-font)" }}>
      <div className="flex items-center gap-8">
        <span aria-hidden className={cn("grid size-[110px] shrink-0 place-items-center rounded-full", s.disc)}>
          <Icon className={cn("size-14", s.iconCls)} strokeWidth={3} />
        </span>
        <span className="kiosk-type-verdict-title">{title}</span>
        {cornerNote && <span className="ml-auto opacity-80 tabular-nums" style={{ fontSize: "var(--kiosk-fs-idle-sub)" }}>{cornerNote}</span>}
      </div>
      {name && <div className="kiosk-type-verdict-name mt-14">{name}</div>}
      {message && <div className="mt-14 max-w-[1400px] font-extrabold leading-tight tracking-tight" style={{ fontSize: "calc(var(--kiosk-fs-verdict-name) * 0.48)" }}>{message}</div>}
      {highlight && (
        <div className={cn("mt-9 self-start rounded-2xl border-2 px-9 py-7 font-extrabold", s.highlight)} style={{ fontSize: "calc(var(--kiosk-fs-verdict-title) * 0.87)" }}>
          {highlight}
        </div>
      )}
      {meta && meta.length > 0 && (
        <dl className="mt-11 grid grid-cols-[280px_1fr] gap-x-7 gap-y-5" style={{ fontSize: "calc(var(--kiosk-fs-idle-sub) * 1.14)" }}>
          {meta.map((m) => (
            <div key={m.label} className="contents">
              <dt className={s.muted}>{m.label}</dt>
              <dd className="font-bold">{m.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="mt-auto flex flex-col gap-6 pt-8">
        {actions && actions.length > 0 && (
          <div className="flex gap-6">
            {actions.map((a) => (
              <button key={a.label} type="button" onClick={a.onClick} className={cn("grid h-24 flex-1 place-items-center rounded-2xl font-extrabold", a.kind === "solid" ? s.solid : s.outline)} style={{ fontSize: "calc(var(--kiosk-fs-idle-sub) * 1.14)" }}>
                {a.label}
              </button>
            ))}
          </div>
        )}
        {autoReturn && <AutoReturn {...autoReturn} track={s.track} />}
      </div>
    </section>
  );
}
```

Append to `index.ts`:

```ts
export { VerdictScreen, type VerdictAction, type VerdictScreenProps } from "./verdict-screen";
```

- [ ] **Step 4: Run tests, verify pass, commit**

```bash
npm test -w @idento/ui -- src/kiosk && npm run typecheck -w @idento/ui && npm run lint -w @idento/ui
git add packages/ui/src/kiosk
git commit -m "feat(ui/kiosk): full-screen VerdictScreen (1l/1m/1n/1o + self-service 1q)"
```

---

### Task 7: BarcodeBeam, ScanFrame, BrandSlot, LanguageToggle

**Files:**
- Create: `packages/ui/src/kiosk/barcode-beam.tsx`, `packages/ui/src/kiosk/scan-frame.tsx`, `packages/ui/src/kiosk/brand-slot.tsx`, `packages/ui/src/kiosk/language-toggle.tsx`
- Test: `packages/ui/src/kiosk/idle-visuals.test.tsx`, `packages/ui/src/kiosk/language-toggle.test.tsx`
- Modify: `packages/ui/src/kiosk/index.ts`

**Interfaces:**
- Consumes: `cn`; theme keyframes from Task 2.
- Produces:

```ts
export interface BarcodeBeamProps { dimmed?: boolean; className?: string }   // dimmed: блокировка — луч гаснет, opacity .35
export function BarcodeBeam(props: BarcodeBeamProps): JSX.Element;

export interface ScanFrameProps { tone?: "ok" | "onBrand"; dimmed?: boolean; className?: string }  // camera viewfinder (1a idle / attract)
export function ScanFrame(props: ScanFrameProps): JSX.Element;

export interface BrandSlotProps { src?: string; alt?: string; placeholderLabel?: string; className?: string }  // зона 380×130, дальше бренд не расползается
export function BrandSlot(props: BrandSlotProps): JSX.Element;

export interface LanguageToggleProps {
  value: string;
  options: { value: string; label: string }[];   // [{value:"ru",label:"РУС"},{value:"en",label:"ENG"}]
  onChange: (value: string) => void;
  tone?: "brand" | "dark";
  className?: string;
}
export function LanguageToggle(props: LanguageToggleProps): JSX.Element;
```

- [ ] **Step 1: Write the failing tests**

`idle-visuals.test.tsx`:

```tsx
import { render } from "@testing-library/react";
import { BarcodeBeam } from "./barcode-beam";
import { BrandSlot } from "./brand-slot";
import { ScanFrame } from "./scan-frame";

describe("idle visuals", () => {
  it("BarcodeBeam shows beam when active and hides it when dimmed", () => {
    const { container, rerender } = render(<BarcodeBeam />);
    expect(container.querySelector("[data-beam]")).toBeTruthy();
    rerender(<BarcodeBeam dimmed />);
    expect(container.querySelector("[data-beam]")).toBeFalsy();
    expect(container.firstElementChild).toHaveClass("opacity-35");
  });
  it("ScanFrame renders four corners and a scan line", () => {
    const { container } = render(<ScanFrame />);
    expect(container.querySelectorAll("[data-corner]").length).toBe(4);
    expect(container.querySelector("[data-scanline]")).toBeTruthy();
  });
  it("BrandSlot renders image when src given, dashed placeholder otherwise", () => {
    const { container, rerender } = render(<BrandSlot placeholderLabel="логотип события" />);
    expect(container.textContent).toContain("логотип события");
    rerender(<BrandSlot src="/logo.svg" alt="ACME" />);
    expect(container.querySelector("img")).toHaveAttribute("alt", "ACME");
  });
});
```

`language-toggle.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LanguageToggle } from "./language-toggle";

describe("LanguageToggle", () => {
  it("marks the active option and switches on click", async () => {
    const onChange = vi.fn();
    render(<LanguageToggle value="ru" options={[{ value: "ru", label: "РУС" }, { value: "en", label: "ENG" }]} onChange={onChange} />);
    expect(screen.getByRole("radio", { name: "РУС" })).toBeChecked();
    await userEvent.click(screen.getByRole("radio", { name: "ENG" }));
    expect(onChange).toHaveBeenCalledWith("en");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @idento/ui -- src/kiosk/idle-visuals src/kiosk/language-toggle`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement**

`barcode-beam.tsx`:

```tsx
import { cn } from "../lib/cn";

export interface BarcodeBeamProps {
  dimmed?: boolean;
  className?: string;
}

/** Метафора аппаратного сканера (2a): штрихкод + ходящий луч. Transform-only — дёшево для Pi. */
export function BarcodeBeam({ dimmed, className }: BarcodeBeamProps) {
  return (
    <div aria-hidden className={cn("relative grid h-[220px] w-[480px] place-items-center", dimmed && "opacity-35", className)}>
      <div
        className="h-[150px] w-[440px] rounded-md"
        style={{ background: "repeating-linear-gradient(90deg, var(--kiosk-outline) 0 8px, transparent 8px 16px, var(--kiosk-outline) 16px 22px, transparent 22px 36px, var(--kiosk-outline) 36px 40px, transparent 40px 52px)" }}
      />
      {!dimmed && (
        <span
          data-beam
          className="absolute -top-2.5 -bottom-2.5 left-1/2 -ml-0.5 w-1 rounded-sm"
          style={{ background: "linear-gradient(180deg, transparent, var(--kiosk-ok) 20%, var(--kiosk-ok) 80%, transparent)", boxShadow: "0 0 24px var(--kiosk-ok)", animation: "kiosk-beam 3.2s ease-in-out infinite" }}
        />
      )}
    </div>
  );
}
```

`scan-frame.tsx`:

```tsx
import { cn } from "../lib/cn";

export interface ScanFrameProps {
  tone?: "ok" | "onBrand";
  dimmed?: boolean;
  className?: string;
}

/** Рамка-видоискатель для camera-режима (1a idle, attract 1g). */
export function ScanFrame({ tone = "ok", dimmed, className }: ScanFrameProps) {
  const c = tone === "ok" ? "border-kiosk-ok" : "border-kiosk-text";
  const line = tone === "ok" ? "var(--kiosk-ok)" : "var(--kiosk-text)";
  const corners = [
    "left-0 top-0 border-l-[7px] border-t-[7px] rounded-tl-2xl",
    "right-0 top-0 border-r-[7px] border-t-[7px] rounded-tr-2xl",
    "left-0 bottom-0 border-l-[7px] border-b-[7px] rounded-bl-2xl",
    "right-0 bottom-0 border-r-[7px] border-b-[7px] rounded-br-2xl",
  ];
  return (
    <div aria-hidden className={cn("relative size-[clamp(220px,32vh,400px)]", dimmed && "opacity-35", className)}>
      {corners.map((pos) => <span key={pos} data-corner className={cn("absolute size-16", pos, c)} />)}
      {!dimmed && (
        <span data-scanline className="absolute left-[6%] h-[3px] w-[88%]" style={{ background: `linear-gradient(90deg, transparent, ${line}, transparent)`, animation: "kiosk-scan 2.8s infinite" }} />
      )}
    </div>
  );
}
```

`brand-slot.tsx`:

```tsx
import { cn } from "../lib/cn";

export interface BrandSlotProps {
  src?: string;
  alt?: string;
  placeholderLabel?: string;
  className?: string;
}

/** Слот брендинга attract-экрана: ограниченная зона 380×130, дальше бренд не расползается. */
export function BrandSlot({ src, alt = "", placeholderLabel, className }: BrandSlotProps) {
  if (src) {
    return (
      <div className={cn("grid h-[130px] w-[380px] place-items-center", className)}>
        <img src={src} alt={alt} className="max-h-full max-w-full object-contain" />
      </div>
    );
  }
  return (
    <div
      className={cn("grid h-[130px] w-[380px] place-items-center rounded-2xl border-[3px] border-dashed border-kiosk-text/55", className)}
      style={{ background: "repeating-linear-gradient(45deg, var(--kiosk-overlay-light) 0 14px, transparent 14px 28px)" }}
    >
      {placeholderLabel && <span className="font-mono opacity-85" style={{ fontSize: "var(--kiosk-fs-chrome)" }}>{placeholderLabel}</span>}
    </div>
  );
}
```

`language-toggle.tsx` (radio group semantics — единственная интерактивная зона attract):

```tsx
import { cn } from "../lib/cn";

export interface LanguageToggleProps {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  tone?: "brand" | "dark";
  className?: string;
}

export function LanguageToggle({ value, options, onChange, tone = "brand", className }: LanguageToggleProps) {
  return (
    <div role="radiogroup" className={cn("flex rounded-full p-1", tone === "brand" ? "bg-kiosk-overlay-ink" : "bg-kiosk-surface-2 border border-kiosk-border-2", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-full px-6 py-2.5 font-bold",
              active ? (tone === "brand" ? "bg-kiosk-text text-kiosk-brand" : "bg-kiosk-text text-kiosk-bg") : "opacity-85",
            )}
            style={{ fontSize: "var(--kiosk-fs-chrome)" }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
```

Append to `index.ts`:

```ts
export { BarcodeBeam, type BarcodeBeamProps } from "./barcode-beam";
export { ScanFrame, type ScanFrameProps } from "./scan-frame";
export { BrandSlot, type BrandSlotProps } from "./brand-slot";
export { LanguageToggle, type LanguageToggleProps } from "./language-toggle";
```

- [ ] **Step 4: Run tests, verify pass, commit**

```bash
npm test -w @idento/ui -- src/kiosk && npm run typecheck -w @idento/ui && npm run lint -w @idento/ui
git add packages/ui/src/kiosk
git commit -m "feat(ui/kiosk): BarcodeBeam, ScanFrame, BrandSlot, LanguageToggle"
```

---

### Task 8: KioskButton, KioskInput, PreflightShell

**Files:**
- Create: `packages/ui/src/kiosk/kiosk-button.tsx`, `packages/ui/src/kiosk/kiosk-input.tsx`, `packages/ui/src/kiosk/preflight-shell.tsx`
- Test: `packages/ui/src/kiosk/kiosk-controls.test.tsx`, `packages/ui/src/kiosk/preflight-shell.test.tsx`
- Modify: `packages/ui/src/kiosk/index.ts`

**Interfaces:**
- Consumes: `cn`; lucide `Check`.
- Produces:

```ts
export interface KioskButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "outline" | "ghost";   // primary: brand; outline: 3px kiosk-outline; ghost: text only
  size?: "md" | "lg";                          // md: 64px, lg: 84px (pre-flight primary)
}
// KioskButton — forwardRef<HTMLButtonElement, KioskButtonProps>

export interface KioskInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  mono?: boolean;                               // URL/код — моноширинный
}
// KioskInput — forwardRef<HTMLInputElement, KioskInputProps>; 84px, surface-2

export interface PreflightShellProps {
  steps: { label: string }[];                   // 5 шагов: Подключение → Вход → Оборудование → Событие → Режим
  activeIndex: number;                          // 0-based; ниже — done (галка), выше — pending
  children: React.ReactNode;                    // тело шага (карточка 820px рисуется шеллом)
  footer?: React.ReactNode;                     // нижняя строка (язык интерфейса)
  className?: string;
}
export function PreflightShell(props: PreflightShellProps): JSX.Element;
```

- [ ] **Step 1: Write the failing tests**

`kiosk-controls.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { KioskButton } from "./kiosk-button";
import { KioskInput } from "./kiosk-input";

describe("KioskButton", () => {
  it("primary uses brand background", () => {
    render(<KioskButton>Продолжить</KioskButton>);
    expect(screen.getByRole("button", { name: "Продолжить" })).toHaveClass("bg-kiosk-brand");
  });
  it("outline and disabled states", () => {
    render(<KioskButton variant="outline" disabled>Назад</KioskButton>);
    const b = screen.getByRole("button", { name: "Назад" });
    expect(b).toHaveClass("border-kiosk-outline");
    expect(b).toBeDisabled();
  });
});

describe("KioskInput", () => {
  it("renders a large input; mono adds font-mono", () => {
    render(<KioskInput mono aria-label="Адрес сервера" defaultValue="https://checkin.local" />);
    const i = screen.getByRole("textbox", { name: "Адрес сервера" });
    expect(i).toHaveClass("font-mono");
    expect(i).toHaveValue("https://checkin.local");
  });
});
```

`preflight-shell.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { PreflightShell } from "./preflight-shell";

const steps = [{ label: "Подключение" }, { label: "Вход" }, { label: "Оборудование" }, { label: "Событие" }, { label: "Режим" }];

describe("PreflightShell", () => {
  it("renders the rail with done/active/pending states and the step card", () => {
    render(
      <PreflightShell steps={steps} activeIndex={2}>
        <div>Тело шага</div>
      </PreflightShell>,
    );
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(5);
    expect(items[0]).toHaveAttribute("data-state", "done");
    expect(items[2]).toHaveAttribute("data-state", "active");
    expect(items[4]).toHaveAttribute("data-state", "pending");
    expect(items[2]).toHaveAttribute("aria-current", "step");
    expect(screen.getByText("Тело шага")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @idento/ui -- src/kiosk/kiosk-controls src/kiosk/preflight-shell`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement**

`kiosk-button.tsx`:

```tsx
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "../lib/cn";

const kioskButtonVariants = cva(
  "inline-flex items-center justify-center rounded-2xl font-extrabold transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kiosk-ok disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        primary: "bg-kiosk-brand text-kiosk-text hover:opacity-90",
        outline: "border-[3px] border-kiosk-outline text-kiosk-text-2 hover:bg-kiosk-surface-2",
        ghost: "text-kiosk-text-2 hover:bg-kiosk-surface-2",
      },
      size: {
        md: "h-16 px-8",
        lg: "h-[84px] px-10",
      },
    },
    defaultVariants: { variant: "primary", size: "lg" },
  },
);

export interface KioskButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof kioskButtonVariants> {}

export const KioskButton = React.forwardRef<HTMLButtonElement, KioskButtonProps>(({ className, variant, size, ...props }, ref) => (
  <button ref={ref} type="button" className={cn(kioskButtonVariants({ variant, size }), className)} style={{ fontSize: "var(--kiosk-fs-idle-sub)" }} {...props} />
));
KioskButton.displayName = "KioskButton";
```

`kiosk-input.tsx`:

```tsx
import * as React from "react";
import { cn } from "../lib/cn";

export interface KioskInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  mono?: boolean;
}

/** Крупное поле pre-flight (84px): surface-2, работает в перчатках. */
export const KioskInput = React.forwardRef<HTMLInputElement, KioskInputProps>(({ className, mono, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "h-[84px] w-full rounded-2xl border-2 border-kiosk-border-2 bg-kiosk-surface-2 px-7 text-kiosk-text placeholder:text-kiosk-text-4 focus-visible:border-kiosk-ok focus-visible:outline-none",
      mono && "font-mono",
      className,
    )}
    style={{ fontSize: "var(--kiosk-fs-idle-sub)" }}
    {...props}
  />
));
KioskInput.displayName = "KioskInput";
```

`preflight-shell.tsx`:

```tsx
import { Check } from "lucide-react";
import type * as React from "react";
import { cn } from "../lib/cn";

export interface PreflightShellProps {
  steps: { label: string }[];
  activeIndex: number;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

/** Хребет pre-flight (1r): рейка из 5 шагов, один активный, карточка 820px по центру. */
export function PreflightShell({ steps, activeIndex, children, footer, className }: PreflightShellProps) {
  return (
    <div className={cn("flex h-full flex-col items-center bg-kiosk-bg text-kiosk-text", className)} style={{ fontFamily: "var(--kiosk-font)" }}>
      <ol className="mt-[7vh] flex items-center gap-9 text-kiosk-text-4" style={{ fontSize: "var(--kiosk-fs-chrome)" }}>
        {steps.map((step, i) => {
          const state = i < activeIndex ? "done" : i === activeIndex ? "active" : "pending";
          return (
            <li key={step.label} data-state={state} aria-current={state === "active" ? "step" : undefined} className={cn("flex items-center gap-3", state !== "pending" && "font-bold text-kiosk-text")}>
              {i > 0 && <span aria-hidden className="-ml-6 mr-3 h-0.5 w-14 bg-kiosk-border-2" />}
              <span className={cn("grid size-10 shrink-0 place-items-center rounded-full font-extrabold", state === "pending" ? "border-2 border-kiosk-border-2" : "bg-kiosk-brand text-kiosk-text")}>
                {state === "done" ? <Check aria-hidden className="size-5" strokeWidth={3.5} /> : i + 1}
              </span>
              {step.label}
            </li>
          );
        })}
      </ol>
      <div className="my-auto w-[min(820px,92vw)] rounded-3xl border border-kiosk-border bg-kiosk-surface p-14">{children}</div>
      {footer && <div className="mb-12 text-kiosk-text-4" style={{ fontSize: "var(--kiosk-fs-chrome)" }}>{footer}</div>}
    </div>
  );
}
```

Append to `index.ts`:

```ts
export { KioskButton, type KioskButtonProps } from "./kiosk-button";
export { KioskInput, type KioskInputProps } from "./kiosk-input";
export { PreflightShell, type PreflightShellProps } from "./preflight-shell";
```

- [ ] **Step 4: Run tests, verify pass, commit**

```bash
npm test -w @idento/ui -- src/kiosk && npm run typecheck -w @idento/ui && npm run lint -w @idento/ui
git add packages/ui/src/kiosk
git commit -m "feat(ui/kiosk): KioskButton, KioskInput, PreflightShell"
```

---

### Task 9: Whole-workspace verification

**Files:** none created — verification-only gate.

**Interfaces:**
- Consumes: everything above.
- Produces: green suite proving panel is unaffected and desktop still builds.

- [ ] **Step 1: Full package suite**

```bash
npm test -w @idento/ui && npm run typecheck -w @idento/ui && npm run lint -w @idento/ui
```

Expected: PASS, including `no-hardcoded-colors` over the new kiosk files.

- [ ] **Step 2: Panel unaffected**

```bash
npm run typecheck -w panel && npm test -w panel
```

Expected: PASS (panel does not import kiosk exports; `@theme inline` additions live in a css panel never imports). NOTE: panel typecheck MUST use `npm run typecheck`, never bare `tsc`.

- [ ] **Step 3: Desktop still builds**

```bash
npm run build -w idento-desktop
```

Expected: PASS.

- [ ] **Step 4: Commit (only if fixes were needed)**

```bash
git add -A && git commit -m "fix(ui/kiosk): workspace verification fixes"
```

---

### Task 10: Desktop app + tray icons from logo handoff

**Files:**
- Modify: `docs/design-briefs/design_handoff_idento_logo/generate-favicons.sh`
- Regenerate: `desktop/src-tauri/icons/**` (icns, ico, PNG set), create `desktop/src-tauri/icons/tray-icon.png`, `desktop/src-tauri/icons/tray-icon@2x.png`

**Interfaces:**
- Consumes: committed SVGs in `docs/design-briefs/design_handoff_idento_logo/assets/` (`app-icon-dark.svg` — тёмный tile для Kiosk; `tray-icon-template.svg` — monochrome, `currentColor`); `@tauri-apps/cli` (`npx tauri icon`), `rsvg-convert`.
- Produces: final desktop icon set; K3's tray wiring uses `icons/tray-icon.png` with `iconAsTemplate: true`.

- [ ] **Step 1: Extend the generation script**

Append to `docs/design-briefs/design_handoff_idento_logo/generate-favicons.sh` (before the final `echo`), keeping its `$WORK`/`$ASSETS`/`$ROOT` conventions:

```bash
# ── desktop (Tauri) icons — dark kiosk tile ──
rsvg-convert -w 1024 -h 1024 "$ASSETS/app-icon-dark.svg" -o kiosk-1024.png

# macOS: same dark tile inset with HIG margins (geometry of app-icon-macos.svg, dark fill)
cat > kiosk-macos.svg <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
  <rect x="6" y="6" width="108" height="108" rx="26" fill="#09090B"/>
  <g transform="translate(28,28) scale(1)"><rect x="12" y="8" width="40" height="48" rx="10" fill="none" stroke="#fff" stroke-width="5"/><rect x="26" y="14" width="12" height="4.5" rx="2.25" fill="#fff"/><circle cx="32" cy="30" r="6.5" fill="#fff"/><path d="M22 48 a10 10 0 0 1 20 0 Z" fill="#fff"/><circle cx="50" cy="49" r="10" fill="#00935E" stroke="#09090B" stroke-width="3.5"/><path d="M45.7 49 l3 3 L54.6 45.4" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></g>
</svg>
SVG
rsvg-convert -w 1024 -h 1024 kiosk-macos.svg -o kiosk-macos-1024.png

(cd "$ROOT/desktop" && npx tauri icon "$WORK/kiosk-1024.png")
mkdir -p "$WORK/macos-icons"
(cd "$ROOT/desktop" && npx tauri icon "$WORK/kiosk-macos-1024.png" -o "$WORK/macos-icons")
cp "$WORK/macos-icons/icon.icns" "$ROOT/desktop/src-tauri/icons/icon.icns"

# tray/menu-bar template (black glyph + alpha; macOS recolors via iconAsTemplate)
rsvg-convert -w 32 -h 32 --stylesheet <(echo '*{color:#000}') "$ASSETS/tray-icon-template.svg" -o "$ROOT/desktop/src-tauri/icons/tray-icon.png" 2>/dev/null \
  || rsvg-convert -w 32 -h 32 "$ASSETS/tray-icon-template.svg" -o "$ROOT/desktop/src-tauri/icons/tray-icon.png"
rsvg-convert -w 64 -h 64 "$ASSETS/tray-icon-template.svg" -o "$ROOT/desktop/src-tauri/icons/tray-icon@2x.png"
echo "Desktop icons regenerated in desktop/src-tauri/icons/."
```

(`rsvg-convert` renders `currentColor` as black by default — the fallback branch is sufficient; the `--stylesheet` attempt just makes the intent explicit.)

- [ ] **Step 2: Run it**

```bash
bash docs/design-briefs/design_handoff_idento_logo/generate-favicons.sh
```

Expected: script completes; `git status` shows modified `desktop/src-tauri/icons/*` plus new `tray-icon.png`/`tray-icon@2x.png`.

- [ ] **Step 3: Verify outputs**

```bash
magick identify desktop/src-tauri/icons/icon.ico desktop/src-tauri/icons/icon.icns | head
file desktop/src-tauri/icons/tray-icon.png
```

Expected: ico contains multiple sizes; icns identified; tray-icon is a 32×32 RGBA PNG. Visually spot-check `desktop/src-tauri/icons/128x128.png` (dark tile, white badge mark, green check disc).

- [ ] **Step 4: Rebuild desktop to confirm icons are consumable**

```bash
npm run build -w idento-desktop
```

Expected: PASS (frontend build; bundle icon validation happens in `tauri build` on CI).

- [ ] **Step 5: Commit**

```bash
git add docs/design-briefs/design_handoff_idento_logo/generate-favicons.sh desktop/src-tauri/icons
git commit -m "feat(desktop): kiosk app + tray icons from logo handoff (dark tile)"
```

---

## Out of scope for K1 (K2/K3 plans)

- K2: rewrite of `desktop/src` (React 19 upgrade, stores, health polling, pre-flight screens, run/self-service screens, scanning inputs, Inter woff2 bundling, sonner removal in run mode).
- K3: sidecar bundling + lifecycle, `tauri-plugin-updater` + `desktop-v*` release workflow, standalone agent packaging (systemd unit, install script), tray wiring (`iconAsTemplate`).
