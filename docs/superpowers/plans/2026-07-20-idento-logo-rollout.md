# Idento Logo Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Roll the new Idento badge mark into every brand-logo/favicon surface across `web/` (console), `panel/` (customer SPA), and `landing/` (Next.js), with a correct multi-size `favicon.ico` and PNG PWA manifest icons.

**Architecture:** Vendor the untracked design handoff into the repo, generate the runtime favicon/app-icon binaries once via a committed `rsvg-convert` + `magick` script, distribute a fixed asset set into each app's `public/`, then repoint every icon/logo reference. The new mark is language-neutral, so the ru/en favicon-swap machinery is deleted rather than duplicated.

**Tech Stack:** SVG assets, `rsvg-convert` (librsvg 2.62), ImageMagick 7 (`magick`), Vite (web/panel), Next.js app-router + next-intl (landing), Vitest + React Testing Library (panel tests).

## Global Constraints

- Brand green `#00935E`; theme-color meta stays `#00935e`; ink `#09090B`. Copy verbatim.
- New mark is **language-neutral** — no ru/en variants anywhere.
- Scope is **web + panel + landing only**. Desktop tray/Tauri icons and mobile drawables are explicitly out of scope.
- Panel typecheck MUST use `npm run typecheck -w panel`, never bare `tsc`.
- Marks placed next to an existing text wordmark are **decorative** (`alt=""`); marks standing alone carry `alt="Idento"`.
- web Vite base is `/super-admin/`; panel base is `/`. `manifest.json` is NOT processed by Vite's HTML transform, so its icon `src` paths must be written with the explicit base prefix; `index.html` `<link href>` paths are root-relative and Vite rewrites them.
- Every npm project pins `registry=https://registry.npmjs.com/` via `.npmrc` (already present; do not touch).

---

### Task 1: Vendor handoff + generate & distribute favicon assets

**Files:**
- Create (vendored): `docs/design-briefs/design_handoff_idento_logo/assets/**` and `docs/design-briefs/design_handoff_idento_logo/README.md` **only** — do NOT vendor `Idento Logo.dc.html` or `support.js` (the HTML design reference stays out of git).
- Create: `docs/design-briefs/design_handoff_idento_logo/generate-favicons.sh`
- Modify: `docs/design-briefs/design_handoff_idento_logo/README.md` (Lockups section)
- Create (generated): `web/public/{favicon.ico,favicon.svg,apple-touch-icon.png,icon-192.png,icon-512.png,maskable-512.png,logo-mark.svg,logo-mark-white.svg}` and the same eight files under `panel/public/` and `landing/public/`

**Interfaces:**
- Produces: the fixed public asset set (`/favicon.ico`, `/favicon.svg`, `/apple-touch-icon.png`, `/icon-192.png`, `/icon-512.png`, `/maskable-512.png`, `/logo-mark.svg`, `/logo-mark-white.svg`) that Tasks 2–4 reference by path.

- [ ] **Step 1: Copy the handoff into the repo**

The handoff is untracked in the primary checkout, invisible from this worktree. Vendor **only** `assets/` + `README.md` (not the HTML reference or `support.js`):

```bash
cd /Users/thevladbog/PRSOME/idento/.claude/worktrees/focused-pare-df1923
SRC="/Users/thevladbog/PRSOME/idento/docs/design-briefs/design_handoff_idento_logo"
mkdir -p docs/design-briefs/design_handoff_idento_logo
cp -R "$SRC/assets" docs/design-briefs/design_handoff_idento_logo/assets
cp "$SRC/README.md" docs/design-briefs/design_handoff_idento_logo/README.md
find docs/design-briefs/design_handoff_idento_logo -name .DS_Store -delete
ls docs/design-briefs/design_handoff_idento_logo/assets
```
Expected: the 12 source SVGs listed (`logo-mark.svg`, `logo-mark-white.svg`, `favicon-16.svg`, `favicon-32.svg`, `app-icon-ios.svg`, …). The dir contains `assets/`, `README.md`, and (after Step 2) `generate-favicons.sh` — nothing else.

- [ ] **Step 2: Write the generation script**

Create `docs/design-briefs/design_handoff_idento_logo/generate-favicons.sh`:

```bash
#!/usr/bin/env bash
# Regenerates runtime favicon/app-icon binaries from the handoff SVGs and
# distributes them into web/, panel/, and landing/ public dirs.
# Requires: rsvg-convert (librsvg), magick (ImageMagick 7).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ASSETS="$HERE/assets"
ROOT="$(cd "$HERE/../../.." && pwd)"   # docs/design-briefs/design_handoff_idento_logo -> repo root
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"

# favicon.ico — size-tiered (16 = filled tile, 32/48 = simplified badge)
rsvg-convert -w 16 -h 16 "$ASSETS/favicon-16.svg" -o f16.png
rsvg-convert -w 32 -h 32 "$ASSETS/favicon-32.svg" -o f32.png
rsvg-convert -w 48 -h 48 "$ASSETS/favicon-32.svg" -o f48.png
magick f16.png f32.png f48.png favicon.ico

# opaque tile PNGs — apple-touch + PWA "any"
rsvg-convert -w 180 -h 180 "$ASSETS/app-icon-ios.svg" -o apple-touch-icon.png
rsvg-convert -w 192 -h 192 "$ASSETS/app-icon-ios.svg" -o icon-192.png
rsvg-convert -w 512 -h 512 "$ASSETS/app-icon-ios.svg" -o icon-512.png

# maskable — full-bleed green, white mark @~60% centered by the badge rect
cat > maskable.svg <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#00935E"/>
  <g transform="translate(102.4,102.4) scale(4.8)">
    <rect x="12" y="8" width="40" height="48" rx="10" fill="none" stroke="#fff" stroke-width="5"/>
    <rect x="26" y="14" width="12" height="4.5" rx="2.25" fill="#fff"/>
    <circle cx="32" cy="30" r="6.5" fill="#fff"/>
    <path d="M22 48 a10 10 0 0 1 20 0 Z" fill="#fff"/>
    <circle cx="50" cy="49" r="10" fill="#fff" stroke="#00935E" stroke-width="3.5"/>
    <path d="M45.7 49 l3 3 L54.6 45.4" fill="none" stroke="#00935E" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>
SVG
rsvg-convert -w 512 -h 512 maskable.svg -o maskable-512.png

# distribute into each app's public dir
for app in web panel landing; do
  DEST="$ROOT/$app/public"
  cp favicon.ico apple-touch-icon.png icon-192.png icon-512.png maskable-512.png "$DEST/"
  cp "$ASSETS/favicon-32.svg" "$DEST/favicon.svg"
  cp "$ASSETS/logo-mark.svg" "$ASSETS/logo-mark-white.svg" "$DEST/"
done

echo "Distributed to web/panel/landing public dirs."
magick identify "$ROOT/web/public/favicon.ico"
```
Then `chmod +x docs/design-briefs/design_handoff_idento_logo/generate-favicons.sh`.

- [ ] **Step 3: Run the script**

Run:
```bash
bash docs/design-briefs/design_handoff_idento_logo/generate-favicons.sh
```
Expected tail output includes three sub-images:
```
favicon.ico[0] ICO 16x16 ...
favicon.ico[1] ICO 32x32 ...
favicon.ico[2] ICO 48x48 ...
```

- [ ] **Step 4: Verify distribution**

Run:
```bash
for a in web panel landing; do echo "== $a =="; ls $a/public | grep -E 'favicon\.(ico|svg)|apple-touch|icon-(192|512)|maskable|logo-mark'; done
```
Expected: all eight files present in each of `web/public`, `panel/public`, `landing/public`.

- [ ] **Step 5: Update handoff README Lockups section**

In `docs/design-briefs/design_handoff_idento_logo/README.md`, under `## Lockups`, append:

```markdown
> **In-product convention (idento web/panel/landing):** no standalone wordmark SVG is
> shipped. Where a surface already renders the text "Idento"/"Иденто" as its logo, the
> mark (`logo-mark.svg`) is placed beside that existing text label; the image is
> decorative (`alt=""`). Where the mark stands alone (e.g. the panel login card) it
> carries `alt="Idento"`.
```

- [ ] **Step 6: Commit**

```bash
git add docs/design-briefs/design_handoff_idento_logo web/public panel/public landing/public
git commit -m "assets: vendor Idento logo handoff + generate favicon/app-icon set"
```

---

### Task 2: Wire web/ console (favicon, manifest, login, remove i18n favicon hook)

**Files:**
- Modify: `web/index.html:8-9`
- Modify: `web/src/App.tsx:12,35`
- Delete: `web/src/hooks/useFavicon.ts`
- Modify: `web/src/pages/Login.tsx:82-85,160-161`
- Modify: `web/public/manifest.json:10-23`
- Delete: `web/public/idento-en-letter.svg`, `web/public/idento-ru-letter.svg`, `web/public/logo-en.svg`, `web/public/logo-ru.svg`

**Interfaces:**
- Consumes: the asset set from Task 1.

- [ ] **Step 1: Replace the head icon links**

In `web/index.html`, replace lines 8-9:
```html
    <link rel="icon" type="image/svg+xml" href="/idento-en-letter.svg" />
    <link rel="apple-touch-icon" sizes="512x512" href="/idento-en-letter.svg" />
```
with:
```html
    <link rel="icon" href="/favicon.ico" sizes="32x32" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
```

- [ ] **Step 2: Remove the language-favicon hook usage**

In `web/src/App.tsx`, delete the import on line 12 (`import { useFavicon } from "./hooks/useFavicon";`) and the call on line 35 (`  useFavicon();`).

- [ ] **Step 3: Delete the hook file**

```bash
git rm web/src/hooks/useFavicon.ts
```

- [ ] **Step 4: Repoint the login logo to the white mark**

In `web/src/pages/Login.tsx`, delete the ru/en computation (lines 82-85):
```tsx
  const currentLanguage = i18n.resolvedLanguage ?? i18n.language;
  const logoSrc = currentLanguage?.startsWith("ru")
    ? "/idento-ru-letter.svg"
    : "/idento-en-letter.svg";
```
Then in the branding column `<img>` (lines ~160-161) change `src={logoSrc}` to `src="/logo-mark-white.svg"` (keep `alt={t("appName")}` and the className). Remove any now-unused `i18n` reference only if it is not used elsewhere in the file — verify with a grep before deleting the `useTranslation` destructure of `i18n`.

Run:
```bash
grep -n "i18n" web/src/pages/Login.tsx
```
If `i18n` has no other use, drop it from the `useTranslation()` destructure; otherwise leave it.

- [ ] **Step 5: Rewrite the manifest icons**

In `web/public/manifest.json`, replace the `"icons": [ … ]` array (lines 10-23) with:
```json
  "icons": [
    { "src": "/super-admin/favicon.svg", "type": "image/svg+xml", "sizes": "any" },
    { "src": "/super-admin/icon-192.png", "type": "image/png", "sizes": "192x192", "purpose": "any" },
    { "src": "/super-admin/icon-512.png", "type": "image/png", "sizes": "512x512", "purpose": "any" },
    { "src": "/super-admin/maskable-512.png", "type": "image/png", "sizes": "512x512", "purpose": "maskable" }
  ],
```

- [ ] **Step 6: Delete stale assets**

```bash
git rm web/public/idento-en-letter.svg web/public/idento-ru-letter.svg web/public/logo-en.svg web/public/logo-ru.svg
```

- [ ] **Step 7: Verify no dangling references**

Run:
```bash
grep -rn "idento-en-letter\|idento-ru-letter\|logo-en\.svg\|logo-ru\.svg\|useFavicon\|logoSrc" web/src web/index.html web/public/manifest.json
```
Expected: no matches.

- [ ] **Step 8: Typecheck + build**

Run:
```bash
npm run build -w web
```
Expected: build succeeds (no missing-module error for `./hooks/useFavicon`, no TS error in `Login.tsx`).

- [ ] **Step 9: Commit**

```bash
git add web/
git commit -m "web(console): new Idento mark favicon + login logo; drop i18n favicon swap"
```

---

### Task 3: Wire panel/ (favicon, new manifest, app-shell + login logos)

**Files:**
- Modify: `panel/index.html`
- Create: `panel/public/manifest.json`
- Modify: `panel/src/app/shell/AppShell.tsx`
- Modify: `panel/src/app/shell/AppShell.test.tsx`
- Modify: `panel/src/features/auth/LoginScreen.tsx`
- Modify: `panel/src/features/auth/LoginScreen.test.tsx`
- Modify: `panel/src/features/auth/QrLoginScreen.tsx`
- Modify: `panel/src/features/auth/QrLoginScreen.test.tsx`

**Interfaces:**
- Consumes: the asset set from Task 1 (base `/`, so `/logo-mark.svg`, `/favicon.svg`, etc.).

- [ ] **Step 1: Add head icon links + manifest to panel/index.html**

In `panel/index.html`, inside `<head>` after the `theme-color` meta, add:
```html
    <link rel="icon" href="/favicon.ico" sizes="32x32" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <link rel="manifest" href="/manifest.json" />
```

- [ ] **Step 2: Create panel manifest**

Create `panel/public/manifest.json`:
```json
{
  "name": "Idento",
  "short_name": "Idento",
  "description": "Idento event check-in",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#00935e",
  "icons": [
    { "src": "/favicon.svg", "type": "image/svg+xml", "sizes": "any" },
    { "src": "/icon-192.png", "type": "image/png", "sizes": "192x192", "purpose": "any" },
    { "src": "/icon-512.png", "type": "image/png", "sizes": "512x512", "purpose": "any" },
    { "src": "/maskable-512.png", "type": "image/png", "sizes": "512x512", "purpose": "maskable" }
  ],
  "lang": "en",
  "dir": "ltr"
}
```

- [ ] **Step 3: Write the failing AppShell test**

In `panel/src/app/shell/AppShell.test.tsx`, inside the existing `describe("AppShell", …)`, add a test (place after the existing render test; reuse the same providers wrapper). Use the render result's `container` to find the decorative mark:
```tsx
  it("renders the Idento brand mark in the header", () => {
    global.fetch = vi.fn().mockImplementation(() => jsonResponse(200, { mode: "saas", version: "1.0", license: null }));
    const queryClient = new QueryClient();
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <RouterContextProvider router={testRouter}>
            <AppShell><div>page content</div></AppShell>
          </RouterContextProvider>
        </ThemeProvider>
      </QueryClientProvider>,
    );
    expect(container.querySelector('img[src="/logo-mark.svg"]')).not.toBeNull();
  });
```

- [ ] **Step 4: Run the test to verify it fails**

Run:
```bash
npm run test -w panel -- AppShell
```
Expected: FAIL — the new test's `querySelector` returns null.

- [ ] **Step 5: Add the mark to AppShell**

In `panel/src/app/shell/AppShell.tsx`, replace the header brand span:
```tsx
        <span className="text-section-title">{t("appName")}</span>
```
with a mark-plus-text lockup:
```tsx
        <span className="flex items-center gap-2">
          <img src="/logo-mark.svg" alt="" aria-hidden="true" className="h-6 w-auto" />
          <span className="text-section-title">{t("appName")}</span>
        </span>
```

- [ ] **Step 6: Run the test to verify it passes**

Run:
```bash
npm run test -w panel -- AppShell
```
Expected: PASS (all AppShell tests green).

- [ ] **Step 7: Write the failing LoginScreen + QrLoginScreen tests**

In `panel/src/features/auth/LoginScreen.test.tsx`, add inside its `describe`:
```tsx
  it("shows the Idento brand mark", () => {
    global.fetch = vi.fn().mockImplementation(() =>
      new Response(JSON.stringify({ mode: "saas", version: "test", license: null }), {
        status: 200, headers: { "Content-Type": "application/json" },
      }),
    );
    renderWithQuery(<LoginScreen />);
    expect(screen.getByRole("img", { name: "Idento" })).toBeInTheDocument();
  });
```
In `panel/src/features/auth/QrLoginScreen.test.tsx`, add inside its `describe`:
```tsx
  it("shows the Idento brand mark", () => {
    global.fetch = vi.fn().mockImplementation(() =>
      new Response(JSON.stringify({ mode: "saas", version: "test", license: null }), {
        status: 200, headers: { "Content-Type": "application/json" },
      }),
    );
    renderWithQuery(<QrLoginScreen />);
    expect(screen.getByRole("img", { name: "Idento" })).toBeInTheDocument();
  });
```

- [ ] **Step 8: Run the tests to verify they fail**

Run:
```bash
npm run test -w panel -- LoginScreen QrLoginScreen
```
Expected: FAIL — no `img` with accessible name "Idento".

- [ ] **Step 9: Add the mark to both login screens**

In `panel/src/features/auth/LoginScreen.tsx`, inside `<CardHeader>`, above `<CardTitle>`, add:
```tsx
          <img src="/logo-mark.svg" alt="Idento" className="mb-2 h-10 w-auto self-center" />
```
Apply the identical change inside the `<CardHeader>` of `panel/src/features/auth/QrLoginScreen.tsx` (above its title element). If a screen's `CardHeader` is not `flex`/centered, wrap the header content so the mark centers (e.g. add `className="flex flex-col items-center"` to the `CardHeader`), matching the existing layout.

- [ ] **Step 10: Run the tests to verify they pass**

Run:
```bash
npm run test -w panel -- LoginScreen QrLoginScreen AppShell
```
Expected: PASS.

- [ ] **Step 11: Typecheck**

Run:
```bash
npm run typecheck -w panel
```
Expected: no errors.

- [ ] **Step 12: Commit**

```bash
git add panel/
git commit -m "panel: add Idento mark to app-shell header + login screens; favicon + manifest"
```

---

### Task 4: Wire landing/ (header lockup + favicon metadata)

**Files:**
- Modify: `landing/src/components/layout/Header.tsx:27-28,68-72`
- Modify: `landing/src/app/[locale]/layout.tsx` (metadata icons + head link ~line 90)
- Delete: `landing/public/idento-en-letter.svg`, `landing/public/idento-ru-letter.svg`, `landing/public/logo-en.svg`, `landing/public/logo-ru.svg`

**Interfaces:**
- Consumes: the asset set from Task 1 (`landing/public/…`, base `/`).

- [ ] **Step 1: Add the mark to the desktop header lockup**

In `landing/src/components/layout/Header.tsx`, the desktop brand link (lines ~27-28):
```tsx
          <Link href="/" className="mr-6 flex items-center space-x-2 transition-opacity hover:opacity-80">
            <span className="hidden font-bold sm:inline-block">Idento</span>
```
Insert the mark before the span:
```tsx
          <Link href="/" className="mr-6 flex items-center space-x-2 transition-opacity hover:opacity-80">
            <img src="/logo-mark.svg" alt="" aria-hidden="true" className="h-6 w-auto" />
            <span className="hidden font-bold sm:inline-block">Idento</span>
```

- [ ] **Step 2: Add the mark to the mobile sheet lockup**

In the same file, the mobile brand link (lines ~68-72) renders `<span className="font-bold">Idento</span>` inside a `href="/"` link. Insert `<img src="/logo-mark.svg" alt="" aria-hidden="true" className="h-6 w-auto" />` immediately before that span, matching the surrounding indentation.

- [ ] **Step 3: Check the eslint image rule**

Run:
```bash
npm run lint -w landing 2>&1 | grep -i "no-img-element" || echo "no img-element warning"
```
If `@next/next/no-img-element` fires on the two new `<img>` tags: add `import Image from "next/image";` and replace each `<img … />` with `<Image src="/logo-mark.svg" alt="" aria-hidden width={24} height={24} className="h-6 w-auto" />`. Otherwise leave the plain `<img>`.

- [ ] **Step 4: Set favicon metadata in the locale layout**

In `landing/src/app/[locale]/layout.tsx`, add an `icons` block to the exported `metadata` object (co-located with `title`/`openGraph`):
```tsx
    icons: {
      icon: [
        { url: "/favicon.ico", sizes: "32x32" },
        { url: "/favicon.svg", type: "image/svg+xml" },
      ],
      apple: "/apple-touch-icon.png",
    },
```
Then remove the now-redundant hardcoded `<link rel="icon" href="/favicon.ico" />` (line ~90) so Next owns the head icons. (If that `<link>` is the only child of its `<head>` JSX, leave a valid `<head>`/fragment; otherwise just delete the single line.)

- [ ] **Step 5: Delete stale assets**

```bash
git rm landing/public/idento-en-letter.svg landing/public/idento-ru-letter.svg landing/public/logo-en.svg landing/public/logo-ru.svg
```

- [ ] **Step 6: Verify no dangling references + build**

Run:
```bash
grep -rn "idento-en-letter\|idento-ru-letter\|logo-en\.svg\|logo-ru\.svg" landing/src landing/public
npm run build -w landing
```
Expected: no grep matches; Next build succeeds.

- [ ] **Step 7: Commit**

```bash
git add landing/
git commit -m "landing: add Idento mark to header lockup + favicon metadata"
```

---

### Task 5: Cross-surface verification + PR

**Files:** none (verification + PR only)

- [ ] **Step 1: Confirm `.ico` integrity**

Run:
```bash
for a in web panel landing; do echo "== $a =="; magick identify $a/public/favicon.ico; done
```
Expected: each shows 16x16, 32x32, 48x48 sub-images.

- [ ] **Step 2: Preview web console (dark + light)**

Start the web dev server via the Browser pane (`.claude/launch.json` entry for web, or add one). Load the app, then:
- confirm the tab favicon renders (read_page / screenshot),
- confirm the login branding panel shows the white mark,
- `read_console_messages` shows no 404 for `/favicon.ico`, `/favicon.svg`, `/apple-touch-icon.png`, `/logo-mark-white.svg`,
- `resize_window` colorScheme dark → mark still legible.

- [ ] **Step 3: Preview panel (dark + light)**

Start the panel dev server. Confirm the app-shell header shows mark + "Idento", the login card shows the mark, favicon resolves, no icon 404s, dark mode legible.

- [ ] **Step 4: Preview landing (dark + light)**

Start the landing dev server (`npm run dev -w landing`). Confirm the header shows mark + "Idento" (desktop and mobile viewport via `resize_window`), favicon resolves.

- [ ] **Step 5: Base-prefix sanity (web)**

With the web dev server running, confirm the built head links resolve under the console base. Read `web/vite.config.*` to confirm `base: "/super-admin/"`, and check the served HTML rewrites `/favicon.svg` → `/super-admin/favicon.svg` (network tab / read_network_requests). Note explicitly if the dev server serves at root vs base.

- [ ] **Step 6: Full test + typecheck sweep**

Run:
```bash
npm run test -w panel
npm run typecheck -w panel
npm run build -w web
npm run build -w landing
```
Expected: all green.

- [ ] **Step 7: Push branch + open PR**

```bash
git push -u origin claude/focused-pare-df1923
gh pr create --title "Idento logo rollout: new mark across web / panel / landing" --body "$(cat <<'EOF'
## Summary
Rolls the new Idento badge mark into every brand-logo/favicon surface across web (console), panel (customer SPA), and landing.

- New language-neutral mark replaces the old ru/en letter tiles; the i18n favicon-swap hook is removed.
- Correct multi-size `favicon.ico` (16 filled tile / 32 / 48 simplified) + `favicon.svg` + apple-touch PNG + PWA manifest PNGs (any + maskable), generated from the handoff via a committed `rsvg-convert` + `magick` script.
- panel: mark added to app-shell header + login screens; new panel manifest.
- landing: mark added to header lockup (desktop + mobile); favicon via Next metadata.
- Stale `idento-*-letter.svg` / `logo-{en,ru}.svg` removed from web and landing.

Design + plan: `docs/superpowers/specs/2026-07-20-idento-logo-rollout-design.md`, `docs/superpowers/plans/2026-07-20-idento-logo-rollout.md`.

## Out of scope (follow-up)
Desktop tray/Tauri icons and mobile drawables (handoff ships those platform icons).

## Reviewer note
The combined-nginx-image 200 curl matrix under both `/` (panel) and `/super-admin/` (console) is the same image-level check used for P5.1 — verify in CI / a controller run.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- Single neutral mark + remove i18n swap → Task 2 (steps 2-4). ✓
- Scope web+panel+landing only → Tasks 2/3/4; desktop/mobile called out as out-of-scope in the PR body. ✓
- Mark + existing text lockup → Task 3 (AppShell), Task 4 (Header). ✓
- Standalone mark alt="Idento" (panel login) vs decorative alt="" (headers) → Global Constraints + Task 3 steps 5/9, Task 4 steps 1-2. ✓
- Multi-size favicon.ico + PNG manifest icons + maskable → Task 1. ✓
- Rasterization script committed, not in CI → Task 1 steps 2-3. ✓
- Per-app favicon package + head links + manifests → Tasks 1-4. ✓
- README lockup doc update → Task 1 step 5. ✓
- Delete stale assets → Task 2 step 6, Task 4 step 5. ✓
- Verification (typecheck via `npm run typecheck`, previews, .ico integrity, base-prefix) → Task 5. ✓

**Placeholder scan:** No TBD/TODO; all code steps show concrete code; conditional steps (i18n cleanup, eslint img rule, redundant head link) specify exactly how to decide and what to do in each branch. ✓

**Type consistency:** Asset paths are identical everywhere (`/logo-mark.svg`, `/logo-mark-white.svg`, `/favicon.ico`, `/favicon.svg`, `/apple-touch-icon.png`, `/icon-192.png`, `/icon-512.png`, `/maskable-512.png`). Manifest paths carry the `/super-admin/` prefix for web and `/` for panel, per Global Constraints. Test helper names (`jsonResponse`, `renderWithQuery`, `testRouter`) match the existing files inspected. ✓
