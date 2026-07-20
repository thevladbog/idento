# Idento logo rollout — design

- **Date:** 2026-07-20
- **Status:** Approved (brainstorming) — ready for implementation plan
- **Scope surfaces:** `web/` (super-admin console, served at `/super-admin/`), `panel/` (customer SPA, served at `/`), `landing/` (Next.js marketing site)
- **Branch:** `claude/focused-pare-df1923` (worktree) → PR (main is branch-protected)

## Context

A new Idento brand mark was delivered as a design handoff. The mark is an outlined
attendee badge (lanyard slot, avatar silhouette) with a green "checked-in" corner
check disc. Brand green `#00935E`, ink `#09090B`.

The handoff currently lives **untracked** in the primary checkout at
`docs/design-briefs/design_handoff_idento_logo/` (README, `Idento Logo.dc.html` +
`support.js` design reference, and 12 production SVGs under `assets/`). It is invisible
from the worktree until copied in.

The mark supersedes the current brand assets, which are **language-specific letter
tiles** — `web/public/idento-{en,ru}-letter.svg` (green tile with a white "I"/"И") and
now-unreferenced `logo-{en,ru}.svg` text wordmarks. The same stale copies exist in
`landing/public/`.

## Decisions (locked with user)

1. **Single neutral mark.** The new mark has no language variants, so the language-aware
   favicon machinery is retired: `web/src/hooks/useFavicon.ts` (+ its call in `App.tsx`)
   is removed, the manifest collapses to one icon set, and `Login.tsx` drops its ru/en
   `logoSrc` branch.
2. **Scope = web + panel + landing only.** The handoff also ships desktop tray / Tauri
   app icons and mobile `composeResources` drawables; those are a **follow-up PR**, not
   this one.
3. **Mark + existing text lockup.** Where a surface shows the text "Idento"/"Иденто" as
   its logo (landing header, panel app-shell header, panel/web login), place the badge
   mark **next to the existing text label**. No dedicated wordmark SVG is shipped; the
   handoff README's Lockups section is updated to document this in-product convention.
4. **Correct multi-size `favicon.ico` + PNG manifest icons.** A single SVG favicon cannot
   switch geometry by size, so we ship a true multi-image `.ico` built from the README's
   size-tiers, plus rasterized PNG icons for the PWA manifest (including a full-bleed
   maskable variant).

## Source assets (handoff → runtime)

From `docs/design-briefs/design_handoff_idento_logo/assets/`:

| Source SVG | Role |
|---|---|
| `logo-mark.svg` | primary mark, light backgrounds (green strokes, masked check ring) |
| `logo-mark-white.svg` | mark for dark / green branding panels |
| `favicon-32.svg` | 24–48 px tier: simplified badge, no lanyard slot |
| `favicon-16.svg` | ≤20 px tier: filled green tile + white avatar, no check |
| `app-icon-ios.svg` | opaque green rounded tile with white mark (iOS/home-screen icon) |

The mark's green (`#00935E`) strokes read on both light and dark backgrounds, so
in-app headers use `logo-mark.svg` with **no theme swap**. Branding panels that are green
(web console login right column) use `logo-mark-white.svg`.

## Rasterization pipeline (reproducible; outputs committed)

Toolchain present in this environment: `rsvg-convert` (librsvg 2.62) + ImageMagick 7
(`magick`). A committed script `docs/design-briefs/design_handoff_idento_logo/generate-favicons.sh`
documents the exact commands and regenerates the binaries. It is **not** wired into CI —
favicons are static; the committed binaries are the source of truth.

Generated per-app `public/` binary set:

| File | Built from → size | Purpose |
|---|---|---|
| `favicon.ico` | `favicon-16`@16 + `favicon-32`@32 + `favicon-32`@48 (multi-image) | classic tab icon, size-tiered |
| `favicon.svg` | copy of `favicon-32.svg` | modern scalable favicon |
| `apple-touch-icon.png` | `app-icon-ios`@180 | iOS home-screen |
| `icon-192.png` | `app-icon-ios`@192 | PWA `purpose:any` |
| `icon-512.png` | `app-icon-ios`@512 | PWA `purpose:any` |
| `maskable-512.png` | new maskable source @512 | PWA `purpose:maskable` |

Plus display marks copied as-is: `logo-mark.svg`, `logo-mark-white.svg`.

**Maskable source** (new SVG authored in the script): full-bleed `#00935E` 512×512 square
with the white mark scaled to ~60% and **centered by the badge rect** (translate `102.4,102.4`
scale `4.8` on the 64-unit mark), so the badge sits at tile center and content stays inside
the Android safe zone. Verified against a simulated circle mask.

Render commands (canonical):
```sh
rsvg-convert -w 16 -h 16 assets/favicon-16.svg -o f16.png
rsvg-convert -w 32 -h 32 assets/favicon-32.svg -o f32.png
rsvg-convert -w 48 -h 48 assets/favicon-32.svg -o f48.png
magick f16.png f32.png f48.png favicon.ico            # embeds all three
rsvg-convert -w 180 -h 180 assets/app-icon-ios.svg -o apple-touch-icon.png
rsvg-convert -w 192 -h 192 assets/app-icon-ios.svg -o icon-192.png
rsvg-convert -w 512 -h 512 assets/app-icon-ios.svg -o icon-512.png
rsvg-convert -w 512 -h 512 maskable.svg -o maskable-512.png
```

## Per-surface changes

### web/ (console, Vite base `/super-admin/`)

- Add the runtime asset set to `web/public/`; delete stale `idento-{en,ru}-letter.svg`,
  `logo-{en,ru}.svg`.
- `web/index.html` (lines ~8-9): replace the two icon links with the standard head block
  (`favicon.ico` `sizes="32x32"`, `favicon.svg`, `apple-touch-icon.png`, keep `manifest`).
  Vite base-prefixes these root paths to `/super-admin/…` (same behavior as today).
- Remove `web/src/hooks/useFavicon.ts` and its import + `useFavicon()` call in
  `web/src/App.tsx` (line ~12 / ~35).
- `web/src/pages/Login.tsx`: delete the `currentLanguage`/`logoSrc` ru/en computation
  (lines ~82-85); the right-hand green branding panel `<img>` (lines ~160-161) uses
  `/logo-mark-white.svg`; keep the `{t("appName")}` text beside it (mark + text lockup).
- `web/public/manifest.json`: replace the two language SVG icons with
  `favicon.svg`(any) + `icon-192`/`icon-512`(any) + `maskable-512`(maskable), all
  `/super-admin/`-prefixed. Keep name/theme/start_url as-is.

### panel/ (customer SPA, Vite base `/`) — greenfield

- Add the runtime asset set to `panel/public/`.
- `panel/index.html`: add the standard head block (`favicon.ico`, `favicon.svg`,
  `apple-touch-icon.png`, `manifest.json`) — root paths (base `/`).
- New `panel/public/manifest.json`: `name:"Idento"`, `short_name:"Idento"`,
  `start_url:"/"`, `display:"standalone"`, `theme_color:"#00935e"`,
  `background_color:"#ffffff"`, icon set (`/favicon.svg` any + `/icon-192` + `/icon-512`
  any + `/maskable-512` maskable).
- `panel/src/app/shell/AppShell.tsx`: prepend `<img src="/logo-mark.svg" …>` (fixed height,
  e.g. `h-6 w-auto`, `alt` from `t("appName")`) before the `{t("appName")}` span in the
  header.
- `panel/src/features/auth/LoginScreen.tsx` and `QrLoginScreen.tsx`: add the mark centered
  in the card header above the title (`logo-mark.svg`, light card background).

### landing/ (Next.js, app router, next-intl)

- Add the runtime asset set to `landing/public/`; delete stale
  `idento-{en,ru}-letter.svg`, `logo-{en,ru}.svg`; replace `favicon.ico` with the
  regenerated multi-size one.
- `landing/src/app/[locale]/layout.tsx`: set `metadata.icons` (icon `favicon.ico` +
  `favicon.svg`, `apple` `apple-touch-icon.png`); keep/remove the hardcoded
  `<link rel="icon" href="/favicon.ico">` (line ~90) in favor of metadata. No PWA manifest
  (marketing site — YAGNI).
- `landing/src/components/layout/Header.tsx`: add the mark next to the "Idento" text in
  both the desktop lockup (line ~27-28) and the mobile sheet lockup (line ~68-72). Use a
  plain `<img src="/logo-mark.svg" alt="Idento" …>`; if eslint `@next/next/no-img-element`
  fires, switch that element to `next/image`.

### docs

- Commit the whole handoff `docs/design-briefs/design_handoff_idento_logo/` (README, HTML
  reference, `support.js`, `assets/`) for provenance — matches the existing
  `idento-event-check-in-landing/` brief convention.
- Add `generate-favicons.sh` alongside it.
- Update the handoff `README.md` Lockups section to state the in-product convention: the
  mark is placed beside the existing text wordmark (no standalone wordmark SVG shipped).

## Verification

- **Build/type:** `npm run typecheck` for panel (per project rule — not bare `tsc`), plus
  each app's lint/build.
- **Dev-server preview** for each app (Browser pane): favicon renders in the tab; mark
  appears in app-shell header + login; light **and** dark legibility
  (`resize_window` colorScheme). Console has no 404s for the icon assets.
- **Base-prefixing:** confirm `/favicon.ico` and `/super-admin/favicon.ico` both resolve
  (web) and `/favicon.ico` (panel) resolves; read the Vite/Next config to confirm the
  head links are rewritten as expected.
- **`.ico` integrity:** `magick identify favicon.ico` shows the 16/32/48 sub-images.
- **Combined image (flagged, not blocking locally):** the full nginx-image 200 curl matrix
  under both `/` (panel) and `/super-admin/` (console) is the same controller/CI check used
  for P5.1; do best-effort locally and flag the image-level check for CI/reviewer.

## Out of scope (follow-up PR)

- Desktop system-tray icon + Tauri app icon set (`desktop/src-tauri/icons/…`) using
  `tray-icon-template.svg` / `app-icon-macos.svg` / `app-icon-windows.svg`.
- Mobile `composeResources` drawables (`mobile/shared/.../drawable/…`).
- Landing PWA web-manifest / Open Graph brand image.

## Risks / caveats

- **apple-touch as SVG vs PNG:** the current console uses an SVG apple-touch-icon; we move
  to a PNG (`app-icon-ios@180`), which is strictly more compatible (iOS never reliably
  supported SVG apple-touch). No regression.
- **Vite html base rewrite:** relies on Vite rewriting root-relative `<link>` hrefs in
  `index.html` to the configured base. Current code already depends on this for
  `/idento-en-letter.svg`, so it is proven; still explicitly verified in the plan.
- **Committed binaries:** favicons are committed as binaries; the script exists only for
  reproducibility and is not run in CI.
